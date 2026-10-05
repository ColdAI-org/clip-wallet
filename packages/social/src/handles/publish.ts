/**
 * Writing to ClipHandles (contracts/handles) from the wallet: each action becomes a Hedera
 * ContractExecuteTransaction (https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/call-a-smart-contract-function)
 * that goes through the normal approval path, paid and signed by the user's Hedera account. msg.sender is that
 * account's EVM address (its ECDSA key's address), so the handle's owner is the user's Hedera account.
 *
 * `refineHandleRequest` turns the approval for these calls into plain words, bound to the ClipHandles contract
 * id (selectors like release() are too generic to name globally), and adds the "public-record" warning.
 */
import type { ChainContext, DappRequest, DecodedRequest, Family, Warning } from "@clip-wallet/core";
import { ClipError, msg, titled } from "@clip-wallet/core";
import { contractCallDraft, contractCallOf, freezeNew, requestFor, resolvePayer } from "@clip-wallet/chains-hedera";
import { CLIP_HANDLES_ABI, isValidHandle } from "@clip-wallet/names";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";

export type HandleAction =
  | { kind: "register"; handle: string }
  /** Publish (or with address "" unpublish) addresses, one per family. */
  | { kind: "publish"; records: { family: Family; address: string }[] }
  | { kind: "release"; recordCount: number }
  | { kind: "reverse"; enabled: boolean };

export interface HandlesContract {
  /** Hedera contract id ("0.0.x") of the deployed ClipHandles. */
  contractId: string;
}

export function handleCalldata(action: HandleAction): Hex {
  switch (action.kind) {
    case "register":
      if (!isValidHandle(action.handle)) throw new ClipError("Handles use 3–32 lowercase letters, numbers and single hyphens.", "handles/invalid");
      return encodeFunctionData({ abi: CLIP_HANDLES_ABI, functionName: "register", args: [action.handle] });
    case "publish":
      if (!action.records.length) throw new ClipError("Pick at least one address to publish.", "handles/nothing");
      return encodeFunctionData({ abi: CLIP_HANDLES_ABI, functionName: "setAddresses", args: [action.records.map((r) => r.family), action.records.map((r) => r.address)] });
    case "release":
      return encodeFunctionData({ abi: CLIP_HANDLES_ABI, functionName: "release" });
    case "reverse":
      return encodeFunctionData({ abi: CLIP_HANDLES_ABI, functionName: "setReverse", args: [action.enabled] });
  }
}

/**
 * Gas limits sized from the contract's forge gas report with headroom. Hedera charges the gas actually used
 * and refunds the rest (https://docs.hedera.com/evm/development/gas-fees.md, "Gas Reservation and Unused Gas
 * Refund"), so the headroom costs nothing.
 */
export function handleGas(action: HandleAction): number {
  switch (action.kind) {
    case "register":
      return 180_000;
    case "publish":
      return Math.min(2_000_000, 80_000 + 110_000 * action.records.length);
    case "release":
      return Math.min(1_500_000, 90_000 + 35_000 * Math.max(1, action.recordCount));
    case "reverse":
      return 70_000;
  }
}

/** The DappRequest for an action, ready for the approval queue. */
export async function buildHandleRequest(action: HandleAction, contract: HandlesContract, ctx: ChainContext): Promise<DappRequest> {
  if (ctx.network.family !== "hedera") throw new ClipError("Clip handles live on Hedera.", "handles/network");
  const payer = await resolvePayer(ctx);
  // chains-hedera's codec, no Hiero SDK at runtime (same bytes; see chains-hedera test/codec.test.ts).
  const tx = contractCallDraft({ contractId: contract.contractId, gas: handleGas(action), functionParameters: hexToBytes(handleCalldata(action)) });
  const request = requestFor(freezeNew(tx, payer, ctx), payer, ctx);
  request.origin = "wallet";
  return request;
}

/** Plain words for a ClipHandles call. Leaves every other request untouched. */
export function refineHandleRequest(request: DappRequest, decoded: DecodedRequest, contract: HandlesContract | undefined): DecodedRequest {
  if (!contract || request.family !== "hedera") return decoded;
  const call = handleCallOf(request, contract.contractId);
  if (!call) return decoded;
  const lines = decoded.lines.filter((l) => l.label !== "Function");
  const warnings = decoded.warnings.filter((w) => w.code !== "blind-signing");
  const pub = (message: string): Warning => ({ level: "caution", code: "public-record", message });
  switch (call.functionName) {
    case "register":
      return {
        ...decoded,
        blind: false,
        ...titled(msg("bg.req.claimHandle", { handle: call.args[0] })),
        lines,
        warnings: [...warnings, pub(`Anyone can see that @${call.args[0]} belongs to your Hedera account.`)],
      };
    case "setAddresses": {
      const [families, addrs] = call.args as readonly [readonly string[], readonly string[]];
      const set = families.map((f, i) => ({ f, a: addrs[i] ?? "" }));
      const published = set.filter((r) => r.a);
      const removed = set.filter((r) => !r.a);
      return {
        ...decoded,
        blind: false,
        title: published.length ? `Publish ${published.length} address${published.length === 1 ? "" : "es"} on your handle` : "Remove addresses from your handle",
        lines: [...published.map((r) => ({ label: `Publish (${r.f})`, value: r.a })), ...removed.map((r) => ({ label: "Remove", value: r.f })), ...lines],
        warnings: published.length
          ? [
              ...warnings,
              pub(
                published.length > 1
                  ? "These addresses become public and linked to each other and to your handle, for anyone, forever. Removing them later doesn't erase the history."
                  : "This address becomes public and linked to your handle, for anyone, forever. Removing it later doesn't erase the history.",
              ),
            ]
          : warnings,
      };
    }
    case "release":
      return { ...decoded, blind: false, title: "Give up your handle", lines, warnings };
    case "setReverse":
      return {
        ...decoded,
        blind: false,
        title: call.args[0] ? "Show your handle next to your address" : "Stop showing your handle next to your address",
        lines,
        warnings: call.args[0] ? [...warnings, pub("Apps and wallets will show your handle when they see your Hedera address.")] : warnings,
      };
    default:
      return decoded;
  }
}

function handleCallOf(request: DappRequest, contractId: string) {
  const params = request.params as { transactionList?: string } | undefined;
  if (!params?.transactionList) return null;
  let call: ReturnType<typeof contractCallOf>;
  try {
    call = contractCallOf(base64ToBytes(params.transactionList));
  } catch {
    return null;
  }
  if (!call || call.contractId !== contractId || !call.functionParameters.length) return null;
  try {
    return decodeFunctionData({ abi: CLIP_HANDLES_ABI, data: bytesToHex(call.functionParameters) });
  } catch {
    return null;
  }
}

function hexToBytes(h: Hex): Uint8Array {
  const s = h.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): Hex {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s as Hex;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
