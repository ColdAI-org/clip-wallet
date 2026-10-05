import { type AssetRef, type ChainContext, type ChainModule, ClipError, type DappRequest, type DecodedRequest, type Network, type Nft, type Signature, type SignablePayload, type TokenBalance, msg, type Msg } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  type SuggestedParams,
  type Transaction,
  SignedTransaction,
  decodeAddress,
  encodeAddress,
  encodeMsgpack,
  encodeUnsignedTransaction,
  isValidAddress,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
} from "algosdk";
import { type Algod, type AlgodAccount, AlgodError, algodFor, plainAlgorandError } from "./algod.js";
import {
  type AsaInfo,
  type Metadata,
  asaAsset,
  asaInfo,
  attributesOf,
  fetchJson,
  httpUrl,
  isArc19,
  isArc3,
  isNftAsset,
  resolveArc19Url,
  resolveRelative,
} from "./assets.js";
import { OPT_IN_LOCK, describeRequest, loadAssets } from "./describe.js";
import { algoAsset, specFor } from "./networks.js";
import { type Normalized, normalizeTxns } from "./txn.js";
import { b64decode, b64encode, big, formatUnits, hostOf, randomId, sleep } from "./util.js";

/**
 * Request methods. `algo_signTxn` is the ARC-25 / WalletConnect method (ARC-1 semantics). `algo_signAndPostTxn` is
 * Clip Wallet's own: same params, and the wallet also sends the transactions (used by buildTransfer / buildOptIn).
 * ARC-60 (arbitrary data signing) is still a Draft, so there's no `algo_signData`.
 */
export const ALGORAND_METHODS = {
  signTxn: "algo_signTxn",
  signAndPostTxn: "algo_signAndPostTxn",
} as const;

export interface AlgorandModuleOptions {
  /**
   * Key derivation the vault uses for Algorand. "arc52" (default): BIP32-Ed25519 (Peikert) at m/44'/283'/i'/0/0, as
   * Pera's Universal Wallet. "slip10": SLIP-10 ed25519 at m/44'/283'/i'/0'/0', as Trust Wallet. Signatures are plain
   * Ed25519 either way.
   */
  scheme?: "arc52" | "slip10";
  /** Run /v2/transactions/simulate in decode() (default true). */
  simulate?: boolean;
  ipfsGateway?: string;
  /** Delay between pending-transaction polls after sending (default 1000 ms). */
  confirmPollMs?: number;
  /** Pending-transaction polls before giving up waiting (default 8; the transaction is already accepted by then). */
  confirmAttempts?: number;
}

/** ALGO balance split into the part that must stay (min balance) and the part you can spend. microALGO strings. */
export interface AlgoSpendable {
  balance: string;
  locked: string;
  spendable: string;
}

const LONE_VALIDITY = 1000n; // MaxTxnLife (protocol parameters)

export function normalize(request: DappRequest, ctx: ChainContext): Normalized & { post: boolean } {
  if (request.method !== ALGORAND_METHODS.signTxn && request.method !== ALGORAND_METHODS.signAndPostTxn) {
    throw new ClipError("Clip Wallet doesn't support this Algorand request yet.", "algorand/unsupported-method");
  }
  const spec = specFor(request.networkId);
  if (!spec || request.networkId !== ctx.network.id) {
    throw new ClipError("This app is asking for a different Algorand network than the one it's connected to.", "algorand/network-mismatch");
  }
  return { ...normalizeTxns(request.params, ctx.account.address, spec), post: request.method === ALGORAND_METHODS.signAndPostTxn };
}

function publicKeyOf(ctx: ChainContext): Uint8Array {
  return decodeAddress(ctx.account.address).publicKey;
}

function suggested(p: Awaited<ReturnType<Algod["params"]>>): SuggestedParams & { fee: bigint; minFee: bigint } {
  const last = big(p["last-round"]);
  return {
    fee: big(p.fee),
    minFee: big(p["min-fee"]),
    firstValid: last,
    lastValid: last + LONE_VALIDITY,
    genesisHash: b64decode(p["genesis-hash"]),
    genesisID: p["genesis-id"],
  };
}

