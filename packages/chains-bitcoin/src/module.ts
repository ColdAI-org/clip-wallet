/**
 * The Bitcoin ChainModule. No key material: prepare() returns per-input sighash digests, finalize()
 * inserts the vault's signatures, finalizes the PSBT and (for send requests) broadcasts it.
 *
 * Request shapes: see requests.ts (Wallet Standard via 1Mask, sats-connect, WalletConnect bip122).
 * State between prepare() and finalize() (and the PSBT built for a sendTransfer between decode() and
 * prepare()) is held in memory per module instance, keyed by request id.
 */
import {
  ClipError,
  type AssetRef,
  type ChainContext,
  type ChildAddress,
  type ChainModule,
  type DappRequest,
  type DecodedRequest,
  type Network,
  type Nft,
  type Signature,
  type SignablePayload,
  type TokenBalance,
  type Warning,
  isWalletOrigin,
} from "@clip-wallet/core";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { base64, hex } from "@scure/base";
import { Address, OutScript, SigHash, Transaction } from "@scure/btc-signer";
import { concatBytes } from "@scure/btc-signer/utils.js";
import { type Utxo, selectLargestFirst } from "./coinselect.js";
import { type EsploraAddress, type EsploraUtxo, broadcast, esploraJson, feeRate } from "./esplora.js";
import { type OwnScripts, TAPROOT_UNAVAILABLE, changeKey, derivationPath, ownScripts, scriptType, segwitAddress, taprootAddress } from "./keys.js";
import { bip137Digest, bip322Digest, bip322MessageHash, encodeSimpleSignature } from "./message.js";
import { BITCOIN_NETWORKS, btcNet } from "./networks.js";
import { SMALL_UTXO_SATS, addressInscriptions, checkOutpoint } from "./ordinals.js";
import { type InputDigest, type PsbtAnalysis, TX_OPTS, analyzePsbt, inputDigests, parsePsbt, psbtBase64, sighashRisk } from "./psbt.js";
import { BTC_METHODS, type BtcOp, normalize } from "./requests.js";

export interface BitcoinModuleOptions {
  /** ord server per network id. When set, inscribed UTXOs are never spent; when absent we warn. */
  ordinalsIndexUrls?: Record<string, string>;
  newId?: () => string;
}

type Pending =
  | { type: "psbt"; psbt: string; digests: InputDigest[]; op: Extract<BtcOp, { kind: "psbt" | "transfer" }> }
  | { type: "message"; kind: "wpkh" | "tr"; protocol: "bip322" | "ecdsa"; message: Uint8Array; digest: Uint8Array; address: string; reply: "standard" | "wc" };

/* ------------------------------------------------------------------ formatting */

