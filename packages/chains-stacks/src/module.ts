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
  WALLET_ORIGIN,
  msg,
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { Hiro, HiroError, plainStacksError } from "./api.js";
import { type StacksNet, addressOfKey, netOfVersion, parseAddress, parseAssetId, parseContractId } from "./c32.js";
import { type CV, cvFrom, cvText } from "./clarity.js";
import { type DescribeContext, describeTx } from "./describe.js";
import { isDomain, messageHash, structuredHash } from "./message.js";
import { STACKS_NETS, knownToken, netOf, stxAsset, tokenAsset } from "./networks.js";
import {
  FT_CODES,
  NFT_CODES,
  PC_MODE,
  POX_CODES,
  type Payload,
  type PcPrincipal,
  type PostCondition,
  type StacksTx,
  AUTH_SPONSORED,
  HASH_MODE_P2PKH,
  assetInfoOf,
  deserializePostCondition,
  deserializeTx,
  memoBytes,
  originPresignDigest,
  recipientCV,
  serializePayload,
  serializeTx,
  txidOf,
  unsignedTx,
  withOriginSignature,
} from "./tx.js";
import { bytesEqual, fromHex, hash160, hex, hostOf, isHex, randomId, sleep, toBig, utf8 } from "./util.js";

/**
 * Request methods: the SIP-030 names (https://github.com/stacksgov/sips/blob/main/sips/sip-030/sip-030-wallet-interface.md),
 * which @stacks/connect v8 `request()` sends and WalletConnect's `stacks` namespace uses. Parameters as SIP-030 /
 * @stacks/connect `MethodParams`; Clarity values and post-conditions as hex or the SIP-030 JSON form.
 */
export const STACKS_METHODS = {
  transferStx: "stx_transferStx",
  transferSip10Ft: "stx_transferSip10Ft",
  transferSip9Nft: "stx_transferSip9Nft",
  callContract: "stx_callContract",
  deployContract: "stx_deployContract",
  signTransaction: "stx_signTransaction",
  signMessage: "stx_signMessage",
  signStructuredMessage: "stx_signStructuredMessage",
} as const;

const BUILD_METHODS = new Set<string>([
  STACKS_METHODS.transferStx,
  STACKS_METHODS.transferSip10Ft,
  STACKS_METHODS.transferSip9Nft,
  STACKS_METHODS.callContract,
  STACKS_METHODS.deployContract,
]);

export interface StacksModuleOptions {
  /** Hiro API override (one URL, or per NetworkId). Default: the network's rpcUrls[0]. */
  apiUrl?: string | Record<string, string>;
  /** Token metadata lookups per getBalances call (default 25); the rest show with their contract name. */
  maxMetadataLookups?: number;
}

export type StacksOp =
  | { kind: "build"; method: string; p: Record<string, unknown>; broadcast: boolean; sponsored: boolean }
  | { kind: "tx"; tx: StacksTx; broadcast: boolean }
  | { kind: "unreadable"; reason: unknown }
  | { kind: "message"; text: string }
  | { kind: "structured"; domain: CV; message: CV };

const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {});

function bad(what: string, cause?: unknown): ClipError {
  return new ClipError(`This request is missing its ${what}.`, "stacks/bad-params", cause);
}

function unreadable(cause?: unknown): ClipError {
  return new ClipError("This transaction can't be read.", "stacks/bad-transaction", cause);
}

function netName(networkId: string): StacksNet {
  const n = netOf(networkId);
  if (!n) throw new ClipError("That network isn't available in this wallet.", "stacks/unknown-network");
  return n;
}

/** The account's compressed key (Account.publicKey is hex, compressed for secp256k1). */
function publicKeyOf(ctx: ChainContext): Uint8Array {
  const raw = fromHex(ctx.account.publicKey);
  return raw.length === 33 ? raw : secp256k1.Point.fromBytes(raw).toBytes(true);
}

