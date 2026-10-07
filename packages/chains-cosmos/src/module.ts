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
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { addressBytes, bech32Address, compressedKey, decodeBech32, isAccountAddress } from "./address.js";
import { type StdSignDoc, isAdr36SignDoc, isStdSignDoc, makeAdr36SignDoc, serializeSignDoc } from "./amino.js";
import { type Described, amountText, describeMsgs, feeLine, feeOf } from "./describe.js";
import { type CosmosMsg, fromAmino, fromAny, signerOf } from "./msgs.js";
import { type CosmosChainSpec, type CosmosFamily, assetOf, chainsOf, derivationPathOf, nativeAsset, networksOfFamily, specOf } from "./networks.js";
import {
  type Coin,
  ProtoError,
  SIGN_MODE_DIRECT,
  TYPE,
  decodeAuthInfo,
  decodePubKey,
  decodeTxBody,
  decodeTxRaw,
  encodeAuthInfo,
  encodeMsgSend,
  encodePubKey,
  encodeSignDoc,
  encodeThorMsgSend,
  encodeTxBody,
  encodeTxRaw,
} from "./proto.js";
import { RestError, type Rest, broadcastSync, getAccount, getAllBalances, getTx, plainCosmosError, restFor, simulate } from "./rest.js";
import { b64decode, b64encode, equalBytes, fromHex, hex, hostOf, isObj, mulCeil, parseDecimal, randomId, sleep } from "./util.js";

/**
 * Request methods (DappRequest.method). The first two are the WalletConnect Cosmos RPC methods
 * (https://docs.reown.com/advanced/multichain/rpc-reference/cosmos-rpc): params carry `signerAddress` and a sign doc
 * whose bytes are base64, results are `{ signed, signature: StdSignature }`. The rest are Clip Wallet's own:
 *  - cosmos_signArbitrary: ADR-36 (Keplr signArbitrary), params { signer, data: base64 }, result StdSignature.
 *  - cosmos_signAndBroadcast: wallet-built transactions only (buildTransfer); params { signDoc }, result { txhash }.
 * Read-only, no approval (`read()`): cosmos_sendTx (Keplr sendTx: broadcast already-signed bytes) and
 * cosmos_verifyArbitrary (Keplr verifyArbitrary).
 */
export const COSMOS_METHODS = {
  signDirect: "cosmos_signDirect",
  signAmino: "cosmos_signAmino",
  signArbitrary: "cosmos_signArbitrary",
  signAndBroadcast: "cosmos_signAndBroadcast",
  sendTx: "cosmos_sendTx",
  verifyArbitrary: "cosmos_verifyArbitrary",
} as const;

export const COSMOS_READ_METHODS = [COSMOS_METHODS.sendTx, COSMOS_METHODS.verifyArbitrary] as const;
export type CosmosReadMethod = (typeof COSMOS_READ_METHODS)[number];

export interface CosmosModuleOptions {
  family: CosmosFamily;
  /** Run /cosmos/tx/v1beta1/simulate in decode() for direct sign docs (default true). */
  simulate?: boolean;
  /** Gas limit = simulated gas × this (default 1.4). */
  gasAdjustment?: number;
  /** Polls of /cosmos/tx/v1beta1/txs/{hash} after a sync broadcast (default 10, 1.5 s apart). */
  pollAttempts?: number;
  pollIntervalMs?: number;
}

/** StdSignature (Keplr / cosmjs): pub_key is amino JSON, signature base64 r‖s. */
export interface StdSignature {
  pub_key: { type: string; value: string };
  signature: string;
}

/** A sign doc as WalletConnect / 1Mask carry it: bytes base64, account number a decimal string. */
export interface WireSignDoc {
  bodyBytes: string;
  authInfoBytes: string;
  chainId: string;
  accountNumber: string;
}

const AMINO_PUBKEY = "tendermint/PubKeySecp256k1";