export function formatBtc(sats: bigint): string {
  const neg = sats < 0n;
  const v = neg ? -sats : sats;
  const whole = v / 100_000_000n;
  const frac = (v % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

export const shortBtcAddress = (a: string): string => (a.length > 16 ? `${a.slice(0, 7)}…${a.slice(-4)}` : a);

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
};

/* ------------------------------------------------------------------ module */

export function createBitcoinModule(opts: BitcoinModuleOptions = {}): ChainModule & { pendingCount(): number } {
  const pending = new Map<string, Pending>();
  const built = new Map<string, string>();
  /** Change address picked for a PSBT this module built (per request id), so decode shows it as the user's. */
  const builtChange = new Map<string, ChildAddress>();

  /** Change addresses that count as the account's for this request. */
  function changeOf(reqId: string, ctx: ChainContext): ChildAddress[] {
    const list = [...(ctx.changeAddresses ?? [])];
    const extra = builtChange.get(reqId);
    if (extra && !list.some((c) => c.derivationSubPath === extra.derivationSubPath)) list.push(extra);
    return list;
  }
  const newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
  const ordIndex = (n: Network) => opts.ordinalsIndexUrls?.[n.id];

  function addressScript(address: string, network: Network): Uint8Array {
    try {
      return OutScript.encode(Address(btcNet(network)).decode(address));
    } catch {
      throw new ClipError("That isn't a Bitcoin address for this network. Check it and try again.", "bad-address", address);
    }
  }

  async function ownUtxos(ctx: ChainContext, own: OwnScripts): Promise<Utxo[]> {
    const out: Utxo[] = [];
    const sources: ["wpkh" | "tr", string, Uint8Array][] = [
      ["wpkh", segwitAddress(own.pubkey, ctx.network), own.wpkh],
      ...(own.tr ? [["tr", taprootAddress(own.trInternalKey!, ctx.network), own.tr] as ["tr", string, Uint8Array]] : []),
      ...own.change.map((c): ["wpkh", string, Uint8Array] => ["wpkh", segwitAddress(c.pubkey, ctx.network), c.wpkh]),
    ];
    for (const [kind, address, script] of sources) {
      const list = await esploraJson<EsploraUtxo[]>(ctx.network, ctx.fetch, `/address/${address}/utxo`);
      for (const u of list) {
        if (!u.status.confirmed) continue; // v1: confirmed coins only
        out.push({ txid: u.txid, vout: u.vout, value: BigInt(u.value), script, kind });
      }
    }
    return out;
  }

  /**
   * Where change goes: the lowest handed-out change address that has never been used (so cancelled sends
   * don't widen the gap other wallets scan), else a fresh one from the vault, else the primary address (v1).
   */
  async function pickChange(ctx: ChainContext): Promise<ChildAddress | undefined> {
    const known = [...(ctx.changeAddresses ?? [])].sort((a, b) => changeIndex(a) - changeIndex(b));
    for (const c of known.slice(-3)) {
      const st = await esploraJson<EsploraAddress>(ctx.network, ctx.fetch, `/address/${c.address}`);
      if ((st.chain_stats.tx_count ?? 1) === 0 && (st.mempool_stats.tx_count ?? 1) === 0) return c;
    }
    return ctx.freshChangeAddress ? ctx.freshChangeAddress() : undefined;
  }

  async function buildPsbt(ctx: ChainContext, recipients: { address: string; amount: bigint }[], reqId: string): Promise<Transaction> {
    const own = ownScripts(ctx.account, ctx.changeAddresses ?? [], ctx.network);
    const outs = recipients.map((r) => {
      if (r.amount <= 0n) throw new ClipError("Enter an amount above zero.", "bad-amount");
      const script = addressScript(r.address, ctx.network);
      return { script, amount: r.amount, type: scriptType(script) };
    });
    let utxos = await ownUtxos(ctx, own);
    const index = ordIndex(ctx.network);
    if (index) {
      // Only coins the index positively reports as clean are spendable.
      const checks = await Promise.all(utxos.map((u) => checkOutpoint(ctx.fetch, index, u.txid, u.vout)));
      utxos = utxos.filter((_, i) => checks[i] === "clean");
    }
    const rate = await feeRate(ctx.network, ctx.fetch);
    const sel = selectLargestFirst(utxos, outs, rate, "wpkh", index ? undefined : (u) => u.value <= BigInt(SMALL_UTXO_SATS));
    const tx = new Transaction(TX_OPTS);
    for (const u of sel.inputs) {
      const input: Parameters<Transaction["addInput"]>[0] = { txid: hex.decode(u.txid), index: u.vout, sequence: 0xfffffffd, witnessUtxo: { script: u.script, amount: u.value } };
      if (u.kind === "tr") input.tapInternalKey = own.trInternalKey!;
      tx.addInput(input);
    }
    for (const o of outs) tx.addOutput({ script: o.script, amount: o.amount });
    if (sel.change > 0n) {
      // A fresh change address when the background provides one (see keys.ts, "change addresses").
      const picked = await pickChange(ctx);
      let script = own.wpkh;
      if (picked) {
        try {
          script = changeKey(picked, ctx.network).wpkh;
        } catch (e) {
          throw new ClipError("Something went wrong preparing this send. Nothing was sent.", "bad-change-address", e);
        }
        builtChange.set(reqId, picked);
      }
      tx.addOutput({ script, amount: sel.change });
    }
    return tx;
  }

  async function resolvePsbt(req: DappRequest, ctx: ChainContext, op: Extract<BtcOp, { kind: "psbt" | "transfer" }>): Promise<Transaction> {
    if (op.kind === "psbt") return parsePsbt(op.psbt);
    let b = built.get(req.id);
    if (!b) {
      b = psbtBase64(await buildPsbt(ctx, op.recipients, req.id));
      built.set(req.id, b);
    }
    return parsePsbt(b);
  }

  /** The account's own addresses on this network (taproot only when the account has a BIP-86 key). */
  function ownAddresses(own: OwnScripts, network: Network): string[] {
    return [segwitAddress(own.pubkey, network), ...(own.trInternalKey ? [taprootAddress(own.trInternalKey, network)] : [])];
  }

  /** "Not ours": a taproot address while the account has no BIP-86 key gets the plain taproot message. */
  function notOurs(address: string, own: OwnScripts, network: Network): ClipError {
    if (!own.trInternalKey && isTaprootAddress(address, network)) return new ClipError(TAPROOT_UNAVAILABLE, "taproot-unavailable", address);
    return new ClipError("This request is for a different account than the one you're using.", "wrong-account", address);
  }

  function checkSigners(op: BtcOp, ctx: ChainContext) {
    const own = ownScripts(ctx.account);
    const mine = new Set([...ownAddresses(own, ctx.network), ...(ctx.changeAddresses ?? []).map((c) => c.address)]);
    const addrs = op.kind === "psbt" ? op.signerAddresses : op.kind === "message" && op.address ? [op.address] : [];
    for (const a of addrs) if (!mine.has(a)) throw notOurs(a, own, ctx.network);
  }

  async function inscribedInputs(ctx: ChainContext, a: PsbtAnalysis): Promise<{ inscribed: number[]; unchecked: boolean }> {
    const index = ordIndex(ctx.network);
    const signing = a.inputs.filter((x) => x.sign);
    if (!index) return { inscribed: [], unchecked: signing.length > 0 };
    const res = await Promise.all(signing.map((x) => checkOutpoint(ctx.fetch, index, x.txid, x.vout)));
    // With an index configured, "couldn't check" is treated like "inscribed": we don't risk it.
    return { inscribed: signing.filter((_, i) => res[i] !== "clean").map((x) => x.index), unchecked: false };
  }

  /**
   * Audit BTC-01: a segwit v0 signature commits only to the amount of the coin it signs, so a PSBT that understates
   * our coins' amounts (witnessUtxo, with no full previous transaction) can hide a huge fee, the known two-signature
   * fee attack. Check the amounts of our coins against the network before showing the fee.
   */
  /** PSBTs this module built from the network's own coin list (buildTransfer uses "clip-wallet://send"). */
  const builtHere = (req: DappRequest) => isWalletOrigin(req.origin) || req.origin.startsWith("clip-wallet://");

  async function checkWitnessAmounts(ctx: ChainContext, tx: Transaction, a: PsbtAnalysis, warnings?: DecodedRequest["warnings"]): Promise<void> {
    const need = a.inputs.filter((x) => x.sign && x.kind === "wpkh" && !tx.getInput(x.index).nonWitnessUtxo && x.amount !== undefined && x.script);
    let unchecked = false;
    for (const x of need) {
      let prev: { vout?: { scriptpubkey?: string; value?: number }[] };
      try {
        prev = await esploraJson(ctx.network, ctx.fetch, `/tx/${x.txid}`);
      } catch {
        unchecked = true;
        continue;
      }
      const o = prev.vout?.[x.vout];
      if (!o || o.value === undefined || BigInt(o.value) !== x.amount || o.scriptpubkey?.toLowerCase() !== hex.encode(x.script!)) {
        throw new ClipError("The app described one of your coins wrongly (its amount doesn't match the network), so we stopped it.", "bad-input-amount", x.index);
      }
    }
    if (unchecked) {
      warnings?.push({ level: "caution", code: "simulation-failed", message: "We couldn't check the amounts of your coins with the network, so the fee shown may be wrong." });
    }
  }

  function messageKind(op: Extract<BtcOp, { kind: "message" }>, ctx: ChainContext): { kind: "wpkh" | "tr"; address: string } {
    const own = ownScripts(ctx.account);
    const w = segwitAddress(own.pubkey, ctx.network);
    if (!op.address || op.address === w) return { kind: "wpkh", address: w };
    if (own.trInternalKey && op.address === taprootAddress(own.trInternalKey, ctx.network)) return { kind: "tr", address: op.address };
    throw notOurs(op.address, own, ctx.network);
  }

  /* ---------------------------------------------------------------- decode */

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const op = normalize(req);
    checkSigners(op, ctx);
    const host = hostOf(req.origin);
    const d: DecodedRequest = { requestId: req.id, title: "", lines: [], balanceChanges: [], simulated: false, blind: false, warnings: [], networkId: ctx.network.id };
    const native = ctx.network.nativeAsset;

    if (op.kind === "message") {
      const { kind, address } = messageKind(op, ctx);
      if (op.protocol === "ecdsa" && kind === "tr") throw new ClipError("This kind of message signature doesn't work with this address.", "unsupported-protocol");
      let text: string | undefined;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(op.message);
      } catch {
        text = undefined;
      }
      const signIn = text ? /^(\S+) wants you to sign in with your Bitcoin account/.exec(text) : null;
      if (signIn) {
        d.title = `Sign in to ${signIn[1]}`;
        if (signIn[1] !== host) d.warnings.push({ level: "danger", code: "domain-mismatch", message: `This sign-in is for ${signIn[1]}, but the request came from ${host}.` });
      } else d.title = `Sign a message for ${host}`;
      d.lines.push({ label: "Message", value: text ?? hex.encode(op.message) }, { label: "Address", value: address }, { label: "Requested by", value: host });
      if (!text) d.warnings.push({ level: "caution", code: "blind-signing", message: "This message isn't readable text. It can't move coins by itself, but only sign it if you trust the site." });
      return d;
    }

    const tx = await resolvePsbt(req, ctx, op);
    const a = analyzePsbt(tx, ctx.account, ctx.network, op.kind === "psbt" ? op.toSign : undefined, changeOf(req.id, ctx));
    const external = a.outputs.filter((o) => !o.ours && !o.opReturn);
    const allOurs = a.inputs.every((x) => x.kind !== null);
    const sentOut = external.reduce((s, o) => s + o.amount, 0n);

    if (allOurs && external.length === 1) d.title = `Send ${formatBtc(sentOut)} BTC to ${shortBtcAddress(external[0]!.address ?? "an address")}`;
    else if (allOurs && external.length > 1) d.title = `Send ${formatBtc(sentOut)} BTC to ${external.length} addresses`;
    else if (allOurs) d.title = "Move your BTC between your own addresses";
    else if (a.net < 0n) d.title = `Pay ${formatBtc(-a.net)} BTC in a transaction from ${host}`;
    else if (a.net > 0n) d.title = `Receive ${formatBtc(a.net)} BTC in a transaction from ${host}`;
    else d.title = `Sign a Bitcoin transaction for ${host}`;

    let n = 0;
    for (const x of a.inputs) {
      n++;
      const amt = x.amount !== undefined ? `${formatBtc(x.amount)} BTC` : "amount unknown";
      d.lines.push({ label: x.kind ? (x.sign ? `Your coin ${n}` : `Your coin ${n} (not signed now)`) : `Other coin ${n}`, value: amt });
    }
    for (const o of a.outputs) {
      if (o.opReturn) d.lines.push({ label: "Data note", value: hex.encode(o.script.slice(1, 81)) });
      else if (o.ours) d.lines.push({ label: "Change back to you", value: `${formatBtc(o.amount)} BTC` });
      else d.lines.push({ label: `To ${o.address ?? "a custom script"}`, value: `${formatBtc(o.amount)} BTC` });
    }
    if (a.fee !== undefined) d.lines.push({ label: "Network fee", value: `${formatBtc(a.fee)} BTC (${a.feeRate} sat/vB)` });
    d.lines.push({ label: "Can be sped up later", value: a.rbf ? "Yes" : "No" });
    if (op.kind === "transfer" || op.broadcast) d.lines.push({ label: "Sends now", value: "Yes" });
    d.lines.push({ label: "Requested by", value: host });

    if (a.net !== 0n) d.balanceChanges.push({ asset: native, delta: a.net.toString() });
    if (a.fee !== undefined && allOurs) d.fee = { asset: native, amount: a.fee.toString() };
    if (a.fee !== undefined) d.simulated = true; // a fully specified PSBT has a deterministic outcome
    else d.warnings.push({ level: "caution", code: "simulation-failed", message: "Some coin amounts are missing, so we can't show the exact fee or result." });

    for (const x of a.inputs) {
      const risk = x.sign ? sighashRisk(x.sign.hashType) : undefined;
      if (risk) d.warnings.push({ level: risk.level, code: "blind-signing", message: risk.message });
    }
    if (a.fee !== undefined && a.feeRate !== undefined && a.feeRate > 500) {
      d.warnings.push({ level: "danger", code: "high-fee", message: `The network fee is unusually high (${a.feeRate} sat/vB).` });
    }
    if (op.kind === "psbt" && !builtHere(req)) await checkWitnessAmounts(ctx, tx, a, d.warnings);
    const ord = await inscribedInputs(ctx, a);
    if (ord.inscribed.length) {
      d.warnings.push({
        level: "danger",
        code: "inscribed-utxo",
        message: "This would spend a coin that holds a collectible (an ordinal inscription). Clip Wallet won't sign it, so the collectible can't be lost by accident.",
      });
    } else if (ord.unchecked) {
      d.warnings.push({ level: "caution", code: "simulation-failed", message: "We can't check whether these coins hold collectibles (ordinals). If they do, sending could lose them." });
    }
    return d;
  }

  /* ---------------------------------------------------------------- prepare */

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const op = normalize(req);
    checkSigners(op, ctx);
    if (op.kind === "message") {
      const { kind, address } = messageKind(op, ctx);
      const own = ownScripts(ctx.account);
      if (op.protocol === "ecdsa") {
        if (kind !== "wpkh") throw new ClipError("This kind of message signature doesn't work with this address.", "unsupported-protocol");
        const digest = bip137Digest(op.message);
        pending.set(req.id, { type: "message", kind, protocol: "ecdsa", message: op.message, digest, address, reply: op.reply });
        // Hardware wallets sign the BIP-137 message itself (bytes is its double-SHA256 digest).
        return [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: digest, approvalId, raw: { format: "bitcoin-message", bytes: op.message } }];
      }
      const digest = bip322Digest(op.message, kind, own);
      pending.set(req.id, { type: "message", kind, protocol: "bip322", message: op.message, digest, address, reply: op.reply });
      return kind === "wpkh"
        ? [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: digest, approvalId }]
        : // BIP-86 key path: empty merkle root; the vault derives the TapTweak from its own key.
          [{ accountId: ctx.account.id, scheme: "schnorr-secp256k1", bytes: digest, options: { taprootTweak: new Uint8Array(0) }, approvalId }];
    }

    const tx = await resolvePsbt(req, ctx, op);
    const a = analyzePsbt(tx, ctx.account, ctx.network, op.kind === "psbt" ? op.toSign : undefined, changeOf(req.id, ctx));
    if (op.kind === "psbt" && !builtHere(req)) await checkWitnessAmounts(ctx, tx, a);
    const ord = await inscribedInputs(ctx, a);
    if (ord.inscribed.length) {
      throw new ClipError("This would spend a coin that holds a collectible (ordinal), so Clip Wallet won't sign it.", "inscribed-utxo", ord.inscribed);
    }
    const digests = inputDigests(tx, a);
    pending.set(req.id, { type: "psbt", psbt: psbtBase64(tx), digests, op });
    // Hardware wallets get the whole PSBT and the input each payload signs.
    const psbtBytes = tx.toPSBT(0);
    return digests.map((g) => {
      const p: SignablePayload = { accountId: ctx.account.id, scheme: g.kind === "tr" ? "schnorr-secp256k1" : "ecdsa-secp256k1", bytes: g.digest, approvalId };
      p.raw = { format: "psbt", bytes: psbtBytes, inputIndex: g.index };
      if (g.kind === "tr") p.options = { taprootTweak: g.merkleRoot! }; // merkle root, never the tweak scalar
      if (g.subPath) p.derivationSubPath = g.subPath;
      return p;
    });
  }

  /* ---------------------------------------------------------------- finalize */

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const p = pending.get(req.id);
    if (!p) throw new ClipError("This request expired. Please try again from the app.", "not-prepared");
    const own = ownScripts(ctx.account);

    if (p.type === "message") {
      const sig = signatures[0];
      if (!sig) throw new ClipError("The request wasn't signed.", "no-signature");
      let signature: string;
      if (p.kind === "tr") {
        const s = checkSchnorr(sig, p.digest, own.trOutputKey);
        signature = encodeSimpleSignature([s]);
      } else if (p.protocol === "ecdsa") {
        const s = checkEcdsa(sig, p.digest, own.pubkey);
        const rec = recoveryFor(s, p.digest, own.pubkey);
        signature = base64.encode(concatBytes(Uint8Array.of(39 + rec), s.toBytes("compact")));
      } else {
        const s = checkEcdsa(sig, p.digest, own.pubkey);
        signature = encodeSimpleSignature([concatBytes(s.toBytes("der"), Uint8Array.of(SigHash.ALL)), own.pubkey]);
      }
      pending.delete(req.id);
      const messageHash = hex.encode(p.protocol === "ecdsa" ? p.digest : bip322MessageHash(p.message));
      return p.reply === "wc"
        ? { address: p.address, signature, messageHash }
        : [{ signature, signedMessage: base64.encode(p.message), messageHash, protocol: p.protocol }];
    }

    if (signatures.length !== p.digests.length) throw new ClipError("Some parts of this weren't signed. Nothing was sent.", "signature-count");
    const tx = parsePsbt(p.psbt);
    p.digests.forEach((g, i) => {
      const sig = signatures[i]!;
      if (g.kind === "wpkh") {
        const s = checkEcdsa(sig, g.digest, g.pubkey);
        tx.updateInput(g.index, { partialSig: [[g.pubkey, concatBytes(s.toBytes("der"), Uint8Array.of(g.hashType))]] }, true);
      } else {
        const s = checkSchnorr(sig, g.digest, g.outputKey);
        tx.updateInput(g.index, { tapKeySig: g.hashType === SigHash.DEFAULT ? s : concatBytes(s, Uint8Array.of(g.hashType)) }, true);
      }
    });
    for (const g of p.digests) tx.finalizeIdx(g.index);
    const sends = p.op.kind === "transfer" || p.op.broadcast;
    if (!sends) {
      pending.delete(req.id);
      const psbt = psbtBase64(tx);
      return p.op.reply === "wc" ? { psbt } : [{ psbt }];
    }
    if (!tx.isFinal) throw new ClipError("This transaction still needs other signatures, so it can't be sent yet.", "needs-other-signatures");
    const txid = await broadcast(ctx.network, ctx.fetch, hex.encode(tx.extract()));
    pending.delete(req.id);
    built.delete(req.id);
    builtChange.delete(req.id);
    if (p.op.kind === "transfer") return { txid };
    const psbt = psbtBase64(tx);
    return p.op.reply === "wc" ? { psbt, txid } : [{ txid, psbt }];
  }

  /* ---------------------------------------------------------------- balances */

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const own = ownScripts(ctx.account, ctx.changeAddresses ?? [], ctx.network);
    let total = 0n;
    for (const address of [...ownAddresses(own, ctx.network), ...own.change.map((c) => segwitAddress(c.pubkey, ctx.network))]) {
      const s = await esploraJson<EsploraAddress>(ctx.network, ctx.fetch, `/address/${address}`);
      total += BigInt(s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum + s.mempool_stats.funded_txo_sum - s.mempool_stats.spent_txo_sum);
    }
    return [{ asset: ctx.network.nativeAsset, amount: total.toString() }];
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const index = ordIndex(ctx.network);
    if (!index) return [];
    const own = ownScripts(ctx.account);
    const out: Nft[] = [];
    for (const address of ownAddresses(own, ctx.network)) {
      for (const id of await addressInscriptions(ctx.fetch, index, address)) {
        out.push({ networkId: ctx.network.id, standard: "ordinal", collection: { address: "ordinals", name: "Ordinals" }, tokenId: id, name: `Inscription ${id.slice(0, 8)}…`, mediaUrl: `${index.replace(/\/$/, "")}/content/${id}` });
      }
    }
    return out;
  }

  const mod: ChainModule & { pendingCount(): number } = {
    family: "bitcoin",
    curve: "secp256k1",
    derivationPath,
    addressFromPublicKey: (publicKey: Uint8Array, network: Network) => segwitAddress(publicKey, network),
    isAddress: (value: string) => BITCOIN_NETWORKS.some((n) => decodes(value, n)),
    /** Mainnet addresses match mainnet; tb1/m/n/2 addresses match testnet4 and signet alike (→ "network-matters"). */
    networksForAddress: (value: string, candidates: Network[]) => candidates.filter((n) => n.family === "bitcoin" && decodes(value, n)),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    async buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
      if (p.asset.networkId !== ctx.network.id || p.asset.address) throw new ClipError("Only BTC can be sent from this account.", "bad-asset");
      let amount: bigint;
      try {
        amount = BigInt(p.amount);
      } catch {
        throw new ClipError("Enter an amount above zero.", "bad-amount");
      }
      const id = newId();
      const tx = await buildPsbt(ctx, [{ address: p.to, amount }], id);
      return {
        id,
        origin: "clip-wallet://send",
        via: "injected",
        family: "bitcoin",
        networkId: ctx.network.id,
        method: BTC_METHODS.signAndSendTransaction,
        params: { inputs: [{ psbt: psbtBase64(tx), inputsToSign: [] }] },
      };
    },
    pendingCount: () => pending.size,
  };
  return mod;
}

