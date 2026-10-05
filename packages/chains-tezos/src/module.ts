import {
  type Account,
  type AssetRef,
  type ChainContext,
  type ChainModule,
  ClipError,
  type DappRequest,
  type DecodedRequest,
  type Network,
  type Nft,
  type Signature,
  type SignablePayload,
  type TokenBalance,
  type Warning,
  WALLET_ORIGIN,
} from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { type BuiltOperation, type PartialTezosOperation, ProtocolsHash, buildOperation, normalizeOperations } from "./build.js";
import { describeOperations } from "./describe.js";
import {
  blake2b256,
  concat,
  encodePublicKey,
  formatUnits,
  fromHex,
  hex,
  hostOf,
  isTezosAddress,
  operationHash,
  randomId,
  signatureToEdsig,
  textOf,
  tz1FromPublicKey,
} from "./encoding.js";
import { fromChainId, networkNameOf, tokenRef, xtzAsset } from "./networks.js";
import { RpcError, type Tzkt, plainTezosError, rpcFor, tzktFor } from "./rpc.js";
import { type SigningType, describeMicheline, describeText, parseOperationPayload, signPayload } from "./sign.js";
import { type StakePosition, createStaking } from "./staking.js";
import { fungibleBalances, nftsFrom, tokenBalances } from "./tokens.js";

/** WalletConnect Tezos methods (docs.reown.com/advanced/multichain/rpc-reference/tezos-rpc); 1Mask maps Beacon onto them. */
export const TEZOS_METHODS = {
  getAccounts: "tezos_getAccounts",
  send: "tezos_send",
  sign: "tezos_sign",
} as const;

export interface TezosModuleOptions {
  /** Run simulate_operation in decode()/prepare() (default true). With false, default limits are used. */
  simulate?: boolean;
  ipfsGateway?: string;
  /** Protocol for local forging (default: Ushuaia, PsUshuai9…, active on mainnet and shadownet in Oct 2026). */
  protocol?: ProtocolsHash;
  /** How long a decoded operation can be reused by prepare() before it is rebuilt (ms, default 120 s). */
  reuseMs?: number;
  now?: () => number;
}

export type Normalized =
  | { kind: "accounts" }
  | { kind: "send"; operations: PartialTezosOperation[]; notes: string[] }
  | { kind: "sign"; signingType: SigningType; bytes: Uint8Array };

/** One getAccounts entry (WalletConnect `tezos_getAccounts` result shape). */
export function accountsResult(account: Account): { algo: "ed25519"; address: string; pubkey: string }[] {
  return [{ algo: "ed25519", address: account.address, pubkey: encodePublicKey(fromHex(account.publicKey)) }];
}