function request(ctx: ChainContext, txns: Transaction[]): DappRequest {
  return {
    id: randomId(),
    origin: "clip-wallet",
    via: "injected",
    family: "algorand",
    networkId: ctx.network.id,
    method: ALGORAND_METHODS.signAndPostTxn,
    params: [txns.map((t) => ({ txn: b64encode(encodeUnsignedTransaction(t)) }))],
  };
}

function assetIdOf(asset: AssetRef | string | number | bigint): string {
  const id = typeof asset === "object" ? asset.address : String(asset);
  if (!id || !/^\d+$/.test(id) || id === "0") throw new ClipError("That isn't an Algorand token.", "algorand/bad-asset");
  return id;
}

export function createAlgorandModule(options: AlgorandModuleOptions = {}): ChainModule & {
  normalize: typeof normalize;
  buildOptIn(p: { asset: AssetRef | string | number | bigint }, ctx: ChainContext): Promise<DappRequest>;
  buildOptOut(p: { asset: AssetRef | string | number | bigint }, ctx: ChainContext): Promise<DappRequest>;
  spendable(ctx: ChainContext): Promise<AlgoSpendable>;
} {
  const gateway = options.ipfsGateway ?? "https://ipfs.io/ipfs/";
  const slip10 = options.scheme === "slip10";
  const pollMs = options.confirmPollMs ?? 1000;
  const attempts = options.confirmAttempts ?? 8;

  async function spendableOf(algod: Algod, me: string): Promise<{ balance: bigint; locked: bigint; spendable: bigint; account: AlgodAccount }> {
    const account = await algod.account(me);
    const balance = big(account.amount);
    const locked = big(account["min-balance"]);
    return { balance, locked, spendable: balance > locked ? balance - locked : 0n, account };
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(req, ctx);
    const me = ctx.account.address;
    const algod = algodFor(ctx);
    const account = await algod.account(me).catch(() => null);
    const authAddr = account?.["auth-addr"];
    if (authAddr && authAddr !== me && n.items.some((i) => i.sign && !i.sgnr && i.sender === me)) {
      throw new ClipError("This account is controlled by another key, so Clip Wallet can't sign for it.", "algorand/rekeyed");
    }
    const params = await algod.params().catch(() => null);
    const d = await describeRequest(n, {
      networkId: ctx.network.id,
      me,
      algod,
      lastRound: params ? big(params["last-round"]) : null,
      balance: account ? big(account.amount) : null,
      simulate: options.simulate ?? true,
    });
    const lines = [...d.lines, { label: "Network fee", value: `${formatUnits(d.fee, 6)} ALGO` }];
    const algoOut = d.balanceChanges.find((c) => c.asset.key === "algo" && BigInt(c.delta) < 0n);
    if (account && (algoOut || n.items.some((i) => i.sign && i.txn.assetTransfer && i.txn.assetTransfer.amount === 0n))) {
      lines.push({ label: "Stays locked", value: `${formatUnits(big(account["min-balance"]), 6)} ALGO (your account's minimum balance)` });
    }
    if (!n.post) lines.push({ label: "Sent by", value: `${hostOf(req.origin)} (it gets the signed transactions)` });
    return {
      requestId: req.id,
      networkId: req.networkId,
      title: d.title, ...msgOf(d),
      lines,
      balanceChanges: d.balanceChanges,
      fee: { asset: algoAsset(ctx.network.id), amount: d.fee.toString() },
      simulated: d.simulated,
      blind: d.blind,
      warnings: d.warnings,
    };
  }

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const n = normalize(req, ctx);
    // ed25519 over "TX" || canonical msgpack(txn) (Transaction.bytesToSign).
    return n.items.filter((i) => i.sign).map((i) => ({ accountId: ctx.account.id, scheme: "ed25519", bytes: i.txn.bytesToSign(), approvalId }));
  }

  async function confirm(algod: Algod, txId: string, hints: Parameters<typeof plainAlgorandError>[1]): Promise<void> {
    for (let k = 0; k < attempts; k++) {
      const p = await algod.get<{ "confirmed-round"?: unknown; "pool-error"?: string }>(`/v2/transactions/pending/${txId}`).catch(() => null);
      if (p?.["pool-error"]) throw new ClipError(plainAlgorandError(p["pool-error"], hints), "algorand/send-failed");
      if (p && big(p["confirmed-round"]) > 0n) return;
      if (pollMs > 0) await sleep(pollMs);
    }
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(req, ctx);
    const toSign = n.items.filter((i) => i.sign);
    if (signatures.length !== toSign.length) throw new ClipError("Some signatures are missing. Nothing was sent.", "algorand/bad-signature");
    const pub = publicKeyOf(ctx);
    const blobs: (Uint8Array | null)[] = n.items.map((i) => i.stxn ?? null);
    toSign.forEach((item, k) => {
      const sig = signatures[k]!;
      if (sig.scheme !== "ed25519" || sig.bytes.length !== 64 || !ed25519.verify(sig.bytes, item.txn.bytesToSign(), pub)) {
        throw new ClipError("The signature didn't match. Nothing was sent.", "algorand/bad-signature");
      }
      const stxn = new SignedTransaction(item.sgnr ? { txn: item.txn, sig: sig.bytes, sgnr: decodeAddress(item.sgnr) } : { txn: item.txn, sig: sig.bytes });
      blobs[item.index] = encodeMsgpack(stxn);
    });

    if (!n.post) return blobs.map((b) => (b ? b64encode(b) : null));

    const algod = algodFor(ctx);
    const assets = await loadAssets(
      algod,
      n.items.flatMap((i) => (i.txn.assetTransfer ? [i.txn.assetTransfer.assetIndex] : [])),
    );
    const hints = { me: ctx.account.address, tokenName: (id: string) => assets.get(id)?.unitName || undefined };
    const txIds: string[] = [];
    for (const g of n.groups) {
      if (g.some((i) => !blobs[i])) {
        throw new ClipError("Part of this group is signed by someone else and wasn't included, so nothing was sent.", "algorand/missing-signature");
      }
      const parts = g.map((i) => blobs[i]!);
      const body = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
      let at = 0;
      for (const p of parts) {
        body.set(p, at);
        at += p.length;
      }
      let txId: string;
      try {
        txId = (await algod.post<{ txId: string }>("/v2/transactions", body, "application/x-binary")).txId;
      } catch (e) {
        if (e instanceof AlgodError) throw new ClipError(plainAlgorandError(e.message, hints), "algorand/send-failed", e);
        throw new ClipError("Couldn't reach the Algorand network. Nothing was sent.", "algorand/offline", e);
      }
      await confirm(algod, txId, hints);
      txIds.push(...g.map((i) => n.items[i]!.txn.txID()));
    }
    return { txId: txIds[0]!, txIds };
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const algod = algodFor(ctx);
    const account = await algod.account(ctx.account.address);
    const out: TokenBalance[] = [{ asset: algoAsset(ctx.network.id), amount: big(account.amount).toString() }];
    for (const h of account.assets ?? []) {
      const id = String(big(h["asset-id"]));
      const info = await asaInfo(algod, id).catch(() => null);
      if (info && isNftAsset(info)) continue; // shown by getNfts
      out.push({ asset: asaAsset(ctx.network.id, id, info), amount: big(h.amount).toString() });
    }
    return out;
  }

  async function arc69Note(algod: Algod, id: string): Promise<Metadata | null> {
    let latest: Metadata | null = null;
    let next = "";
    for (let page = 0; page < 5; page++) {
      let r: { transactions?: { note?: string }[]; "next-token"?: string };
      try {
        r = await algod.indexer(`/v2/assets/${id}/transactions?tx-type=acfg&limit=100${next ? `&next=${encodeURIComponent(next)}` : ""}`);
      } catch {
        break;
      }
      for (const t of r.transactions ?? []) {
        if (!t.note) continue;
        try {
          const md = JSON.parse(new TextDecoder().decode(b64decode(t.note))) as Metadata;
          if (md && typeof md === "object" && md.standard === "arc69") latest = md; // ascending rounds: keep the last
        } catch {
          /* not JSON */
        }
      }
      if (!r["next-token"] || !r.transactions?.length) break;
      next = r["next-token"];
    }
    return latest;
  }

  async function nftOf(ctx: ChainContext, algod: Algod, info: AsaInfo): Promise<Nft> {
    const nft: Nft = {
      networkId: ctx.network.id,
      standard: "arc69",
      collection: { address: info.creator, name: info.unitName || info.name || "Collection" },
      tokenId: info.id,
    };
    if (info.name) nft.name = info.name.replace(/@arc3$/, "");
    let md: Metadata | null = null;
    let base = info.url.replace(/\{id\}/g, info.id);
    if (isArc19(info)) {
      nft.standard = "arc19";
      const resolved = resolveArc19Url(info.url, info.reserve);
      if (resolved) {
        base = resolved;
        if (isArc3(info) || /\.json$/i.test(resolved.replace(/#.*$/, ""))) md = await fetchJson(httpUrl(resolved, gateway), ctx.fetch);
        else nft.mediaUrl = httpUrl(resolved, gateway);
      }
    } else if (isArc3(info)) {
      nft.standard = "arc3";
      md = await fetchJson(httpUrl(base, gateway), ctx.fetch);
    } else {
      md = await arc69Note(algod, info.id);
      const media = md?.media_url || info.url.replace(/#[ivaph]$/, "");
      if (media) nft.mediaUrl = httpUrl(media, gateway); // untrusted: sandboxed media proxy only
    }
    if (md) {
      if (md.name && nft.standard !== "arc69") nft.name = md.name;
      const image = md.image ?? md.animation_url;
      if (image && nft.standard !== "arc69") nft.mediaUrl = httpUrl(resolveRelative(image.replace(/\{id\}/g, info.id), base), gateway);
      const attrs = attributesOf(md);
      if (attrs.length) nft.attributes = attrs;
    }
    return nft;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const algod = algodFor(ctx);
    const account = await algod.account(ctx.account.address);
    const out: Nft[] = [];
    for (const h of account.assets ?? []) {
      if (big(h.amount) === 0n) continue;
      const info = await asaInfo(algod, big(h["asset-id"])).catch(() => null);
      if (!info || !isNftAsset(info)) continue;
      out.push(await nftOf(ctx, algod, info));
    }
    return out;
  }

  function checkAddress(to: string, me: string): string {
    const t = to.trim();
    if (!isValidAddress(t)) throw new ClipError("That doesn't look like an Algorand address.", "algorand/bad-address");
    if (t === me) throw new ClipError("That's your own address.", "algorand/self-transfer");
    return t;
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const me = ctx.account.address;
    const to = checkAddress(p.to, me);
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "algorand/bad-amount");
    const amount = BigInt(p.amount);
    const algod = algodFor(ctx);
    const params = suggested(await algod.params());
    const fee = params.minFee > params.fee ? params.minFee : params.fee;
    const mine = await spendableOf(algod, me);
    if (mine.account["auth-addr"] && mine.account["auth-addr"] !== me) {
      throw new ClipError("This account is controlled by another key, so Clip Wallet can't sign for it.", "algorand/rekeyed");
    }

    if (!p.asset.address) {
      if (amount + fee > mine.spendable) {
        throw new ClipError(
          `You don't have enough ALGO. ${formatUnits(mine.locked, 6)} ALGO has to stay in your account, and the fee is ${formatUnits(fee, 6)} ALGO.`,
          "algorand/insufficient-funds",
        );
      }
      const rec = await algod.account(to);
      const recMin = big(rec["min-balance"]) || 100_000n;
      if (big(rec.amount) + amount < recMin) {
        throw new ClipError(
          `This Algorand account needs at least ${formatUnits(recMin - big(rec.amount), 6)} ALGO to be able to hold it. Send at least that much.`,
          "algorand/below-min-balance",
        );
      }
      const txn = makePaymentTxnWithSuggestedParamsFromObject({ sender: me, receiver: to, amount, suggestedParams: params });
      return request(ctx, [txn]);
    }

    const id = assetIdOf(p.asset);
    const info = await asaInfo(algod, id);
    if (!info) throw new ClipError("That token couldn't be found on Algorand.", "algorand/unknown-asset");
    const symbol = info.unitName || p.asset.symbol;
    const held = await algod.holding(me, id);
    if (!held) throw new ClipError(`You haven't added ${symbol} to your account.`, "algorand/not-opted-in");
    if (held.amount < amount) throw new ClipError(msg("bg.err.notEnough", { symbol: symbol }), "algorand/insufficient-token");
    if (held.frozen) throw new ClipError(`Your ${symbol} is frozen by its issuer, so it can't move right now.`, "algorand/frozen");
    if (fee > mine.spendable) throw new ClipError("You need a little ALGO to pay the network fee.", "algorand/insufficient-funds");
    const theirs = await algod.holding(to, id);
    if (!theirs) {
      throw new ClipError(`They haven't added ${symbol} to their Algorand account yet. Ask them to add it first.`, "algorand/recipient-not-opted-in");
    }
    const txn = makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: me, receiver: to, amount, assetIndex: BigInt(id), suggestedParams: params });
    return request(ctx, [txn]);
  }

  async function buildOptIn(p: { asset: AssetRef | string | number | bigint }, ctx: ChainContext): Promise<DappRequest> {
    const me = ctx.account.address;
    const id = assetIdOf(p.asset);
    const algod = algodFor(ctx);
    const info = await asaInfo(algod, id);
    if (!info) throw new ClipError("That token couldn't be found on Algorand.", "algorand/unknown-asset");
    const symbol = info.unitName || info.name || `token ${id}`;
    if (await algod.holding(me, id)) throw new ClipError(`${symbol} is already in your account.`, "algorand/already-opted-in");
    const params = suggested(await algod.params());
    const fee = params.minFee > params.fee ? params.minFee : params.fee;
    const mine = await spendableOf(algod, me);
    if (mine.spendable < OPT_IN_LOCK + fee) {
      throw new ClipError(`Adding ${symbol} locks 0.1 ALGO, plus a ${formatUnits(fee, 6)} ALGO fee. Add some ALGO first.`, "algorand/insufficient-funds");
    }
    const txn = makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: me, receiver: me, amount: 0n, assetIndex: BigInt(id), suggestedParams: params });
    return request(ctx, [txn]);
  }

  /**
   * Removes a token (opt-out): a 0-amount transfer that closes the holding to the token's issuer. Refused while you
   * still hold some, because a close-out sends everything left to the close-to account.
   */
  async function buildOptOut(p: { asset: AssetRef | string | number | bigint }, ctx: ChainContext): Promise<DappRequest> {
    const me = ctx.account.address;
    const id = assetIdOf(p.asset);
    const algod = algodFor(ctx);
    const info = await asaInfo(algod, id);
    if (!info) throw new ClipError("That token couldn't be found on Algorand.", "algorand/unknown-asset");
    const symbol = info.unitName || info.name || `token ${id}`;
    const held = await algod.holding(me, id);
    if (!held) throw new ClipError(`${symbol} isn't in your account.`, "algorand/not-opted-in");
    if (info.creator === me) throw new ClipError(`You created ${symbol}, so it can't be removed from your account.`, "algorand/creator-opt-out");
    if (held.amount > 0n) {
      throw new ClipError(`You still have ${formatUnits(held.amount, info.decimals)} ${symbol}. Send it somewhere first, then remove it.`, "algorand/opt-out-nonzero");
    }
    const params = suggested(await algod.params());
    const txn = makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: me,
      receiver: info.creator,
      closeRemainderTo: info.creator,
      amount: 0n,
      assetIndex: BigInt(id),
      suggestedParams: params,
    });
    return request(ctx, [txn]);
  }

  async function spendable(ctx: ChainContext): Promise<AlgoSpendable> {
    const s = await spendableOf(algodFor(ctx), ctx.account.address);
    return { balance: s.balance.toString(), locked: s.locked.toString(), spendable: s.spendable.toString() };
  }

  return {
    family: "algorand",
    curve: slip10 ? "ed25519" : "bip32-ed25519",
    /** ARC-52 (default) or SLIP-10 (option): see README. */
    derivationPath: (index: number) => (slip10 ? `m/44'/283'/${index}'/0'/0'` : `m/44'/283'/${index}'/0/0`),
    addressFromPublicKey(publicKey: Uint8Array, _network: Network): string {
      if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
      return encodeAddress(publicKey);
    },
    isAddress: (value: string) => isValidAddress(value.trim()),
    /** The same address works on every Algorand network. */
    networksForAddress: (value: string, candidates: Network[]) => (isValidAddress(value.trim()) ? candidates.filter((c) => c.family === "algorand") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    buildOptIn,
    buildOptOut,
    spendable,
    normalize,
  };
}

/** The Msg a described title carries (explicit titles keep it through the mapping to a DecodedRequest). */
function msgOf(d: { title: string }): { titleMsg?: Msg } {
  const m = (d as { titleMsg?: Msg }).titleMsg;
  return m ? { titleMsg: m } : {};
}