function changeIndex(c: ChildAddress): number {
  return Number(/^1\/(\d+)$/.exec(c.derivationSubPath)?.[1] ?? Number.MAX_SAFE_INTEGER);
}

function decodes(value: string, n: Network): boolean {
  try {
    Address(btcNet(n)).decode(value);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ signature checks */

const N = secp256k1.Point.CURVE().n;

function checkEcdsa(sig: Signature, digest: Uint8Array, pubkey: Uint8Array) {
  if (sig.scheme !== "ecdsa-secp256k1" || sig.bytes.length !== 64) throw new ClipError("The signature didn't match this request.", "bad-signature");
  let s = secp256k1.Signature.fromBytes(sig.bytes, "compact");
  if (s.hasHighS()) s = new secp256k1.Signature(s.r, N - s.s);
  if (!secp256k1.verify(s.toBytes("compact"), digest, pubkey, { prehash: false })) {
    throw new ClipError("The signature didn't match your account, so nothing was sent.", "bad-signature");
  }
  return s;
}

function recoveryFor(s: InstanceType<typeof secp256k1.Signature>, digest: Uint8Array, pubkey: Uint8Array): number {
  for (const rec of [0, 1]) {
    try {
      if (hex.encode(s.addRecoveryBit(rec).recoverPublicKey(digest).toBytes(true)) === hex.encode(pubkey)) return rec;
    } catch {
      /* try next */
    }
  }
  throw new ClipError("The signature didn't match your account.", "bad-signature");
}

function isTaprootAddress(value: string, n: Network): boolean {
  try {
    return Address(btcNet(n)).decode(value).type === "tr";
  } catch {
    return false;
  }
}

/** BIP-340 check against the taproot OUTPUT key (the vault signs with the tweaked key). */
function checkSchnorr(sig: Signature, msg: Uint8Array, outputKey: Uint8Array | undefined): Uint8Array {
  if (sig.scheme !== "schnorr-secp256k1" || sig.bytes.length !== 64 || !outputKey) throw new ClipError("The signature didn't match this request.", "bad-signature");
  if (!schnorr.verify(sig.bytes, msg, outputKey)) throw new ClipError("The signature didn't match your account, so nothing was sent.", "bad-signature");
  return sig.bytes;
}