export function normalize(request: DappRequest, me: string): Normalized {
  const p = (request.params ?? {}) as Record<string, unknown>;
  const checkAccount = (a: unknown) => {
    if (a != null && a !== me) throw new ClipError("This request is for a different account than the one you connected.", "tezos/wrong-account");
  };
  switch (request.method) {
    case TEZOS_METHODS.getAccounts:
      return { kind: "accounts" };
    case TEZOS_METHODS.send: {
      checkAccount(p.account);
      checkAccount(p.sourceAddress);
      if (typeof p.network === "string" && fromChainId(p.network) !== request.networkId) {
        throw new ClipError("This app is asking for a different Tezos network than the one it's connected to.", "tezos/network-mismatch");
      }
      // Notes only from the wallet itself (staking builders), never from a dapp.
      const notes = request.origin === "clip-wallet" && Array.isArray(p.notes) ? p.notes.filter((n): n is string => typeof n === "string") : [];
      return { kind: "send", operations: normalizeOperations(p.operations, me), notes };
    }
    case TEZOS_METHODS.sign: {
      checkAccount(p.account);
      checkAccount(p.sourceAddress);
      const s = signPayload(p);
      return { kind: "sign", signingType: s.signingType, bytes: s.bytes };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this Tezos request yet.", "tezos/unsupported-method");
  }
}

/**
 * A wallet-built `tezos_send` request (origin "clip-wallet", so its `notes` are shown on the approval screen).
 * Goes through the normal decode → approve → prepare → finalize path like any dapp request.
 */
export function tezosSendRequest(ctx: ChainContext, operations: PartialTezosOperation[], notes: string[] = []): DappRequest {
  return {
    id: randomId(),
    origin: WALLET_ORIGIN,
    via: "injected",
    family: "tezos",
    networkId: ctx.network.id,
    method: TEZOS_METHODS.send,
    params: { account: ctx.account.address, operations, ...(notes.length ? { notes } : {}) },
  };
}

const xtzText = (v: bigint) => `${formatUnits(v, 6)} XTZ`;
const HIGH_FEE_MUTEZ = 1_000_000n;

export type TezosModule = ChainModule & {
  normalize: typeof normalize;
  accountsResult: typeof accountsResult;
  encodePublicKey: typeof encodePublicKey;
  staking: {
    getPositions(ctx: ChainContext): Promise<StakePosition[]>;
    buildStake(p: { validator: string; amount: string }, ctx: ChainContext): Promise<DappRequest>;
    buildUnstake(p: { validator: string; amount: string }, ctx: ChainContext): Promise<DappRequest>;
    buildWithdraw(p: { validator: string }, ctx: ChainContext): Promise<DappRequest>;
    buildStopDelegating(ctx: ChainContext): Promise<DappRequest>;
  };
};

export function createTezosModule(options: TezosModuleOptions = {}): TezosModule {
  const gateway = options.ipfsGateway ?? "https://ipfs.io/ipfs/";
  const protocol = options.protocol ?? ProtocolsHash.PsUshuai9;
  const now = options.now ?? Date.now;
  const reuseMs = options.reuseMs ?? 120_000;

  /**
   * Built operations by request id. decode() builds (and simulates) once; prepare() signs exactly that build if it is
   * fresh, and records the approval; finalize() assembles that same build. Forged bytes therefore never change
   * between what the user saw, what the vault signed and what is injected.
   */
  const builds = new Map<string, { built: BuiltOperation; approvalId?: string }>();

  const meOf = (ctx: ChainContext) => ctx.account.address;
  const pubOf = (ctx: ChainContext) => fromHex(ctx.account.publicKey);
  const chainIdOf = (ctx: ChainContext) => ctx.network.id.replace(/^tezos:/, "");
  const tzktOrNull = (ctx: ChainContext): Tzkt | null => (ctx.network.indexerUrl ? tzktFor(ctx) : null);

  async function build(request: DappRequest, ops: PartialTezosOperation[], ctx: ChainContext): Promise<BuiltOperation> {
    const built = await buildOperation(rpcFor(ctx), ops, {
      me: meOf(ctx),
      publicKey: encodePublicKey(pubOf(ctx)),
      chainId: chainIdOf(ctx),
      simulate: options.simulate ?? true,
      protocol,
      now,
    });
    builds.set(request.id, { built });
    if (builds.size > 64) builds.delete(builds.keys().next().value!);
    return built;
  }

  async function currentDelegate(ctx: ChainContext): Promise<{ address: string; alias?: string } | null> {
    const tzkt = tzktOrNull(ctx);
    if (!tzkt) return null;
    const a = await tzkt.get<{ delegate?: { address: string; alias?: string } | null } | null>(`/v1/accounts/${meOf(ctx)}`).catch(() => null);
    return a?.delegate ?? null;
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const me = meOf(ctx);
    const n = normalize(request, me);
    const base = { requestId: request.id, networkId: request.networkId };
    const host = hostOf(request.origin);

    if (n.kind === "accounts") {
      return { ...base, title: `Share your Tezos address with ${host}`, lines: [{ label: "Address", value: me }], balanceChanges: [], simulated: false, blind: false, warnings: [] };
    }

    if (n.kind === "send") {
      const built = await build(request, n.operations, ctx);
      const hasStaking = built.contents.some((c) => c.kind === "transaction" && c.destination === me && c.parameters);
      const d = await describeOperations(built.contents, {
        networkId: ctx.network.id,
        me,
        tzkt: tzktOrNull(ctx),
        delegate: hasStaking ? await currentDelegate(ctx) : null,
      });
      const warnings: Warning[] = [...d.warnings];
      if (built.simulationError) warnings.push({ level: "danger", code: "simulation-failed", message: built.simulationError });
      const total = built.fees + built.maxBurn;
      if (built.fees > HIGH_FEE_MUTEZ) warnings.push({ level: "caution", code: "high-fee", message: `The network fee is ${xtzText(built.fees)}, which is unusually high.` });
      const lines = [...d.lines, ...n.notes.map((value) => ({ label: "Note", value })), { label: "Network fee", value: xtzText(built.fees) }];
      if (built.maxBurn > 0n) lines.push({ label: "Storage", value: `up to ${xtzText(built.maxBurn)} (paid once to the network for storing data)` });
      return {
        ...base,
        title: d.title,
        lines,
        balanceChanges: d.balanceChanges,
        fee: { asset: xtzAsset(ctx.network.id), amount: total.toString() },
        simulated: built.simulated,
        blind: d.blind,
        warnings,
      };
    }

    // tezos_sign
    if (n.signingType === "operation" || (n.signingType === "raw" && n.bytes[0] === 0x03)) {
      const parsed = await parseOperationPayload(n.bytes, protocol);
      if (!parsed) throw new ClipError("This app wants a signature on an operation Clip Wallet can't read. It won't sign it.", "tezos/unreadable-operation");
      if (parsed.contents.some((c) => c.source !== undefined && c.source !== me)) {
        throw new ClipError("This operation is for a different account than the one you connected.", "tezos/wrong-account");
      }
      const d = await describeOperations(parsed.contents, { networkId: ctx.network.id, me, tzkt: tzktOrNull(ctx) });
      const fees = parsed.contents.reduce((a, c) => a + BigInt(typeof c.fee === "string" ? c.fee : "0"), 0n);
      return {
        ...base,
        title: `Sign an operation for ${host}: ${d.title}`,
        lines: [...d.lines, { label: "Network fee", value: xtzText(fees) }, { label: "Sent by", value: `${host} (it gets the signed operation and can send it whenever it wants)` }],
        balanceChanges: d.balanceChanges,
        fee: { asset: xtzAsset(ctx.network.id), amount: fees.toString() },
        simulated: false,
        blind: true,
        warnings: [
          ...d.warnings,
          {
            level: "danger",
            code: "blind-signing",
            message: `${host} asks you to sign a whole operation instead of letting Clip Wallet build it. Clip Wallet couldn't check its fee or simulate it. Only sign if you trust ${host}.`,
          },
        ],
      };
    }
    if (n.signingType === "micheline" || (n.signingType === "raw" && n.bytes[0] === 0x05)) {
      const v = describeMicheline(n.bytes, request.origin);
      return { ...base, title: v.title, lines: v.lines, balanceChanges: [], simulated: false, blind: v.blind, warnings: v.warnings };
    }
    const text = textOf(n.bytes);
    if (text != null) {
      const v = describeText(text, request.origin);
      return {
        ...base,
        title: v.title,
        lines: v.lines,
        balanceChanges: [],
        simulated: false,
        blind: false,
        warnings: [...v.warnings, { level: "caution", code: "blind-signing", message: "This is a raw signature request. Only sign it if you trust the app." }],
      };
    }
    return {
      ...base,
      title: `Sign data for ${host}`,
      lines: [{ label: "Data (not text)", value: `0x${hex(n.bytes).slice(0, 400)}${n.bytes.length > 200 ? "…" : ""}` }],
      balanceChanges: [],
      simulated: false,
      blind: true,
      warnings: [{ level: "danger", code: "blind-signing", message: "This isn't readable text. Only sign it if you trust the app." }],
    };
  }

  /** The exact bytes the vault signs: blake2b-256(0x03 ‖ forged operation) for tezos_send, blake2b-256(payload) for tezos_sign. */
  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const n = normalize(request, meOf(ctx));
    if (n.kind === "accounts") return [];
    if (n.kind === "sign") {
      if (n.signingType === "operation" || (n.signingType === "raw" && n.bytes[0] === 0x03)) {
        if (!(await parseOperationPayload(n.bytes, protocol))) {
          throw new ClipError("This app wants a signature on an operation Clip Wallet can't read. It won't sign it.", "tezos/unreadable-operation");
        }
      }
      return [{ accountId: ctx.account.id, scheme: "ed25519", bytes: blake2b256(n.bytes), approvalId }];
    }
    let entry = builds.get(request.id);
    if (!entry || now() - entry.built.createdAt > reuseMs || entry.approvalId) {
      const shown = entry?.built;
      await build(request, n.operations, ctx);
      entry = builds.get(request.id)!;
      // Audit TEZ-02: a rebuild after approval may only cost what the screen showed (fees and worst-case storage
      // burn); the operations' contents come from the same request, but limits and fees are re-estimated.
      if (shown && (entry.built.fees > shown.fees || entry.built.maxBurn > shown.maxBurn || entry.built.contents.length !== shown.contents.length)) {
        builds.delete(request.id);
        throw new ClipError("This now costs more than you were shown, so it wasn't sent. Ask the app to try again.", "tezos/fee-changed");
      }
    }
    if (entry.built.simulationError) throw new ClipError(entry.built.simulationError, "tezos/simulation-failed");
    entry.approvalId = approvalId;
    return [{ accountId: ctx.account.id, scheme: "ed25519", bytes: blake2b256(concat(new Uint8Array([0x03]), fromHex(entry.built.forged))), approvalId }];
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(request, meOf(ctx));
    if (n.kind === "accounts") return accountsResult(ctx.account);
    const pub = pubOf(ctx);
    const check = (bytes: Uint8Array) => {
      const sig = signatures[0];
      if (signatures.length !== 1 || !sig || sig.scheme !== "ed25519" || sig.bytes.length !== 64 || !ed25519.verify(sig.bytes, bytes, pub)) {
        throw new ClipError("The signature didn't match. Nothing was sent.", "tezos/bad-signature");
      }
      return sig.bytes;
    };
    if (n.kind === "sign") return { signature: signatureToEdsig(check(blake2b256(n.bytes))) };

    const entry = builds.get(request.id);
    if (!entry?.approvalId) throw new ClipError("This request expired before it was sent. Nothing was sent. Please try again.", "tezos/expired");
    const forged = fromHex(entry.built.forged);
    const sig = check(blake2b256(concat(new Uint8Array([0x03]), forged)));
    const signed = concat(forged, sig);
    let hash: string;
    try {
      hash = await rpcFor(ctx).inject(hex(signed));
    } catch (e) {
      if (e instanceof RpcError) throw new ClipError(plainTezosError(e.errors), "tezos/send-failed", e);
      throw e;
    }
    builds.delete(request.id);
    return { operationHash: typeof hash === "string" && hash.startsWith("o") ? hash : operationHash(signed) };
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const tzkt = tzktFor(ctx);
    const me = meOf(ctx);
    const acct = await tzkt.get<{ balance?: number | string; stakedBalance?: number | string; unstakedBalance?: number | string } | null>(`/v1/accounts/${me}`);
    // TzKT `balance` is the full balance; staked and unstaked XTZ can't be spent, so they show under staking.
    const full = BigInt(acct?.balance ?? 0);
    const spendable = full - BigInt(acct?.stakedBalance ?? 0) - BigInt(acct?.unstakedBalance ?? 0);
    const out: TokenBalance[] = [{ asset: xtzAsset(ctx.network.id), amount: (spendable > 0n ? spendable : 0n).toString() }];
    return [...out, ...fungibleBalances(ctx.network.id, await tokenBalances(tzkt, me))];
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    return nftsFrom(ctx.network.id, await tokenBalances(tzktFor(ctx), meOf(ctx)), gateway);
  }

  const sendRequest = tezosSendRequest;

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const me = meOf(ctx);
    const to = p.to.trim();
    if (!isTezosAddress(to)) throw new ClipError("That doesn't look like a Tezos address.", "tezos/bad-address");
    if (to === me) throw new ClipError("That's your own address.", "tezos/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "tezos/bad-amount");
    if (!p.asset.address && p.asset.key === "xtz") return sendRequest(ctx, [{ kind: "transaction", amount: p.amount, destination: to }]);

    const ref = tokenRef(p.asset);
    if (!ref) throw new ClipError("Clip Wallet can't send this token.", "tezos/unknown-token");
    const info = (await tzktFor(ctx).get<{ standard?: string }[]>(`/v1/tokens?contract=${ref.contract}&tokenId=${ref.tokenId}`))?.[0];
    if (!info) throw new ClipError("That token couldn't be found on Tezos.", "tezos/unknown-token");
    const value =
      info.standard === "fa1.2"
        ? { prim: "Pair", args: [{ string: me }, { prim: "Pair", args: [{ string: to }, { int: p.amount }] }] }
        : info.standard === "fa2"
          ? [{ prim: "Pair", args: [{ string: me }, [{ prim: "Pair", args: [{ string: to }, { prim: "Pair", args: [{ int: ref.tokenId }, { int: p.amount }] }] }]] }]
          : null;
    if (!value) throw new ClipError("Clip Wallet can't send this kind of token yet.", "tezos/unsupported-token");
    return sendRequest(ctx, [{ kind: "transaction", amount: "0", destination: ref.contract, parameters: { entrypoint: "transfer", value } }]);
  }

  const staking = createStaking({ sendRequest, tzktFor, meOf });

  return {
    family: "tezos",
    curve: "ed25519",
    /** BIP-44 coin type 1729 (SLIP-44 "Tezos"), all hardened, as Temple and Kukai derive it. */
    derivationPath: (index: number) => `m/44'/1729'/${index}'/0'`,
    addressFromPublicKey: (publicKey: Uint8Array, _network: Network) => tz1FromPublicKey(publicKey),
    isAddress: (value: string) => isTezosAddress(value),
    /** The same address works on every Tezos network. */
    networksForAddress: (value: string, candidates: Network[]) =>
      isTezosAddress(value) ? candidates.filter((c) => c.family === "tezos" && networkNameOf(c.id) !== null) : [],
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
    accountsResult,
    encodePublicKey,
    staking,
  };
}
