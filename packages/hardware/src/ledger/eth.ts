/**
 * Ledger Ethereum app (@ledgerhq/hw-app-eth). The app never signs a bare digest, so every EVM payload
 * needs `raw`: the unsigned transaction (clear-signed with Ledger's metadata "resolution"), the
 * personal_sign message, or the full EIP-712 JSON (hashed fallback for devices without full EIP-712).
 */
import Eth, { ledgerService } from "@ledgerhq/hw-app-eth";
import type Transport from "@ledgerhq/hw-transport";
import type { SignablePayload, Signature } from "@clip-wallet/core";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hashDomain, hashStruct, hashTypedData, type TypedDataDefinition } from "viem";
import { concat, equal, fromHex, toHex, utf8 } from "../bytes.js";
import { HardwareErrors, SW } from "../errors.js";
import { ledgerPath } from "../paths.js";
import { ecdsaSignature } from "../verify.js";

/** Ledger metadata services (CAL). `{ calServiceURL: null }` keeps EIP-712 signing fully offline. */
export type EthLoadConfig = NonNullable<ConstructorParameters<typeof Eth>[2]>;

export type EthResolution = Awaited<ReturnType<typeof ledgerService.resolveTransaction>>;
/** Looks up Ledger's signed metadata (token tickers, plugin selectors) so the device can clear-sign. */
export type EthResolver = (rawTxHex: string) => Promise<EthResolution | null>;

export const defaultEthResolver: EthResolver = (rawTxHex) =>
  ledgerService
    .resolveTransaction(rawTxHex, {}, { externalPlugins: true, erc20: true, nft: true, uniswapV3: true })
    .catch(() => null); // no metadata: the device shows raw fields or asks for blind signing

export async function ethPublicKey(t: Transport, path: string): Promise<{ publicKey: string; address: string }> {
  const r = await new Eth(t).getAddress(ledgerPath(path), false, false);
  return { publicKey: r.publicKey, address: r.address };
}

const rsOf = (r: string, s: string): Uint8Array => concat(fromHex(r.padStart(64, "0")), fromHex(s.padStart(64, "0")));

export function personalDigest(message: Uint8Array): Uint8Array {
  return keccak_256(concat(utf8(`\x19Ethereum Signed Message:\n${message.length}`), message));
}

export async function ethSign(
  t: Transport,
  path: string,
  payload: SignablePayload,
  publicKey: string,
  resolver: EthResolver,
  loadConfig?: EthLoadConfig,
): Promise<Signature> {
  const raw = payload.raw;
  if (!raw) throw HardwareErrors.needsDeviceView("this Ethereum request");
  const eth = new Eth(t, undefined, loadConfig);
  const p = ledgerPath(path);
  switch (raw.format) {
    case "evm-tx": {
      if (!equal(keccak_256(raw.bytes), payload.bytes)) throw HardwareErrors.badSignature("raw tx does not hash to the approved digest");
      const rawHex = toHex(raw.bytes);
      const resolution = await resolver(rawHex);
      const r = await eth.signTransaction(p, rawHex, resolution);
      return ecdsaSignature(rsOf(r.r, r.s), payload.bytes, publicKey);
    }
    case "evm-personal": {
      if (!equal(personalDigest(raw.bytes), payload.bytes)) throw HardwareErrors.badSignature("message does not hash to the approved digest");
      const r = await eth.signPersonalMessage(p, toHex(raw.bytes));
      return ecdsaSignature(rsOf(r.r, r.s), payload.bytes, publicKey);
    }
    case "eip712": {
      const td = JSON.parse(new TextDecoder().decode(raw.bytes)) as TypedDataDefinition & { types: Record<string, unknown> };
      if (!equal(fromHex(hashTypedData(td)), payload.bytes)) throw HardwareErrors.badSignature("typed data does not hash to the approved digest");
      let r: { r: string; s: string };
      try {
        r = await eth.signEIP712Message(p, td as unknown as Parameters<Eth["signEIP712Message"]>[1]);
      } catch (e) {
        // Nano S (and old app versions) only have the hashed variant: the device shows two hashes.
        const sw = (e as { statusCode?: number }).statusCode;
        if (sw !== SW.INS_NOT_SUPPORTED && sw !== SW.CLA_NOT_SUPPORTED) throw e;
        const loose = td as unknown as { domain?: object; types: object; primaryType: string; message: object };
        const domain = hashDomain({ domain: loose.domain ?? {}, types: loose.types } as never);
        const message = hashStruct({ data: loose.message, primaryType: loose.primaryType, types: loose.types } as never);
        r = await eth.signEIP712HashedMessage(p, domain.slice(2), message.slice(2));
      }
      return ecdsaSignature(rsOf(r.r, r.s), payload.bytes, publicKey);
    }
    default:
      throw HardwareErrors.unsupported("this kind of Ethereum request");
  }
}