/** This account's address on the context's network (SP… mainnet, ST… testnet). */
export function addressOn(ctx: ChainContext): string {
  return addressOfKey(publicKeyOf(ctx), netName(ctx.network.id));
}

/** Checks method, network and account, and parses what can be parsed without the network. */
export function normalize(request: DappRequest, ctx: ChainContext): StacksOp {
  const n = netOf(request.networkId);
  if (!n || request.networkId !== ctx.network.id) {
    throw new ClipError("This app is asking for a different Stacks network than the one it's connected to.", "stacks/network-mismatch");
  }
  const p = obj(request.params);
  if (p.network !== undefined && p.network !== null && netOf(String(p.network)) !== n) {
    throw new ClipError("This app is asking for a different Stacks network than the one it's connected to.", "stacks/network-mismatch");
  }
  if (typeof p.address === "string" && p.address && p.address.trim().toUpperCase() !== addressOn(ctx)) {
    throw new ClipError("This request is for a different account than the one you connected.", "stacks/wrong-account");
  }
  switch (request.method) {
    case STACKS_METHODS.signMessage:
      if (typeof p.message !== "string") throw bad("message");
      return { kind: "message", text: p.message };
    case STACKS_METHODS.signStructuredMessage: {
      let domain: CV;
      let message: CV;
      try {
        domain = cvFrom(p.domain);
        message = cvFrom(p.message);
      } catch (e) {
        throw new ClipError("This request from the app is malformed, so we stopped it.", "stacks/bad-params", e);
      }
      if (!isDomain(domain)) throw new ClipError("This request from the app is malformed, so we stopped it.", "stacks/bad-params");
      return { kind: "structured", domain, message };
    }
    case STACKS_METHODS.signTransaction: {
      const t = p.transaction ?? p.txHex ?? p.tx;
      if (typeof t !== "string" || !t) throw bad("transaction");
      const broadcast = p.broadcast === true;
      try {
        if (!isHex(t)) throw new Error("not hex");
        return { kind: "tx", tx: deserializeTx(fromHex(t)), broadcast };
      } catch (reason) {
        return { kind: "unreadable", reason };
      }
    }
    default:
      if (BUILD_METHODS.has(request.method)) {
        const sponsored = p.sponsored === true;
        return { kind: "build", method: request.method, p, broadcast: !sponsored && p.broadcast !== false, sponsored };
      }
      throw new ClipError("Clip Wallet doesn't support this Stacks request yet.", "stacks/unsupported-method");
  }
}

/* ------------------------------------------------------------------ dapp params → transaction parts */

function principalForPc(address: unknown): PcPrincipal {
  if (address === "origin") return { kind: "origin" };
  if (typeof address !== "string") throw new Error("bad post-condition address");
  if (address.includes(".")) {
    const c = parseContractId(address);
    if (!c) throw new Error("bad post-condition contract");
    return { kind: "contract", contract: `${c.address}.${c.name}` };
  }
  const a = parseAddress(address);
  if (!a) throw new Error("bad post-condition address");
  return { kind: "standard", address: address.trim().toUpperCase() };
}

function amountOf(v: unknown): bigint {
  const b = toBig(v);
  if (b === null || b < 0n || b >= 1n << 64n) throw new Error("bad amount");
  return b;
}

/** A post-condition from hex (SIP-005) or the SIP-030 JSON form. */
export function postConditionFrom(input: unknown): PostCondition {
  if (typeof input === "string") {
    if (!isHex(input)) throw new Error("bad post-condition");
    return deserializePostCondition(fromHex(input));
  }
  const o = obj(input);
  const principal = principalForPc(o.address);
  const code = (table: Record<string, number>) => {
    const c = table[String(o.condition)];
    if (c === undefined) throw new Error("bad post-condition code");
    return c;
  };
  const asset = () => {
    const a = typeof o.asset === "string" ? assetInfoOf(o.asset) : null;
    if (!a) throw new Error("bad post-condition asset");
    return a;
  };
  switch (o.type) {
    case "stx-postcondition":
      return { type: "stx", principal, code: code(FT_CODES), amount: amountOf(o.amount) };
    case "ft-postcondition":
      return { type: "ft", principal, asset: asset(), code: code(FT_CODES), amount: amountOf(o.amount) };
    case "nft-postcondition":
      return { type: "nft", principal, asset: asset(), assetId: cvFrom(o.assetId), code: code(NFT_CODES) };
    case "staking-postcondition":
      return { type: "staking", principal, code: code(FT_CODES), amount: amountOf(o.amount) };
    case "pox-postcondition":
      return { type: "pox", principal, code: code(POX_CODES) };
    default:
      throw new Error("unknown post-condition type");
  }
}