type Normalized =
  | { method: "direct"; spec: CosmosChainSpec; me: string; wire: WireSignDoc; signBytes: Uint8Array; body: ReturnType<typeof decodeTxBody> | null; auth: ReturnType<typeof decodeAuthInfo> | null; broadcast: boolean }
  | { method: "amino"; spec: CosmosChainSpec; me: string; doc: StdSignDoc; signBytes: Uint8Array }
  | { method: "arbitrary"; spec: CosmosChainSpec; me: string; doc: StdSignDoc; data: Uint8Array; signBytes: Uint8Array };

function bad(message = "This request from the app is malformed, so we stopped it."): ClipError {
  return new ClipError(message, "cosmos/bad-request");
}

function bytesParam(v: unknown, what: string): Uint8Array {
  if (typeof v === "string") {
    try {
      return b64decode(v);
    } catch {
      throw bad();
    }
  }
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 0 && x < 256)) return Uint8Array.from(v as number[]);
  if (isObj(v) && Object.keys(v).every((k) => /^\d+$/.test(k))) return Uint8Array.from(Object.values(v) as number[]);
  throw bad(`This request from the app is malformed (${what}), so we stopped it.`);
}

function wireSignDoc(v: unknown): WireSignDoc {
  if (!isObj(v)) throw bad();
  const accountNumber = typeof v.accountNumber === "number" || typeof v.accountNumber === "bigint" ? String(v.accountNumber) : v.accountNumber;
  if (typeof v.chainId !== "string" || typeof accountNumber !== "string" || !/^\d+$/.test(accountNumber)) throw bad();
  return { bodyBytes: b64encode(bytesParam(v.bodyBytes, "bodyBytes")), authInfoBytes: b64encode(bytesParam(v.authInfoBytes, "authInfoBytes")), chainId: v.chainId, accountNumber };
}

