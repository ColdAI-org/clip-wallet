import {
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
  isWalletOrigin,
  msg,
  titled,
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha224 } from "@noble/hashes/sha2.js";
import { type Content, IcClient, IcRejectError, callContent, envelope, readStateContent, requestId, requestStatus, signDigest } from "./agent.js";
import { type CValue, decode as candidDecode, encode as candidEncode, named } from "./candid.js";
import { cborEncode } from "./cbor.js";
import { Account, METHODS, plainTransferError } from "./ledger.js";
import { type LedgerSpec, assetOfLedger, ledgerOf, ledgersFor, netOf } from "./networks.js";
import {
  type IcrcAccount,
  accountIdFromHex,
  accountIdentifier,
  icrcAccountFromText,
  icrcAccountToText,
  isSelfAuthenticating,
  principalFromText,
  principalToText,
} from "./principal.js";
import { b64decode, b64encode, bytesEqual, concat, formatUnits, hex, hostOf, randomBytes, randomId, short, sleep } from "./util.js";

/**
 * Request method. The wallet's own transfers use the ICRC-49 `icrc49_call_canister` params ({ canisterId, sender,
 * method, arg (base64 Candid), nonce? }) plus `ingressExpiry` (nanoseconds, decimal string), so the content the user
 * approves is fixed before signing. Only the wallet may send it: there's no injected ICP provider (see README).
 * https://github.com/dfinity/wg-identity-authentication/blob/main/topics/icrc_49_call_canister.md
 */
export const ICP_METHODS = { callCanister: "icrc49_call_canister" } as const;

/** How long a wallet-built call stays valid (the IC refuses ingress_expiry more than 5 minutes ahead). */
export const INGRESS_WINDOW_MS = 4 * 60 * 1000;

/** DER SubjectPublicKeyInfo prefix of an uncompressed secp256k1 key (id-ecPublicKey, secp256k1), as @dfinity/identity-secp256k1. */
const DER_PREFIX = Uint8Array.from([0x30, 0x56, 0x30, 0x10, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x0a, 0x03, 0x42, 0x00]);

export function derPublicKey(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 33 && publicKey.length !== 65) throw new Error("ICP needs a secp256k1 public key");
  return concat(DER_PREFIX, secp256k1.Point.fromBytes(publicKey).toBytes(false));
}

/** Self-authenticating principal: SHA-224(DER key) ‖ 0x02. */
export function principalOfKey(publicKey: Uint8Array): Uint8Array {
  return concat(sha224(derPublicKey(publicKey)), Uint8Array.of(0x02));
}

/** The ICP ledger account identifier (hex) of a principal's default subaccount: what exchanges ask for. */
export function accountIdOf(principalText: string): string {
  const p = principalFromText(principalText);
  if (!p) throw new ClipError("That address isn't valid. Check it and try again.", "icp/bad-address");
  return hex(accountIdentifier(p));
}

export type Recipient = { kind: "account"; account: IcrcAccount; text: string } | { kind: "accountId"; id: Uint8Array; text: string };

/** A principal, an ICRC-1 account text ("principal-checksum.subaccount") or a 64-hex ICP account identifier. */
export function parseRecipient(value: string): Recipient | null {
  const t = value.trim();
  const id = accountIdFromHex(t);
  if (id) return { kind: "accountId", id, text: t.toLowerCase() };
  const account = icrcAccountFromText(t);
  return account ? { kind: "account", account, text: icrcAccountToText(account) } : null;
}

export interface IcpModuleOptions {
  /** read_state polls after a 202 (default 10) and the wait between them (default 1000 ms). */
  pollAttempts?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Clock (ms) for ingress expiry and created_at_time. */
  now?: () => number;
  /** Nonce source (16 bytes per call). */
  random?: (n: number) => Uint8Array;
}

export interface Normalized {
  ledger: LedgerSpec;
  method: "icrc1_transfer" | "transfer";
  arg: Record<string, CValue>;
  canisterId: Uint8Array;
  sender: Uint8Array;
  call: Content;
  callId: Uint8Array;
  readState: Content;
  readStateId: Uint8Array;
  ingressExpiry: bigint;
}