function pcMode(v: unknown): number {
  if (v === undefined || v === null || v === "deny" || v === PC_MODE.deny) return PC_MODE.deny;
  if (v === "allow" || v === PC_MODE.allow) return PC_MODE.allow;
  if (v === "originator" || v === PC_MODE.originator) return PC_MODE.originator;
  throw new Error("bad post-condition mode");
}

/** Payload, post-conditions and mode for a build method's params (no network calls). */
export function buildParts(method: string, p: Record<string, unknown>, me: string): { payload: Payload; postConditions: PostCondition[]; mode: number } {
  const recipient = (v: unknown) => {
    if (typeof v !== "string") throw new Error("missing recipient");
    return recipientCV(v);
  };
  const pcs = Array.isArray(p.postConditions) ? p.postConditions.map((x) => postConditionFrom(x)) : [];
  switch (method) {
    case STACKS_METHODS.transferStx: {
      const amount = amountOf(p.amount);
      if (amount === 0n) throw new Error("zero amount");
      const memo = typeof p.memo === "string" ? p.memo : "";
      if (utf8(memo).length > 34) throw new ClipError(msg("bg.stacks.memoTooLong"), "stacks/bad-memo");
      const to = recipient(p.recipient);
      // Nodes refuse a transfer to its own sender (MemPoolRejection::TransferRecipientIsSender).
      if (to.type === "address" && to.value === me) throw new ClipError("That's your own address.", "stacks/self-transfer");
      return { payload: { type: "token-transfer", recipient: to, amount, memo: memoBytes(memo) }, postConditions: [], mode: PC_MODE.deny };
    }
    case STACKS_METHODS.transferSip10Ft: {
      const asset = typeof p.asset === "string" ? parseAssetId(p.asset) : null;
      if (!asset) throw new Error("bad asset");
      const amount = amountOf(p.amount);
      const args: CV[] = [{ type: "uint", value: amount }, { type: "address", value: me }, recipient(p.recipient), { type: "none" }];
      const own: PostCondition = { type: "ft", principal: { kind: "standard", address: me }, asset: { contract: asset.contract, assetName: asset.assetName }, code: FT_CODES.eq, amount };
      return { payload: { type: "contract-call", contract: asset.contract, functionName: "transfer", args }, postConditions: pcs.length ? pcs : [own], mode: pcMode(p.postConditionMode) };
    }
    case STACKS_METHODS.transferSip9Nft: {
      const asset = typeof p.asset === "string" ? parseAssetId(p.asset) : null;
      if (!asset) throw new Error("bad asset");
      const id = cvFrom(p.assetId);
      const args: CV[] = [id, { type: "address", value: me }, recipient(p.recipient)];
      const own: PostCondition = { type: "nft", principal: { kind: "standard", address: me }, asset: { contract: asset.contract, assetName: asset.assetName }, assetId: id, code: NFT_CODES.sent };
      return { payload: { type: "contract-call", contract: asset.contract, functionName: "transfer", args }, postConditions: pcs.length ? pcs : [own], mode: pcMode(p.postConditionMode) };
    }
    case STACKS_METHODS.callContract: {
      const c = typeof p.contract === "string" ? parseContractId(p.contract) : null;
      if (!c || typeof p.functionName !== "string" || !p.functionName) throw new Error("bad contract call");
      const args = Array.isArray(p.functionArgs) ? p.functionArgs.map((a) => cvFrom(a)) : [];
      return { payload: { type: "contract-call", contract: `${c.address}.${c.name}`, functionName: p.functionName, args }, postConditions: pcs, mode: pcMode(p.postConditionMode) };
    }
    case STACKS_METHODS.deployContract: {
      if (typeof p.name !== "string" || typeof p.clarityCode !== "string" || !p.clarityCode) throw new Error("bad deploy");
      const v = p.clarityVersion === undefined || p.clarityVersion === null ? undefined : Number(p.clarityVersion);
      if (v !== undefined && (!Number.isInteger(v) || v < 1 || v > 255)) throw new Error("bad clarity version");
      return { payload: { type: "smart-contract", name: p.name, code: p.clarityCode, ...(v !== undefined ? { clarityVersion: v } : {}) }, postConditions: pcs, mode: pcMode(p.postConditionMode) };
    }
  }
  throw new Error("not a build method");
}