export function createCosmosModule(options: CosmosModuleOptions): ChainModule & {
  /** The family's networks (Network objects), as in ./networks. */
  networks: Network[];
  read(method: CosmosReadMethod, params: unknown, ctx: ChainContext): Promise<unknown>;
  receiveAddress(ctx: ChainContext): Promise<string>;
  /** This account's address on `network` (bech32 with that network's prefix). */
  addressOn(publicKeyHex: string, network: Network | string): string;
} {
  const family = options.family;
  if (!["cosmos", "provenance", "thorchain", "initia"].includes(family)) throw new Error(`unknown cosmos family ${String(family)}`);
  const specs = chainsOf(family);
  const prefixes = [...new Set(specs.map((s) => s.prefix))];
  const doSimulate = options.simulate ?? true;
  const gasAdj = options.gasAdjustment ?? 1.4;
  const pollAttempts = options.pollAttempts ?? 10;
  const pollMs = options.pollIntervalMs ?? 1500;

  const specFor = (networkId: string): CosmosChainSpec | null => {
    const s = specOf(networkId);
    return s && s.family === family ? s : null;
  };

  const addressOnSpec = (spec: CosmosChainSpec, publicKey: Uint8Array) => bech32Address(spec.prefix, addressBytes(publicKey, spec.keyKind));
  const pubOf = (ctx: ChainContext) => compressedKey(fromHex(ctx.account.publicKey));
  const digestOf = (spec: CosmosChainSpec, bytes: Uint8Array) => (spec.keyKind === "ethsecp256k1" ? keccak_256(bytes) : sha256(bytes));

  function requireSpec(request: DappRequest, ctx: ChainContext): CosmosChainSpec {
    const spec = specFor(request.networkId);
    if (!spec || request.networkId !== ctx.network.id || request.family !== family) {
      throw new ClipError("This app is asking for a different network than the one it's connected to.", "cosmos/network-mismatch");
    }
    return spec;
  }

  function requireSigner(signer: unknown, me: string): void {
    if (typeof signer !== "string" || signer !== me) {
      throw new ClipError("This request is for a different account than the one you connected.", "cosmos/wrong-account");
    }
  }

  function normalize(request: DappRequest, ctx: ChainContext): Normalized {
    const spec = requireSpec(request, ctx);
    const me = addressOnSpec(spec, pubOf(ctx));
    const p = isObj(request.params) ? request.params : {};
    switch (request.method) {
      case COSMOS_METHODS.signDirect:
      case COSMOS_METHODS.signAndBroadcast: {
        const broadcast = request.method === COSMOS_METHODS.signAndBroadcast;
        if (broadcast && !isWalletOrigin(request.origin)) throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "cosmos/unsupported-method");
        if (!broadcast) requireSigner(p.signerAddress, me);
        const wire = wireSignDoc(p.signDoc);
        if (wire.chainId !== spec.chainId) throw new ClipError("This app is asking for a different network than the one it's connected to.", "cosmos/network-mismatch");
        const bodyBytes = b64decode(wire.bodyBytes);
        const authInfoBytes = b64decode(wire.authInfoBytes);
        let body: ReturnType<typeof decodeTxBody> | null = null;
        let auth: ReturnType<typeof decodeAuthInfo> | null = null;
        try {
          body = decodeTxBody(bodyBytes);
          auth = decodeAuthInfo(authInfoBytes);
        } catch (e) {
          if (!(e instanceof ProtoError)) throw e;
          body = null;
          auth = null;
        }
        // Some signer key must be ours (any key type URL: the bytes decide). Signer infos without keys can't be checked here.
        if (auth) {
          const keys = auth.signerInfos.filter((s) => s.publicKey).map((s) => s.publicKey!);
          const mine = pubOf(ctx);
          if (keys.length && !keys.some((k) => safeEq(decodePubKeySafe(k.value), mine))) {
            throw new ClipError("This transaction doesn't need your signature.", "cosmos/not-a-signer");
          }
        }
        const signBytes = encodeSignDoc({ bodyBytes, authInfoBytes, chainId: wire.chainId, accountNumber: BigInt(wire.accountNumber) });
        return { method: "direct", spec, me, wire, signBytes, body, auth, broadcast };
      }
      case COSMOS_METHODS.signAmino: {
        requireSigner(p.signerAddress, me);
        if (!isStdSignDoc(p.signDoc)) throw bad();
        const doc = p.signDoc;
        const adr36 = isAdr36SignDoc(doc);
        if (adr36) {
          requireSigner(adr36.signer, me);
          return { method: "arbitrary", spec, me, doc, data: b64decode(adr36.data), signBytes: serializeSignDoc(doc) };
        }
        if (doc.chain_id !== spec.chainId) throw new ClipError("This app is asking for a different network than the one it's connected to.", "cosmos/network-mismatch");
        return { method: "amino", spec, me, doc, signBytes: serializeSignDoc(doc) };
      }
      case COSMOS_METHODS.signArbitrary: {
        requireSigner(p.signer, me);
        const data = bytesParam(p.data, "data");
        if (data.length === 0) throw bad();
        const doc = makeAdr36SignDoc(me, b64encode(data));
        return { method: "arbitrary", spec, me, doc, data, signBytes: serializeSignDoc(doc) };
      }
      default:
        throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "cosmos/unsupported-method");
    }
  }

  /* ------------------------------------------------------------------ decode */

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(request, ctx);
    const host = isWalletOrigin(request.origin) ? "Clip Wallet" : hostOf(request.origin);
    const base = { requestId: request.id, networkId: request.networkId };

    if (n.method === "arbitrary") {
      const text = readableText(n.data);
      const lines = text !== null ? [{ label: "Message", value: text }] : [{ label: "Message (not text)", value: `0x${hex(n.data)}` }];
      const warnings: Warning[] = text !== null ? [] : [{ level: "caution", code: "blind-signing", message: "This message isn't readable text. It can't move funds by itself, but only sign it if you trust the site." }];
      const t = msg("bg.req.signMessage", { host });
      return { ...base, title: t.fallback, titleMsg: t, lines, balanceChanges: [], simulated: false, blind: false, warnings };
    }

    if (n.method === "amino") {
      const msgs = n.doc.msgs.map(fromAmino);
      const d = describeMsgs(n.spec, msgs, n.me, host);
      notSigner(msgs, n.me, d);
      const fee = n.doc.fee.amount.map((c) => ({ denom: c.denom, amount: c.amount }));
      if (n.doc.memo) d.lines.push({ label: "Memo", value: n.doc.memo });
      d.lines.push(feeLine(n.spec, fee));
      d.lines.push(sentBy(host));
      addFee(d, fee, n.me, n.doc.fee.granter, n.doc.fee.payer);
      return { ...base, ...titleOf(d), lines: d.lines, balanceChanges: d.balanceChanges, fee: feeOf(n.spec, fee), simulated: false, blind: d.blind, warnings: d.warnings };
    }

    // direct
    if (!n.body || !n.auth) {
      const t = msg("bg.req.approveTxFor", { host });
      return {
        ...base,
        title: t.fallback,
        titleMsg: t,
        lines: [],
        balanceChanges: [],
        simulated: false,
        blind: true,
        warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." }],
      };
    }
    const msgs = n.body.messages.map((a) => fromAny(a, n.spec.prefix));
    const d = describeMsgs(n.spec, msgs, n.me, host);
    notSigner(msgs, n.me, d);
    if (n.body.extensionOptions.length || n.auth.hasTip) {
      d.blind = true;
      d.warnings.unshift({ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." });
    }
    if (n.body.memo) d.lines.push({ label: "Memo", value: n.body.memo });
    if (n.body.timeoutHeight > 0n) {
      const v = msg("bg.cosmos.block", { height: n.body.timeoutHeight.toString() });
      d.lines.push({ label: "Valid until", value: v.fallback, valueMsg: v });
    }
    const fee = n.auth.fee.amount;
    d.lines.push(feeLine(n.spec, fee));
    if (!n.broadcast) d.lines.push(sentBy(host));
    addFee(d, fee, n.me, n.auth.fee.granter, n.auth.fee.payer);

    let simulated = false;
    if (doSimulate && !d.blind) {
      try {
        const tx = encodeTxRaw({ bodyBytes: b64decode(n.wire.bodyBytes), authInfoBytes: b64decode(n.wire.authInfoBytes), signatures: n.auth.signerInfos.map(() => new Uint8Array()) });
        await simulate(restFor(ctx), tx);
        simulated = true;
      } catch (e) {
        const reason = e instanceof RestError ? e.message : "";
        if (/insufficient funds|insufficient balance/i.test(reason)) {
          d.warnings.push({ level: "danger", code: "simulation-failed", message: "This is expected to fail and would still cost a fee." });
        } else {
          d.warnings.push({ level: "caution", code: "simulation-failed", message: "We couldn't preview the exact result of this on the network. Check the details before you approve." });
        }
      }
    }
    return { ...base, ...titleOf(d), lines: d.lines, balanceChanges: d.balanceChanges, fee: feeOf(n.spec, fee), simulated, blind: d.blind, warnings: d.warnings };
  }

  /** Refuses requests our key isn't a signer of (every message names someone else). */
  function notSigner(msgs: CosmosMsg[], me: string, d: Described): void {
    if (d.blind) return;
    const signers = msgs.map(signerOf);
    if (signers.every((s) => s !== undefined && s !== me)) throw new ClipError("This transaction doesn't need your signature.", "cosmos/not-a-signer");
  }

  /** Fee paid by a granter or another payer: say so (our balance doesn't pay it). */
  function addFee(d: Described, _fee: readonly Coin[], me: string, granter?: string, payer?: string): void {
    if (granter || (payer && payer !== me)) {
      d.warnings.push({ level: "info", code: "network-matters", message: "Another account pays the network fee for this transaction." });
    }
  }

  function titleOf(d: Described): { title: string; titleMsg?: DecodedRequest["titleMsg"] } {
    return d.titleMsg ? { title: d.title, titleMsg: d.titleMsg } : { title: d.title };
  }

  /* ------------------------------------------------------------------ prepare / finalize */

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const n = normalize(request, ctx);
    return [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: digestOf(n.spec, n.signBytes), approvalId }];
  }

  function stdSignature(ctx: ChainContext, sig: Uint8Array): StdSignature {
    return { pub_key: { type: AMINO_PUBKEY, value: b64encode(pubOf(ctx)) }, signature: b64encode(sig) };
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(request, ctx);
    const sig = signatures[0];
    if (!sig || signatures.length !== 1) throw new ClipError("Some signatures are missing. Nothing was sent.", "cosmos/missing-signature");
    if (sig.scheme !== "ecdsa-secp256k1" || sig.bytes.length !== 64 || !secp256k1.verify(sig.bytes, digestOf(n.spec, n.signBytes), pubOf(ctx), { prehash: false, lowS: true })) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "cosmos/bad-signature");
    }
    const signature = stdSignature(ctx, sig.bytes);
    if (n.method === "arbitrary") return request.method === COSMOS_METHODS.signAmino ? { signed: n.doc, signature } : signature;
    if (n.method === "amino") return { signed: n.doc, signature };
    if (!n.broadcast) return { signed: n.wire, signature };

    const tx = encodeTxRaw({ bodyBytes: b64decode(n.wire.bodyBytes), authInfoBytes: b64decode(n.wire.authInfoBytes), signatures: [sig.bytes] });
    return send(restFor(ctx), n.spec, tx);
  }

  async function send(rest: Rest, spec: CosmosChainSpec, tx: Uint8Array): Promise<{ txhash: string; status: "success" | "pending"; height?: string }> {
    let r;
    try {
      r = await broadcastSync(rest, tx);
    } catch (e) {
      if (e instanceof RestError) throw new ClipError(plainCosmosError(-1, undefined, e.message, spec.native.symbol), "cosmos/send-failed", e);
      throw e;
    }
    if (r.code !== 0) throw new ClipError(plainCosmosError(r.code, r.codespace, r.raw_log, spec.native.symbol), "cosmos/send-failed");
    const txhash = r.txhash.toUpperCase();
    for (let k = 0; k < pollAttempts; k++) {
      if (pollMs > 0) await sleep(pollMs);
      const t = await getTx(rest, txhash).catch(() => null);
      if (!t) continue;
      if (t.code !== 0) throw new ClipError(plainCosmosError(t.code, t.codespace, t.raw_log, spec.native.symbol), "cosmos/send-failed");
      return { txhash, status: "success", ...(t.height ? { height: t.height } : {}) };
    }
    return { txhash, status: "pending" };
  }

  /* ------------------------------------------------------------------ read-only (no approval) */

  async function read(method: CosmosReadMethod, params: unknown, ctx: ChainContext): Promise<unknown> {
    const spec = specFor(ctx.network.id);
    if (!spec) throw new ClipError("This app is asking for a different network than the one it's connected to.", "cosmos/network-mismatch");
    const p = isObj(params) ? params : {};
    if (method === COSMOS_METHODS.sendTx) {
      const tx = bytesParam(p.tx, "tx");
      try {
        decodeTxRaw(tx);
      } catch {
        throw new ClipError("This transaction can't be read.", "cosmos/bad-transaction");
      }
      const mode = p.mode === "async" ? "BROADCAST_MODE_ASYNC" : "BROADCAST_MODE_SYNC";
      const rest = restFor(ctx);
      let r;
      try {
        r = await rest.post<{ tx_response?: { code: number; codespace?: string; raw_log?: string; txhash: string } }>("/cosmos/tx/v1beta1/txs", { tx_bytes: b64encode(tx), mode });
      } catch (e) {
        if (e instanceof RestError) throw new ClipError(plainCosmosError(-1, undefined, e.message, spec.native.symbol), "cosmos/send-failed", e);
        throw e;
      }
      const t = r.tx_response;
      if (!t) throw new ClipError("The network rejected this. Nothing was sent.", "cosmos/send-failed");
      if (t.code !== 0) throw new ClipError(plainCosmosError(t.code, t.codespace, t.raw_log, spec.native.symbol), "cosmos/send-failed");
      return { txhash: t.txhash.toUpperCase() };
    }
    if (method === COSMOS_METHODS.verifyArbitrary) {
      return verifyArbitrary(spec, p.signer, p.data, p.signature);
    }
    throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "cosmos/unsupported-method");
  }

  /** Keplr verifyArbitrary: the key in the signature must be the signer's, and verify over the ADR-36 doc. */
  function verifyArbitrary(spec: CosmosChainSpec, signer: unknown, data: unknown, signature: unknown): boolean {
    if (typeof signer !== "string" || !isObj(signature) || !isObj(signature.pub_key) || typeof signature.signature !== "string") return false;
    if (signature.pub_key.type !== AMINO_PUBKEY || typeof signature.pub_key.value !== "string") return false;
    try {
      const pub = compressedKey(b64decode(signature.pub_key.value));
      const d = decodeBech32(signer);
      if (!d || d.prefix !== spec.prefix || !equalBytes(d.data, addressBytes(pub, spec.keyKind))) return false;
      const bytes = bytesParam(data, "data");
      const doc = makeAdr36SignDoc(signer, b64encode(bytes));
      const sig = b64decode(signature.signature);
      return sig.length === 64 && secp256k1.verify(sig, digestOf(spec, serializeSignDoc(doc)), pub, { prehash: false, lowS: false });
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------------ balances */

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const spec = specFor(ctx.network.id);
    if (!spec) throw new ClipError("That network isn't available in this wallet.", "cosmos/network-mismatch");
    const me = addressOnSpec(spec, pubOf(ctx));
    const all = await getAllBalances(restFor(ctx), me);
    const of = (denom: string) => all.find((b) => b.denom === denom)?.amount ?? "0";
    const out: TokenBalance[] = [{ asset: nativeAsset(spec), amount: of(spec.native.denom) }];
    for (const t of spec.tokens ?? []) {
      const amount = of(t.denom);
      if (amount !== "0" || t.alwaysShow) out.push({ asset: assetOf(spec, t.denom), amount });
    }
    return out;
  }

  /* ------------------------------------------------------------------ transfers */

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const spec = specFor(ctx.network.id);
    if (!spec) throw new ClipError("That network isn't available in this wallet.", "cosmos/network-mismatch");
    const pub = pubOf(ctx);
    const me = addressOnSpec(spec, pub);
    const to = p.to.trim();
    const dec = decodeBech32(to);
    if (!dec || (dec.data.length !== 20 && dec.data.length !== 32)) throw new ClipError("That address isn't valid. Check it and try again.", "cosmos/bad-address");
    if (dec.prefix !== spec.prefix) {
      throw new ClipError(msg("bg.cosmos.wrongPrefix", { prefix: `${spec.prefix}1…`, network: spec.name }), "cosmos/bad-address");
    }
    if (to === me) throw new ClipError("That's your own address.", "cosmos/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "cosmos/bad-amount");
    const denom = p.asset.address ?? (p.asset.key === spec.native.key ? spec.native.denom : undefined);
    if (!denom || p.asset.networkId !== ctx.network.id) throw new ClipError("That token couldn't be found.", "cosmos/unknown-asset");
    const amount = BigInt(p.amount);

    const rest = restFor(ctx);
    const account = await getAccount(rest, me);
    if (!account) throw new ClipError(msg("bg.cosmos.noAccount", { network: spec.name, symbol: spec.native.symbol }), "cosmos/insufficient-funds");
    const balances = await getAllBalances(rest, me);
    const bal = (d: string) => BigInt(balances.find((b) => b.denom === d)?.amount ?? "0");
    if (bal(denom) < amount) throw new ClipError(msg("bg.err.notEnough", { symbol: assetOf(spec, denom).symbol }), "cosmos/insufficient-funds");

    const message =
      spec.sendMsg === "thorchain"
        ? { typeUrl: TYPE.thorMsgSend, value: encodeThorMsgSend({ fromAddress: addressBytes(pub, spec.keyKind), toAddress: dec.data, amount: [{ denom, amount: p.amount }] }) }
        : { typeUrl: TYPE.msgSend, value: encodeMsgSend({ fromAddress: me, toAddress: to, amount: [{ denom, amount: p.amount }] }) };
    const bodyBytes = encodeTxBody({ messages: [message], memo: "" });
    const signer = { publicKey: { typeUrl: spec.pubKeyTypeUrl, value: encodePubKey(pub) }, mode: SIGN_MODE_DIRECT, sequence: account.sequence };

    // Gas and fee: simulate with no fee coins, then gas × adjustment and the network's fee model.
    const simTx = encodeTxRaw({ bodyBytes, authInfoBytes: encodeAuthInfo({ signerInfos: [signer], fee: { amount: [], gasLimit: 0n } }), signatures: [new Uint8Array()] });
    const failed = (e: unknown): never => {
      if (e instanceof RestError) throw new ClipError(plainCosmosError(-1, undefined, e.message, assetOf(spec, denom).symbol), "cosmos/simulation-failed", e);
      throw e;
    };
    let gasLimit: bigint;
    let fee: Coin[];
    if (spec.feeModel === "provenance-flatfee") {
      // Provenance x/flatfees: the fee is per message type, not gas × price (x/flatfees/spec/01_concepts.md).
      const r = await rest
        .post<{ total_fees?: Coin[]; estimated_gas?: string }>("/provenance/tx/v1/calculate_flat_fee", { tx_bytes: b64encode(simTx), gas_adjustment: gasAdj })
        .catch(failed);
      if (!r.total_fees || !/^\d+$/.test(r.estimated_gas ?? "")) throw new ClipError("We couldn't work out the network fee. Try again.", "cosmos/simulation-failed");
      fee = r.total_fees.filter((c) => /^\d+$/.test(c.amount) && c.amount !== "0");
      gasLimit = maxBig(BigInt(r.estimated_gas!), spec.minGas ?? 0n);
    } else {
      const gasUsed = await simulate(rest, simTx).catch(failed);
      gasLimit = maxBig(BigInt(Math.ceil(Number(gasUsed) * gasAdj)), spec.minGas ?? 0n);
      fee = await feeFor(spec, rest, gasLimit, bal);
    }
    const feeTotal = (d: string) => fee.filter((c) => c.denom === d).reduce((a, c) => a + BigInt(c.amount), 0n);
    const fixed = spec.feeModel === "fixed-native" && spec.fixedFee?.denom === denom ? await nativeTxFee(spec, rest) : 0n;
    if (bal(denom) < amount + feeTotal(denom) + fixed) {
      throw new ClipError(msg("bg.err.notEnoughForFee", { symbol: assetOf(spec, denom).symbol }), "cosmos/insufficient-funds");
    }
    for (const c of fee) if (c.denom !== denom && bal(c.denom) < BigInt(c.amount)) throw new ClipError(msg("bg.err.notEnoughForFee", { symbol: assetOf(spec, c.denom).symbol }), "cosmos/insufficient-funds");

    const authInfoBytes = encodeAuthInfo({ signerInfos: [signer], fee: { amount: fee, gasLimit } });
    const signDoc: WireSignDoc = { bodyBytes: b64encode(bodyBytes), authInfoBytes: b64encode(authInfoBytes), chainId: spec.chainId, accountNumber: account.accountNumber.toString() };
    return { id: randomId(), origin: WALLET_ORIGIN, via: "injected", family, networkId: ctx.network.id, method: COSMOS_METHODS.signAndBroadcast, params: { signDoc } };
  }

  /** The fee in the first fee token the account can pay with (gas limit × gas price, rounded up). */
  async function feeFor(spec: CosmosChainSpec, rest: Rest, gasLimit: bigint, bal: (denom: string) => bigint): Promise<Coin[]> {
    if (spec.feeModel === "fixed-native") return [];
    const options: Coin[] = [];
    for (const t of spec.feeTokens) {
      let price = parseDecimal(t.average);
      if (t.denom === spec.native.denom && (spec.feeModel === "osmosis-txfees" || spec.feeModel === "initia-dynamic")) {
        const live = await liveGasPrice(spec, rest);
        if (live) price = live;
      }
      options.push({ denom: t.denom, amount: mulCeil(gasLimit, price.num, price.den).toString() });
    }
    const pick = options.find((c) => bal(c.denom) >= BigInt(c.amount)) ?? options[0];
    return pick ? [pick] : [];
  }

  /**
   * The chain's current native gas price with headroom, or null (then the registry price is used):
   *  - Osmosis x/txfees EIP-1559 base fee × 1.65 (osmosis-frontend packages/tx/src/gas.ts).
   *  - Initia x/dynamicfee price (/initia/tx/v1/gas_prices/{denom}) × 1.05 (chainapsis oko cosmos_selectable_fees.ts).
   */
  async function liveGasPrice(spec: CosmosChainSpec, rest: Rest): Promise<{ num: bigint; den: bigint } | null> {
    let value: string | undefined;
    let mul: [bigint, bigint];
    if (spec.feeModel === "osmosis-txfees") {
      value = (await rest.get<{ base_fee?: string }>("/osmosis/txfees/v1beta1/cur_eip_base_fee").catch(() => null))?.base_fee;
      mul = [165n, 100n];
    } else {
      value = (await rest.get<{ gas_price?: { amount?: string } }>(`/initia/tx/v1/gas_prices/${spec.native.denom}`).catch(() => null))?.gas_price?.amount;
      mul = [105n, 100n];
    }
    if (!value || !/^\d+(\.\d+)?$/.test(value)) return null;
    const p = parseDecimal(value);
    return p.num === 0n ? null : { num: p.num * mul[0], den: p.den * mul[1] };
  }

  /** THORChain's fixed native fee (/thorchain/network native_tx_fee_rune), else the spec's fallback. */
  async function nativeTxFee(spec: CosmosChainSpec, rest: Rest): Promise<bigint> {
    const r = await rest.get<{ native_tx_fee_rune?: string }>("/thorchain/network").catch(() => null);
    return r?.native_tx_fee_rune && /^\d+$/.test(r.native_tx_fee_rune) ? BigInt(r.native_tx_fee_rune) : BigInt(spec.fixedFee?.amount ?? "0");
  }

  async function receiveAddress(ctx: ChainContext): Promise<string> {
    const spec = specFor(ctx.network.id);
    if (!spec) throw new ClipError("That network isn't available in this wallet.", "cosmos/network-mismatch");
    return addressOnSpec(spec, pubOf(ctx));
  }

  const networks = networksOfFamily(family);

  return {
    family,
    curve: "secp256k1",
    derivationPath: (index: number) => derivationPathOf(family, index),
    networks,
    addressFromPublicKey(publicKey: Uint8Array, network: Network): string {
      const spec = specFor(network.id);
      if (!spec) throw new Error(`${network.id} isn't a ${family} network`);
      return addressOnSpec(spec, publicKey);
    },
    addressOn(publicKeyHex: string, network: Network | string): string {
      const spec = specFor(typeof network === "string" ? network : network.id);
      if (!spec) throw new Error(`not a ${family} network`);
      return addressOnSpec(spec, fromHex(publicKeyHex));
    },
    isAddress: (value: string) => isAccountAddress(value, prefixes),
    networksForAddress(value: string, candidates: Network[]): Network[] {
      const d = decodeBech32(value);
      if (!d || !isAccountAddress(value, prefixes)) return [];
      return candidates.filter((c) => specFor(c.id)?.prefix === d.prefix);
    },
    getBalances,
    getNfts: async (): Promise<Nft[]> => [],
    decode,
    prepare,
    finalize,
    buildTransfer,
    receiveAddress,
    read,
  };

}

function sentBy(host: string): { label: string; value: string; valueMsg: ReturnType<typeof msg> } {
  const v = msg("bg.cosmos.appGetsSigned", { host });
  return { label: "Sent by", value: v.fallback, valueMsg: v };
}

const maxBig = (a: bigint, b: bigint) => (a > b ? a : b);

function decodePubKeySafe(b: Uint8Array): Uint8Array {
  try {
    return decodePubKey(b);
  } catch {
    return new Uint8Array();
  }
}

function safeEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length === 33) return equalBytes(a, b);
  try {
    return equalBytes(compressedKey(a), b);
  } catch {
    return false;
  }
}

/** UTF-8 text without control characters (other than line breaks and tabs), else null. */
function readableText(b: Uint8Array): string | null {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(b);
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ? null : s;
  } catch {
    return null;
  }
}

export { amountText };