function bad(): ClipError {
  return new ClipError("This request from the app is malformed, so we stopped it.", "icp/bad-params");
}

/** Checks a wallet-built ledger call against the account and network and parses it. */
export function normalize(request: DappRequest, ctx: ChainContext): Normalized {
  if (!netOf(request.networkId) || request.networkId !== ctx.network.id) {
    throw new ClipError("This is for a different network, so Clip Wallet stopped it. Nothing was signed.", "icp/network-mismatch");
  }
  if (request.method !== ICP_METHODS.callCanister || !isWalletOrigin(request.origin)) {
    throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "icp/unsupported-method");
  }
  const p = (request.params ?? {}) as Record<string, unknown>;
  if (typeof p.sender !== "string" || p.sender !== ctx.account.address) {
    throw new ClipError("This request is for a different account than the one you're using.", "icp/wrong-account");
  }
  const ledger = typeof p.canisterId === "string" ? ledgerOf(ctx.network.id, p.canisterId) : null;
  if (!ledger) throw new ClipError("That token couldn't be found.", "icp/unknown-ledger");
  if (p.method !== "icrc1_transfer" && !(p.method === "transfer" && ledger.accountIds)) throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "icp/unsupported-method");
  if (typeof p.arg !== "string" || typeof p.ingressExpiry !== "string" || !/^\d{1,20}$/.test(p.ingressExpiry)) throw bad();
  const method = p.method;
  let argBytes: Uint8Array;
  let arg: Record<string, CValue>;
  let nonce: Uint8Array | undefined;
  try {
    argBytes = b64decode(p.arg);
    const values = candidDecode(argBytes);
    if (values.length !== 1) throw new Error("arity");
    arg = named(METHODS[method].arg, values[0]!) as Record<string, CValue>;
    // Byte-for-byte canonical: re-encoding must give the same bytes, so nothing hides in extra fields.
    if (!bytesEqual(candidEncode([METHODS[method].arg], [arg]), argBytes)) throw new Error("not canonical");
    if (p.nonce !== undefined) {
      nonce = b64decode(String(p.nonce));
      if (nonce.length > 32) throw new Error("nonce");
    }
  } catch (cause) {
    throw new ClipError("This transaction can't be read.", "icp/bad-transaction", cause);
  }
  if ((arg.from_subaccount as CValue[]).length) throw new ClipError("This transaction can't be read.", "icp/bad-transaction");
  const canisterId = principalFromText(ledger.canisterId)!;
  const sender = principalFromText(ctx.account.address);
  if (!sender) throw new ClipError("That address isn't valid. Check it and try again.", "icp/bad-address");
  const ingressExpiry = BigInt(p.ingressExpiry);
  const call = callContent({ canisterId, method, arg: argBytes, sender, ingressExpiry, ...(nonce ? { nonce } : {}) });
  const callId = requestId(call);
  const readState = readStateContent({ requestId: callId, sender, ingressExpiry });
  return { ledger, method, arg, canisterId, sender, call, callId, readState, readStateId: requestId(readState), ingressExpiry };
}

interface Transfer {
  to: string;
  toAccountId: boolean;
  amount: bigint;
  fee: bigint;
  memo: string | null;
}

function transferOf(n: Normalized): Transfer {
  if (n.method === "transfer") {
    const a = n.arg as { to: Uint8Array; amount: { e8s: bigint }; fee: { e8s: bigint }; memo: bigint };
    return { to: hex(a.to), toAccountId: true, amount: a.amount.e8s, fee: a.fee.e8s, memo: a.memo ? a.memo.toString() : null };
  }
  const a = n.arg as { to: { owner: Uint8Array; subaccount: Uint8Array[] }; amount: bigint; fee: bigint[]; memo: Uint8Array[] };
  return {
    to: icrcAccountToText({ owner: a.to.owner, ...(a.to.subaccount[0] ? { subaccount: a.to.subaccount[0] } : {}) }),
    toAccountId: false,
    amount: a.amount,
    fee: a.fee[0] ?? -1n,
    memo: a.memo[0] ? hex(a.memo[0]) : null,
  };
}