/* ------------------------------------------------------------------ module */

export interface StacksModule extends ChainModule {
  normalize: typeof normalize;
  /** µSTX: total, locked by stacking, and what can be spent. */
  stxBalance(ctx: ChainContext): Promise<{ balance: string; locked: string; spendable: string }>;
  /** Polls /extended/v1/tx until the transaction leaves the mempool (or `attempts` run out). */
  txStatus(ctx: ChainContext, txid: string, opts?: { attempts?: number; intervalMs?: number }): Promise<"pending" | "success" | "failed" | "dropped">;
  receiveAddress(ctx: ChainContext): Promise<string>;
}

export function createStacksModule(options: StacksModuleOptions = {}): StacksModule {
  /** Transactions built from a dapp's params (or a wallet send), per request id, so prepare and finalize sign exactly what decode showed. */
  const built = new Map<string, StacksTx>();
  const metaCache = new Map<string, AssetRef>();

  function hiroFor(ctx: ChainContext): Hiro {
    const o = options.apiUrl;
    const url = (typeof o === "string" ? o : o?.[ctx.network.id]) ?? ctx.network.rpcUrls[0] ?? STACKS_NETS[netName(ctx.network.id)].api;
    return new Hiro(url, ctx.fetch);
  }

  async function token(ctx: ChainContext, assetId: string): Promise<AssetRef> {
    const key = `${ctx.network.id}|${assetId}`;
    const hit = metaCache.get(key);
    if (hit) return hit;
    let asset: AssetRef;
    if (knownToken(ctx.network.id, assetId)) asset = tokenAsset(ctx.network.id, assetId);
    else {
      const meta = await hiroFor(ctx).ftMetadata(assetId.split("::")[0]!);
      asset = tokenAsset(ctx.network.id, assetId, meta);
    }
    metaCache.set(key, asset);
    return asset;
  }

  async function tokenByContract(ctx: ChainContext, contract: string): Promise<AssetRef | null> {
    const known = STACKS_NETS[netName(ctx.network.id)].tokens.find((t) => t.assetId.startsWith(`${contract}::`));
    if (known) return token(ctx, known.assetId);
    const meta = await hiroFor(ctx).ftMetadata(contract);
    if (!meta || typeof meta.decimals !== "number") return null;
    return tokenAsset(ctx.network.id, `${contract}::${meta.symbol ?? "token"}`, meta);
  }

  function describeCtx(ctx: ChainContext, origin: string): DescribeContext {
    return {
      networkId: ctx.network.id,
      me: addressOn(ctx),
      host: hostOf(origin),
      token: (a) => token(ctx, a),
      tokenByContract: (c) => tokenByContract(ctx, c),
    };
  }

  /** Throws unless this account signs the transaction's origin on this network. */
  function checkTx(tx: StacksTx, ctx: ChainContext): void {
    const n = netName(ctx.network.id);
    if ((tx.version === 0x00) !== (n === "mainnet") || tx.chainId !== STACKS_NETS[n].chainId) {
      throw new ClipError("This app is asking for a different Stacks network than the one it's connected to.", "stacks/network-mismatch");
    }
    const o = tx.auth.origin;
    const mine = hash160(publicKeyOf(ctx));
    if (o.kind !== "single") {
      if (bytesEqual(o.signer, mine)) throw new ClipError(msg("bg.stacks.multisig"), "stacks/unsupported-multisig");
      throw new ClipError(msg("bg.stacks.notYourTx"), "stacks/wrong-account");
    }
    if (o.hashMode !== HASH_MODE_P2PKH || !bytesEqual(o.signer, mine)) throw new ClipError(msg("bg.stacks.notYourTx"), "stacks/wrong-account");
    // Recipients and principals in the transaction must be of this network (mainnet SP/SM vs testnet ST/SN).
    const p = tx.payload;
    const versionOk = (addr: string) => netOfVersion(parseAddress(addr.split(".")[0]!)?.version ?? -1) === n;
    if (p.type === "token-transfer" && p.recipient.type !== "none" && "value" in p.recipient && typeof p.recipient.value === "string" && !versionOk(p.recipient.value)) {
      throw new ClipError("This transaction is for a different Stacks network, so it wasn't sent.", "stacks/network-mismatch");
    }
    if (p.type === "contract-call" && !versionOk(p.contract)) {
      throw new ClipError("This transaction is for a different Stacks network, so it wasn't sent.", "stacks/network-mismatch");
    }
  }

  async function buildTx(op: Extract<StacksOp, { kind: "build" }>, ctx: ChainContext): Promise<StacksTx> {
    const me = addressOn(ctx);
    let parts: ReturnType<typeof buildParts>;
    try {
      parts = buildParts(op.method, op.p, me);
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError("This request from the app is malformed, so we stopped it.", "stacks/bad-params", e);
    }
    const n = netName(ctx.network.id);
    const hiro = hiroFor(ctx);
    const given = toBig(op.p.nonce);
    const nonce = given !== null ? given : await hiro.nextNonce(me).catch((e: unknown) => Promise.reject(plainStacksError(e)));
    const header = { mainnet: n === "mainnet", chainId: STACKS_NETS[n].chainId, signer: hash160(publicKeyOf(ctx)), nonce, fee: 0n, sponsored: op.sponsored };
    let tx = unsignedTx(header, parts.payload, parts.postConditions, parts.mode);
    if (!op.sponsored) {
      const given = toBig(op.p.fee);
      const fee = given ?? (await hiro.fee(serializePayload(parts.payload), serializeTx(tx).length));
      tx = unsignedTx({ ...header, fee }, parts.payload, parts.postConditions, parts.mode);
    }
    return tx;
  }

  async function txOf(req: DappRequest, op: StacksOp, ctx: ChainContext): Promise<StacksTx> {
    if (op.kind === "tx") {
      checkTx(op.tx, ctx);
      return op.tx;
    }
    if (op.kind === "unreadable") throw unreadable(op.reason);
    if (op.kind !== "build") throw new Error("not a transaction");
    let tx = built.get(req.id);
    if (!tx) {
      tx = await buildTx(op, ctx);
      built.set(req.id, tx);
    }
    checkTx(tx, ctx);
    return tx;
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const op = normalize(req, ctx);
    const host = hostOf(req.origin);
    const base = { requestId: req.id, networkId: req.networkId, simulated: false };

    if (op.kind === "message") {
      const title = msg("bg.req.signMessage", { host });
      return { ...base, title: title.fallback, titleMsg: title, lines: [{ label: "Message", value: op.text }], balanceChanges: [], blind: false, warnings: [] };
    }
    if (op.kind === "structured") {
      const n = netName(ctx.network.id);
      const t = op.domain.type === "tuple" ? op.domain.value : {};
      const name = t.name?.type === "ascii" ? t.name.value : "";
      const version = t.version?.type === "ascii" ? t.version.value : "";
      const chain = t["chain-id"]?.type === "uint" ? t["chain-id"].value : -1n;
      const title = msg("bg.req.signData", { host });
      const warnings: DecodedRequest["warnings"] = [];
      if (chain !== BigInt(STACKS_NETS[n].chainId)) {
        warnings.push({ level: "danger", code: "network-matters", message: "This signature is for a different network than the one selected." });
      }
      return {
        ...base,
        title: title.fallback,
        titleMsg: title,
        lines: [
          { label: "App", value: `${name} ${version}`.trim() },
          { label: "Data", value: cvText(op.message, 600) },
        ],
        balanceChanges: [],
        blind: false,
        warnings,
      };
    }
    if (op.kind === "unreadable") {
      const title = msg("bg.req.unreadableFrom", { host });
      return { ...base, title: title.fallback, titleMsg: title, lines: [], balanceChanges: [], blind: true, warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction." }] };
    }

    const tx = await txOf(req, op, ctx);
    const d = await describeTx(tx, describeCtx(ctx, req.origin));
    const lines = [...d.lines];
    if (op.kind === "tx" && !op.broadcast) lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });
    if (op.kind === "build" && op.sponsored) lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });
    return {
      ...base,
      title: d.title,
      ...(d.titleMsg ? { titleMsg: d.titleMsg } : {}),
      lines,
      balanceChanges: d.balanceChanges,
      fee: d.sponsored ? { asset: stxAsset(ctx.network.id), amount: "0", sponsored: true } : { asset: stxAsset(ctx.network.id), amount: d.fee.toString() },
      blind: d.blind,
      warnings: d.warnings,
    };
  }

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const op = normalize(req, ctx);
    const one = (bytes: Uint8Array): SignablePayload[] => [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes, approvalId }];
    if (op.kind === "message") return one(messageHash(op.text));
    if (op.kind === "structured") return one(structuredHash(op.domain, op.message));
    const tx = await txOf(req, op, ctx);
    return one(originPresignDigest(tx));
  }

  /** Verifies the vault's signature over `digest` and returns (r‖s low-S, recovery id) for this account's key. */
  function checkSignature(sig: Signature | undefined, digest: Uint8Array, ctx: ChainContext): { rs: Uint8Array; recovery: number } {
    const pub = publicKeyOf(ctx);
    if (!sig || sig.scheme !== "ecdsa-secp256k1" || sig.bytes.length !== 64) throw new ClipError("The signature didn't match. Nothing was sent.", "stacks/bad-signature");
    let s = secp256k1.Signature.fromBytes(sig.bytes, "compact");
    if (s.hasHighS()) s = new secp256k1.Signature(s.r, secp256k1.Point.CURVE().n - s.s);
    const rs = s.toBytes("compact");
    if (!secp256k1.verify(rs, digest, pub, { prehash: false })) throw new ClipError("The signature didn't match. Nothing was sent.", "stacks/bad-signature");
    for (const rec of [0, 1]) {
      try {
        if (bytesEqual(s.addRecoveryBit(rec).recoverPublicKey(digest).toBytes(true), pub)) return { rs, recovery: rec };
      } catch {
        /* next */
      }
    }
    throw new ClipError("The signature didn't match. Nothing was sent.", "stacks/bad-signature");
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const op = normalize(req, ctx);
    const pubHex = hex(publicKeyOf(ctx));
    if (op.kind === "message" || op.kind === "structured") {
      const digest = op.kind === "message" ? messageHash(op.text) : structuredHash(op.domain, op.message);
      const { rs, recovery } = checkSignature(signatures[0], digest, ctx);
      return { signature: hex(rs) + recovery.toString(16).padStart(2, "0"), publicKey: pubHex };
    }
    if (op.kind === "build" && !built.has(req.id)) {
      throw new ClipError("This request wasn't prepared for signing (or was already sent). Nothing was sent. Try again.", "stacks/not-prepared");
    }
    const tx = await txOf(req, op, ctx);
    const digest = originPresignDigest(tx);
    const { rs, recovery } = checkSignature(signatures[0], digest, ctx);
    const vrs = new Uint8Array(65);
    vrs[0] = recovery;
    vrs.set(rs, 1);
    const signed = withOriginSignature(tx, vrs);
    const raw = serializeTx(signed);
    const txid = hex(txidOf(raw));
    built.delete(req.id);
    const broadcast = op.kind === "tx" ? op.broadcast : op.kind === "build" && op.broadcast;
    if (!broadcast || signed.auth.type === AUTH_SPONSORED) return { transaction: hex(raw), txid };
    let sent: string;
    try {
      sent = await hiroFor(ctx).broadcast(raw);
    } catch (e) {
      throw plainStacksError(e);
    }
    return { txid: sent || txid, transaction: hex(raw) };
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const me = addressOn(ctx);
    const hiro = hiroFor(ctx);
    let b;
    try {
      b = await hiro.balances(me);
    } catch (e) {
      if (e instanceof HiroError) {
        // Fall back to the node for STX alone when the indexer is down.
        const a = await hiro.account(me).catch(() => null);
        if (a) return [{ asset: stxAsset(ctx.network.id), amount: a.balance.toString() }];
      }
      throw e instanceof ClipError ? e : plainStacksError(e);
    }
    const out: TokenBalance[] = [{ asset: stxAsset(ctx.network.id), amount: String(toBig(b.stx?.balance) ?? 0n) }];
    let lookups = options.maxMetadataLookups ?? 25;
    for (const [assetId, ft] of Object.entries(b.fungible_tokens ?? {})) {
      const amount = toBig(ft.balance);
      if (!amount || !parseAssetId(assetId)) continue;
      let asset: AssetRef;
      if (knownToken(ctx.network.id, assetId) || metaCache.has(`${ctx.network.id}|${assetId}`) || lookups-- > 0) asset = await token(ctx, assetId);
      else asset = tokenAsset(ctx.network.id, assetId);
      out.push({ asset, amount: amount.toString() });
    }
    return out;
  }

  async function stxBalance(ctx: ChainContext) {
    const a = await hiroFor(ctx).account(addressOn(ctx));
    const spendable = a.balance > a.locked ? a.balance - a.locked : 0n;
    return { balance: a.balance.toString(), locked: a.locked.toString(), spendable: spendable.toString() };
  }

  async function txStatus(ctx: ChainContext, txid: string, opts: { attempts?: number; intervalMs?: number } = {}) {
    const hiro = hiroFor(ctx);
    const attempts = opts.attempts ?? 10;
    for (let i = 0; i < attempts; i++) {
      const s = await hiro.tx(txid).catch(() => null);
      const st = s?.tx_status;
      if (st === "success") return "success" as const;
      if (st && st.startsWith("abort")) return "failed" as const;
      if (st && st.startsWith("dropped")) return "dropped" as const;
      if (i < attempts - 1) await sleep(opts.intervalMs ?? 2000);
    }
    return "pending" as const;
  }

  function checkRecipient(to: string, ctx: ChainContext): string {
    const t = to.trim();
    const n = netName(ctx.network.id);
    const contract = t.includes(".") ? parseContractId(t) : null;
    const addr = contract ?? parseAddress(t);
    if (!addr) throw new ClipError("That doesn't look like a Stacks address.", "stacks/bad-address");
    const v = netOfVersion(addr.version);
    if (v !== n) {
      throw new ClipError(
        msg(n === "mainnet" ? "bg.stacks.testAddressOnMainnet" : "bg.stacks.mainAddressOnTestnet"),
        "stacks/network-mismatch",
      );
    }
    const canonical = contract ? `${contract.address}.${contract.name}` : t.toUpperCase();
    if (canonical === addressOn(ctx)) throw new ClipError("That's your own address.", "stacks/self-transfer");
    return canonical;
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const to = checkRecipient(p.to, ctx);
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "stacks/bad-amount");
    const amount = BigInt(p.amount);
    if (amount >= 1n << 64n) throw new ClipError("That amount isn't valid. Check it and try again.", "stacks/bad-amount");
    const me = addressOn(ctx);
    const n = netName(ctx.network.id);
    const hiro = hiroFor(ctx);
    let account;
    let nonce;
    try {
      [account, nonce] = await Promise.all([hiro.account(me), hiro.nextNonce(me)]);
    } catch (e) {
      throw plainStacksError(e);
    }
    const spendable = account.balance > account.locked ? account.balance - account.locked : 0n;
    const header = { mainnet: n === "mainnet", chainId: STACKS_NETS[n].chainId, signer: hash160(publicKeyOf(ctx)), nonce, fee: 0n };

    let payload: Payload;
    let pcs: PostCondition[] = [];
    if (!p.asset.address) {
      payload = { type: "token-transfer", recipient: recipientCV(to), amount, memo: memoBytes("") };
    } else {
      const a = parseAssetId(p.asset.address);
      if (!a) throw new ClipError("That isn't a Stacks token.", "stacks/bad-asset");
      const held = toBig((await hiro.balances(me).catch((e) => Promise.reject(plainStacksError(e)))).fungible_tokens?.[p.asset.address]?.balance) ?? 0n;
      if (held < amount) throw new ClipError(msg("bg.err.notEnough", { symbol: p.asset.symbol }), "stacks/insufficient-token");
      payload = { type: "contract-call", contract: a.contract, functionName: "transfer", args: [{ type: "uint", value: amount }, { type: "address", value: me }, recipientCV(to), { type: "none" }] };
      pcs = [{ type: "ft", principal: { kind: "standard", address: me }, asset: { contract: a.contract, assetName: a.assetName }, code: FT_CODES.eq, amount }];
    }
    const draft = unsignedTx(header, payload, pcs);
    const fee = await hiro.fee(serializePayload(payload), serializeTx(draft).length + 65);
    const need = (p.asset.address ? 0n : amount) + fee;
    if (need > spendable) {
      throw new ClipError(
        p.asset.address ? "You need a little STX to pay the network fee." : msg("bg.err.notEnoughForFee", { symbol: "STX" }),
        "stacks/insufficient-funds",
      );
    }
    const tx = unsignedTx({ ...header, fee }, payload, pcs);
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "stacks",
      networkId: ctx.network.id,
      method: STACKS_METHODS.signTransaction,
      params: { transaction: hex(serializeTx(tx)), broadcast: true },
    };
  }

  function addressFromPublicKey(publicKey: Uint8Array, network: Network): string {
    const key = publicKey.length === 33 ? publicKey : secp256k1.Point.fromBytes(publicKey).toBytes(true);
    return addressOfKey(key, netName(network.id));
  }

  function principalOk(value: string): ReturnType<typeof parseAddress> {
    const v = value.trim();
    if (v.includes(".")) return parseContractId(v);
    return parseAddress(v);
  }

  return {
    family: "stacks",
    curve: "secp256k1",
    /** Leather, Xverse and @stacks/wallet-sdk account i (BIP-44, coin 5757). */
    derivationPath: (index: number) => `m/44'/5757'/0'/0/${index}`,
    addressFromPublicKey,
    /** Standard (SP/ST/SM/SN) and contract principals, checksum verified. */
    isAddress: (value: string) => principalOk(value) !== null,
    /** SP/SM → mainnet, ST/SN → testnet. */
    networksForAddress: (value: string, candidates: Network[]) => {
      const a = principalOk(value);
      const n = a ? netOfVersion(a.version) : null;
      return n ? candidates.filter((c) => c.family === "stacks" && netOf(c.id) === n) : [];
    },
    getBalances,
    getNfts: async (): Promise<Nft[]> => [],
    decode,
    prepare,
    finalize,
    buildTransfer,
    /** The account's address is spelled per network: SP… on mainnet, ST… on testnet. */
    receiveAddress: async (ctx: ChainContext) => addressOn(ctx),
    normalize,
    stxBalance,
    txStatus,
  };
}