export interface IcpModule extends ChainModule {
  normalize: typeof normalize;
}

export function createIcpModule(options: IcpModuleOptions = {}): IcpModule {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? randomBytes;
  const wait = options.sleep ?? sleep;
  const attempts = options.pollAttempts ?? 10;
  const pollMs = options.pollIntervalMs ?? 1000;

  function clientFor(ctx: ChainContext): IcClient {
    const host = ctx.network.rpcUrls[0];
    if (!host) throw new ClipError("No connection is set up for this network.", "icp/no-rpc");
    return new IcClient(host.replace(/\/$/, ""), ctx.fetch);
  }

  const queryExpiry = () => BigInt(Math.floor((now() + 3 * 60 * 1000) / 60_000) * 60_000) * 1_000_000n;

  async function query(ctx: ChainContext, ledger: LedgerSpec, method: string, arg: Uint8Array): Promise<CValue> {
    let bytes: Uint8Array;
    try {
      bytes = await clientFor(ctx).query(principalFromText(ledger.canisterId)!, method, arg, queryExpiry());
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError("We couldn't reach the Internet Computer. Check your connection and try again.", "icp/offline", e);
    }
    const v = candidDecode(bytes);
    return v[0] as CValue;
  }

  async function balanceOf(ctx: ChainContext, ledger: LedgerSpec, owner: Uint8Array): Promise<bigint> {
    const v = await query(ctx, ledger, "icrc1_balance_of", candidEncode([Account], [{ owner, subaccount: [] }]));
    if (typeof v !== "bigint") throw new ClipError("We couldn't read your balance right now. Try again.", "icp/bad-reply");
    return v;
  }

  async function feeOf(ctx: ChainContext, ledger: LedgerSpec): Promise<bigint> {
    const v = await query(ctx, ledger, "icrc1_fee", candidEncode([], []));
    if (typeof v !== "bigint") throw new ClipError("We couldn't read the network fee right now. Try again.", "icp/bad-reply");
    return v;
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(req, ctx);
    if (n.ingressExpiry <= BigInt(now()) * 1_000_000n) throw new ClipError("This request expired. Try again.", "icp/expired");
    const t = transferOf(n);
    if (t.fee < 0n) throw new ClipError("This transaction can't be read.", "icp/bad-transaction");
    const asset = assetOfLedger(ctx.network.id, n.ledger);
    const amount = `${formatUnits(t.amount, asset.decimals)} ${asset.symbol}`;
    const lines = [{ label: "To", value: t.to }];
    if (t.memo) lines.push({ label: "Memo", value: t.memo });
    lines.push({ label: "Network fee", value: `${formatUnits(t.fee, asset.decimals)} ${asset.symbol}` });
    if (!isWalletOrigin(req.origin)) lines.push({ label: "Requested by", value: hostOf(req.origin) });
    const warnings: Warning[] = [];
    if (t.toAccountId) {
      const w = msg("bg.icp.toAccountId");
      warnings.push({ level: "info", code: "new-recipient", message: w.fallback, msg: w });
    }
    return {
      requestId: req.id,
      networkId: req.networkId,
      ...titled(msg("bg.req.sendTo", { amount, to: short(t.to) })),
      lines,
      balanceChanges: [{ asset, delta: (-(t.amount + t.fee)).toString() }],
      fee: { asset, amount: t.fee.toString() },
      simulated: false,
      blind: false,
      warnings,
    };
  }

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const n = normalize(req, ctx);
    // Two signatures: the call itself, and one read_state request for its status (only the call's sender may read
    // it; it can be re-sent until it expires), so polling needs no further approval.
    return [n.callId, n.readStateId].map((id) => ({ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: signDigest(id), approvalId }));
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(req, ctx);
    const pub = Uint8Array.from(ctx.account.publicKey.match(/../g)?.map((x) => parseInt(x, 16)) ?? []);
    let der: Uint8Array;
    try {
      der = derPublicKey(pub);
    } catch {
      throw new ClipError("The signature didn't match. Nothing was sent.", "icp/bad-signature");
    }
    if (!bytesEqual(principalOfKey(pub), n.sender)) throw new ClipError("This request is for a different account than the one you're using.", "icp/wrong-account");
    const digests = [signDigest(n.callId), signDigest(n.readStateId)];
    if (signatures.length !== 2) throw new ClipError("Some signatures are missing. Nothing was sent.", "icp/bad-signature");
    digests.forEach((d, i) => {
      const s = signatures[i]!;
      if (s.scheme !== "ecdsa-secp256k1" || s.bytes.length !== 64 || !secp256k1.verify(s.bytes, d, pub, { prehash: false })) {
        throw new ClipError("The signature didn't match. Nothing was sent.", "icp/bad-signature");
      }
    });
    if (n.ingressExpiry <= BigInt(now()) * 1_000_000n) throw new ClipError(msg("bg.icp.expired"), "icp/expired");

    const client = clientFor(ctx);
    const callBody = envelope(n.call, { publicKeyDer: der, signature: signatures[0]!.bytes });
    const readBody = envelope(n.readState, { publicKeyDer: der, signature: signatures[1]!.bytes });
    let certificate: Uint8Array | null;
    try {
      certificate = await client.call(n.canisterId, callBody);
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError(plainRejection(e), "icp/send-failed", e);
    }
    let status = certificate ? requestStatus(certificate, n.callId) : null;
    for (let k = 0; k < attempts && !isFinal(status); k++) {
      if (pollMs > 0) await wait(pollMs);
      try {
        certificate = await client.readState(n.canisterId, readBody);
        status = requestStatus(certificate, n.callId);
      } catch {
        /* keep polling */
      }
    }
    const base = { requestId: hex(n.callId), contentMap: b64encode(cborEncode(n.call as never)), ...(certificate ? { certificate: b64encode(certificate) } : {}) };
    if (!status || !isFinal(status)) return { ...base, status: "pending" };
    if (status.status !== "replied" || !status.reply) {
      throw new ClipError("The Internet Computer rejected this transfer. Nothing was sent.", "icp/rejected", status.rejectMessage);
    }
    // The reply is read from an UNVERIFIED certificate: it reports the outcome; nothing is decided on it.
    let result: Record<string, CValue>;
    try {
      result = named(METHODS[n.method].result, candidDecode(status.reply)[0]!) as Record<string, CValue>;
    } catch {
      return { ...base, status: "replied" };
    }
    if ("Err" in result) {
      const asset = assetOfLedger(ctx.network.id, n.ledger);
      throw new ClipError(plainTransferError(result.Err as Record<string, CValue>, asset.symbol, asset.decimals), "icp/transfer-failed", result.Err);
    }
    return { ...base, status: "replied", blockIndex: String(result.Ok) };
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const owner = principalFromText(ctx.account.address);
    if (!owner) throw new ClipError("That address isn't valid. Check it and try again.", "icp/bad-address");
    const ledgers = ledgersFor(ctx.network.id);
    const results = await Promise.all(ledgers.map((l, i) => balanceOf(ctx, l, owner).catch((e) => (i === 0 ? Promise.reject(e) : null))));
    const out: TokenBalance[] = [];
    ledgers.forEach((l, i) => {
      const v = results[i];
      if (v === null || v === undefined) return;
      if (i > 0 && v === 0n) return; // only tokens the account holds
      out.push({ asset: assetOfLedger(ctx.network.id, l), amount: v.toString() });
    });
    return out;
  }

  async function getNfts(): Promise<Nft[]> {
    // ICP NFTs (ICRC-7, EXT, DIP-721) have no shared index to list them from yet.
    return [];
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const me = principalFromText(ctx.account.address);
    if (!me) throw new ClipError("That address isn't valid. Check it and try again.", "icp/bad-address");
    const ledger = ledgerOf(ctx.network.id, p.asset);
    if (!ledger) throw new ClipError("That token couldn't be found.", "icp/unknown-ledger");
    const to = parseRecipient(p.to);
    if (!to) throw new ClipError("That address isn't valid. Check it and try again.", "icp/bad-address");
    if (to.kind === "accountId" && !ledger.accountIds) {
      throw new ClipError(`${ledger.symbol} can only be sent to a principal ID, not an account ID. Ask for their principal ID.`, "icp/account-id-unsupported");
    }
    const self = to.kind === "accountId" ? bytesEqual(to.id, accountIdentifier(me)) : bytesEqual(to.account.owner, me) && !to.account.subaccount;
    if (self) throw new ClipError("That's your own address.", "icp/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "icp/bad-amount");
    const amount = BigInt(p.amount);
    const [fee, balance] = await Promise.all([feeOf(ctx, ledger), balanceOf(ctx, ledger, me)]);
    if (balance < amount + fee) throw new ClipError(msg("bg.err.notEnoughForFee", { symbol: ledger.symbol }), "icp/insufficient-funds");
    const t = now();
    const createdAt = BigInt(t) * 1_000_000n;
    let method: "icrc1_transfer" | "transfer";
    let arg: Uint8Array;
    if (to.kind === "accountId") {
      method = "transfer";
      arg = candidEncode([METHODS.transfer.arg], [{ memo: 0n, amount: { e8s: amount }, fee: { e8s: fee }, from_subaccount: [], to: to.id, created_at_time: [{ timestamp_nanos: createdAt }] }]);
    } else {
      method = "icrc1_transfer";
      arg = candidEncode([METHODS.icrc1_transfer.arg], [
        { from_subaccount: [], to: { owner: to.account.owner, subaccount: to.account.subaccount ? [to.account.subaccount] : [] }, amount, fee: [fee], memo: [], created_at_time: [createdAt] },
      ]);
    }
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "icp",
      networkId: ctx.network.id,
      method: ICP_METHODS.callCanister,
      params: {
        canisterId: ledger.canisterId,
        sender: ctx.account.address,
        method,
        arg: b64encode(arg),
        nonce: b64encode(random(16)),
        ingressExpiry: (BigInt(t + INGRESS_WINDOW_MS) * 1_000_000n).toString(),
      },
    };
  }

  return {
    family: "icp",
    curve: "secp256k1",
    /** Plug, `dfx identity import`, @dfinity/identity-secp256k1 fromSeedPhrase: BIP-44 coin 223. */
    derivationPath: (index: number) => `m/44'/223'/0'/0/${index}`,
    addressFromPublicKey(publicKey: Uint8Array, _network: Network): string {
      return principalToText(principalOfKey(publicKey));
    },
    /** A principal (with its checksum), an ICRC-1 account text, or a 64-hex ICP account identifier (checksum checked). */
    isAddress: (value: string) => parseRecipient(value) !== null,
    networksForAddress: (value: string, candidates: Network[]) => (parseRecipient(value) ? candidates.filter((c) => c.family === "icp") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
  };
}

function isFinal(s: { status: string } | null): boolean {
  return !!s && (s.status === "replied" || s.status === "rejected" || s.status === "done");
}

function plainRejection(e: unknown): string {
  const m = e instanceof Error ? e.message.toLowerCase() : "";
  if (/expir/.test(m)) return "This transfer expired before it reached the network. Nothing was sent. Try again.";
  if (/signature|invalid.*(sig|key)/.test(m)) return "The network didn't accept the signature. Nothing was sent.";
  if (/429|rate/.test(m)) return "The Internet Computer is busy right now. Nothing was sent. Try again in a minute.";
  if (e instanceof IcRejectError && e.rejectCode) return "The Internet Computer rejected this transfer. Nothing was sent.";
  return "The Internet Computer didn't accept this transfer. Nothing was sent.";
}

export { isSelfAuthenticating };
