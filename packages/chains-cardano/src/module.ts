import { type AssetRef, type ChainContext, type ChainModule, ClipError, type DappRequest, type DecodedRequest, type Network, type Nft, type Signature, type SignablePayload, type TokenBalance, type Warning, msg, titled, type Msg } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  type Credential,
  addressToBech32,
  addressToBytes,
  baseAddress,
  enterpriseAddress,
  isCardanoAddress,
  keyHash,
  parseAddress,
  parseAddressBytes,
  poolIdToBech32,
  poolIdToHex,
  rewardAddress,
  shortAddress,
} from "./address.js";
import { buildTx, encodeInput, encodeOutput, minAda, type Utxo, utxoFromKoios } from "./builder.js";
import { type CborValue, decode as cborDecode, encode } from "./cbor.js";
import { coseKey, coseSign1, sigStructure } from "./cose.js";
import { type Described, type Me, type Resolved, ada, describeTx, refOf } from "./describe.js";
import { Koios, type KoiosUtxo } from "./koios.js";
import { CARDANO_NETS, adaAsset, addressNetworkId, netOf } from "./networks.js";
import { assetMetas, assetRefFor, nftFor } from "./tokens.js";
import { type ParsedTx, addWitnesses, encodeWitnessSet, looksLikeTransaction, parseTransaction } from "./tx.js";
import { equal, fromHex, hex, hostOf, isHex, randomId, textOf } from "./util.js";
import { type Value, addValue, covers, emptyValue, encodeValue, parseValue } from "./value.js";

/**
 * DappRequest methods. CIP-30 calls arrive from 1Mask with these names (the same names WalletConnect's Cardano
 * namespace uses), so one decoder serves both.
 */
export const CARDANO_METHODS = {
  signTx: "cardano_signTx",
  signData: "cardano_signData",
  /** Wallet-built transactions (buildTransfer / buildDelegate): sign, then submit through Koios. */
  signAndSubmitTx: "cardano_signAndSubmitTx",
} as const;

/** Read-only CIP-30 calls answered by `read()` without an approval. */
export const CARDANO_READ_METHODS = [
  "cardano_getNetworkId",
  "cardano_getUtxos",
  "cardano_getCollateral",
  "cardano_getBalance",
  "cardano_getUsedAddresses",
  "cardano_getUnusedAddresses",
  "cardano_getChangeAddress",
  "cardano_getRewardAddresses",
  "cardano_submitTx",
] as const;
export type CardanoReadMethod = (typeof CARDANO_READ_METHODS)[number];

/**
 * When a transaction needs signatures this wallet can't make and partialSign is false, decode() fails with this
 * message (code "cardano/proof-generation"). 1Mask maps it to CIP-30 TxSignError.ProofGeneration.
 */
export const PROOF_GENERATION_MESSAGE = "Clip Wallet can't sign all of this transaction: it also needs other people's signatures.";
export const ADDRESS_NOT_PK_MESSAGE = "That address isn't controlled by a key in Clip Wallet, so it can't sign for it.";

/**
 * Which key under m/1852'/1815'/<account>' signs (core `SignablePayload.derivationSubPath`): the account's own key
 * (payment, role 0 index 0) needs no sub-path; the stake key is "2/0".
 */
export const STAKE_SUBPATH = "2/0";
const subPath = (role: "payment" | "stake"): { derivationSubPath?: string } => (role === "stake" ? { derivationSubPath: STAKE_SUBPATH } : {});

export interface CardanoModuleOptions {
  /** Validity window for wallet-built transactions, in slots (seconds). Default 2 hours. */
  ttlSlots?: number;
}

export interface StakingInfo {
  /** The reward (stake) address, bech32. */
  rewardAddress: string;
  registered: boolean;
  pool: { id: string; ticker?: string; name?: string } | null;
  /** Lovelace, decimal string. */
  rewardsAvailable: string;
  drep: string | null;
  /** Lovelace locked by the stake key registration (refunded on deregistration), when Koios reports it. */
  deposit?: string;
  /** Lovelace: ADA at the address plus rewards (Koios total_balance). */
  totalBalance?: string;
}

/**
 * Who the stake key's voting power goes to (Conway `drep`): one of the two predefined options, or a DRep's
 * credential (28-byte hash, hex).
 */
export type DrepChoice = "abstain" | "no-confidence" | { kind: "key" | "script"; hash: string };

export interface CardanoModule extends ChainModule {
  /** Read-only CIP-30 calls (no approval): getUtxos, getBalance, getChangeAddress … submitTx. */
  read(method: CardanoReadMethod, params: unknown, ctx: ChainContext): Promise<unknown>;
  getStaking(ctx: ChainContext): Promise<StakingInfo>;
  /** Registers the stake key if needed and delegates to `poolId` (bech32 "pool1…" or hex). */
  buildDelegate(p: { poolId: string }, ctx: ChainContext): Promise<DappRequest>;
  /** Delegates the stake key's voting power (Conway vote_deleg_cert, certificate 9). Stake key must be registered. */
  buildVoteDelegate(p: { drep: DrepChoice }, ctx: ChainContext): Promise<DappRequest>;
  /**
   * Withdraws all available rewards to the account's address. The ledger (protocol version 10+, since the Plomin
   * hard fork) refuses withdrawals for key-hash stake credentials not already delegated to a DRep, judged on the
   * state BEFORE the transaction's certificates, so the vote delegation must be a separate, earlier transaction.
   */
  buildWithdrawRewards(ctx: ChainContext): Promise<DappRequest>;
  /**
   * Stops staking: withdraws any rewards (required: the account must be empty) and unregisters the stake key with
   * certificate 8 (unreg_cert, refunding the recorded deposit). Same DRep rule as withdrawals when rewards > 0.
   */
  buildDeregister(ctx: ChainContext): Promise<DappRequest>;
}

type Normalized =
  | { kind: "tx"; tx: ParsedTx; partialSign: boolean; submit: boolean }
  | { kind: "data"; address: Uint8Array; payload: Uint8Array };

function invalid(what: string): ClipError {
  return new ClipError(`This request is missing its ${what}.`, "cardano/invalid-request");
}

function arg(params: unknown, index: number, key: string): unknown {
  if (Array.isArray(params)) return params[index];
  if (params && typeof params === "object") return (params as Record<string, unknown>)[key];
  return index === 0 ? params : undefined;
}

export function normalize(request: DappRequest): Normalized {
  switch (request.method) {
    case CARDANO_METHODS.signTx:
    case CARDANO_METHODS.signAndSubmitTx: {
      const raw = arg(request.params, 0, "tx");
      if (!isHex(raw) || raw.length === 0) throw invalid("transaction");
      let tx: ParsedTx;
      try {
        tx = parseTransaction(fromHex(raw));
      } catch (cause) {
        throw new ClipError("This transaction can't be read.", "cardano/bad-transaction", cause);
      }
      return { kind: "tx", tx, partialSign: arg(request.params, 1, "partialSign") === true, submit: request.method === CARDANO_METHODS.signAndSubmitTx };
    }
    case CARDANO_METHODS.signData: {
      const addr = arg(request.params, 0, "address");
      const payload = arg(request.params, 1, "payload");
      if (typeof addr !== "string") throw invalid("address");
      if (!isHex(payload)) throw invalid("message");
      let address: Uint8Array;
      try {
        address = addressToBytes(addr);
        parseAddressBytes(address);
      } catch (cause) {
        throw new ClipError("That isn't a Cardano address.", "cardano/invalid-request", cause);
      }
      return { kind: "data", address, payload: fromHex(payload) };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this Cardano request yet.", "cardano/unsupported-method");
  }
}

function koiosFor(ctx: ChainContext): Koios {
  const url = ctx.network.indexerUrl ?? ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("No Cardano connection is set up for this network.", "cardano/no-indexer");
  return new Koios(url, ctx.fetch);
}

/** This account's keys, from its public key (payment) and address (stake credential of a base address). */
export function meOf(ctx: ChainContext): Me & { address: Uint8Array } {
  const pub = fromHex(ctx.account.publicKey);
  if (pub.length !== 32) throw new ClipError("This Cardano account isn't set up correctly.", "cardano/bad-account");
  const paymentKeyHash = keyHash(pub);
  const address = addressToBytes(ctx.account.address);
  const parsed = parseAddressBytes(address);
  if (!parsed.payment || parsed.payment.kind !== "key" || !equal(parsed.payment.hash, paymentKeyHash)) {
    throw new ClipError("This Cardano account's address doesn't match its key.", "cardano/bad-account");
  }
  const me: Me & { address: Uint8Array } = { paymentKeyHash, networkId: addressNetworkId(ctx.network.id), address };
  if (parsed.stake) me.stake = parsed.stake;
  return me;
}

/** Same address bytes on the network the context is for (accounts may be stored with either prefix). */
function myAddress(ctx: ChainContext): Uint8Array {
  const me = meOf(ctx);
  return me.stake?.kind === "key" ? baseAddress(me.networkId, me.paymentKeyHash, me.stake.hash) : enterpriseAddress(me.networkId, me.paymentKeyHash);
}

function myRewardAddress(ctx: ChainContext): Uint8Array | null {
  const me = meOf(ctx);
  return me.stake ? rewardAddress(me.networkId, me.stake) : null;
}

async function myUtxos(ctx: ChainContext): Promise<Utxo[]> {
  const list = await koiosFor(ctx).addressUtxos([addressToBech32(myAddress(ctx))]);
  // UTxOs carrying reference scripts would add a reference-script fee; leave them out of automatic selection.
  return list.filter((u: KoiosUtxo) => !u.is_spent && !u.reference_script).map(utxoFromKoios);
}

export function createCardanoModule(options: CardanoModuleOptions = {}): CardanoModule {
  const ttlSlots = BigInt(options.ttlSlots ?? 7200);
  /** decode() results by request id, so prepare/finalize sign exactly what was shown. */
  const analysed = new Map<string, Described>();

  async function analyse(tx: ParsedTx, request: DappRequest, ctx: ChainContext): Promise<Described> {
    const cached = analysed.get(request.id);
    if (cached) return cached;
    const koios = koiosFor(ctx);
    const me = meOf(ctx);
    const refs = [...tx.body.inputs, ...tx.body.collateral].map(refOf);
    const infos = await koios.utxoInfo([...new Set(refs)]).catch(() => [] as KoiosUtxo[]);
    const resolved = new Map<string, Resolved>();
    for (const u of infos) {
      try {
        const x = utxoFromKoios(u);
        resolved.set(refOf(x.input), { address: x.address, value: x.value });
      } catch {
        /* skip malformed */
      }
    }
    const units = new Set<string>([...tx.body.mint.keys(), ...tx.body.outputs.flatMap((o) => [...o.value.assets.keys()])]);
    for (const r of resolved.values()) for (const u of r.value.assets.keys()) units.add(u);
    const metas = await assetMetas(koios, ctx.network.id, [...units]);
    const poolHashes = [...new Set(tx.body.certs.filter((c) => c.pool).map((c) => hex(c.pool!)))];
    const pools = new Map<string, string>();
    if (poolHashes.length) {
      const info = await koios.poolInfo(poolHashes.map((h) => poolIdToBech32(fromHex(h)))).catch(() => []);
      for (const p of info) {
        const t = p.meta_json?.ticker ?? p.meta_json?.name;
        if (t) pools.set(poolIdToHex(p.pool_id_bech32), `[${t}]`);
      }
    }
    let keyDeposit: bigint | undefined;
    if (tx.body.certs.some((c) => c.type === 0 || c.type === 1)) {
      keyDeposit = await koios.params().then((p) => BigInt(p.stakeAddressDeposit)).catch(() => undefined);
    }
    const d = describeTx(tx, {
      me,
      resolved,
      metas,
      networkId: ctx.network.id,
      host: request.origin === "clip-wallet" ? "Clip Wallet" : hostOf(request.origin),
      pools,
      ...(keyDeposit !== undefined ? { keyDeposit } : {}),
    });
    analysed.set(request.id, d);
    if (analysed.size > 64) analysed.delete(analysed.keys().next().value!);
    return d;
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(request);
    const base = { requestId: request.id, networkId: request.networkId };
    const host = hostOf(request.origin);

    if (n.kind === "tx") {
      const d = await analyse(n.tx, request, ctx);
      if (!d.needs.payment && !d.needs.stake) {
        throw new ClipError(n.partialSign ? "This transaction doesn't need your signature." : PROOF_GENERATION_MESSAGE, "cardano/proof-generation");
      }
      if (d.foreign.length && !n.partialSign) throw new ClipError(PROOF_GENERATION_MESSAGE, "cardano/proof-generation");
      const lines = [...d.lines, { label: "Network fee", value: ada(d.fee) }];
      if (d.foreign.length) lines.push({ label: "Also needs", value: `${d.foreign.length} other signature${d.foreign.length > 1 ? "s" : ""}` });
      if (!n.submit && request.origin !== "clip-wallet") lines.push({ label: "Sent by", value: `${host} (it gets your signature)` });
      const warnings: Warning[] = [...d.warnings];
      if (d.blind) warnings.push({ level: "danger", code: "blind-signing", message: "Parts of this transaction can't be explained. Only sign it if you trust the app." });
      return {
        ...base,
        title: d.title, ...msgOf(d),
        lines,
        balanceChanges: d.balanceChanges,
        fee: { asset: adaAsset(ctx.network.id), amount: d.fee.toString() },
        simulated: d.complete,
        blind: d.blind,
        warnings,
      };
    }

    const role = dataKeyRole(n.address, ctx);
    if (looksLikeTransaction(n.payload)) {
      throw new ClipError("This “message” is really a transaction in disguise. Clip Wallet won't sign it.", "cardano/message-is-transaction");
    }
    const text = textOf(n.payload);
    const lines = [
      text != null ? { label: "Message", value: text } : { label: "Message (not text)", value: hex(n.payload) },
      { label: "Signed as", value: `${shortAddress(n.address)}${role === "stake" ? " (staking key)" : ""}` },
    ];
    const blind = text == null;
    const warnings: Warning[] = blind ? [{ level: "danger", code: "blind-signing", message: "This message isn't readable text. Only sign it if you trust the app." }] : [];
    return { ...base, ...titled(msg("bg.req.signMessage", { host })), lines, balanceChanges: [], simulated: false, blind, warnings };
  }

  /** CIP-30 signData: payment key for our base/enterprise address, stake key for our reward address. */
  function dataKeyRole(address: Uint8Array, ctx: ChainContext): "payment" | "stake" {
    const me = meOf(ctx);
    const p = parseAddressBytes(address);
    if (p.kind === "reward") {
      if (p.stake?.kind !== "key") throw new ClipError(ADDRESS_NOT_PK_MESSAGE, "cardano/address-not-pk");
      if (me.stake && equal(p.stake.hash, me.stake.hash)) return "stake";
    } else {
      if (p.payment?.kind !== "key") throw new ClipError(ADDRESS_NOT_PK_MESSAGE, "cardano/address-not-pk");
      if (equal(p.payment.hash, me.paymentKeyHash)) return "payment";
    }
    throw new ClipError("That address isn't this account's, so Clip Wallet can't sign for it.", "cardano/proof-generation");
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const n = normalize(request);
    const accountId = ctx.account.id;
    if (n.kind === "data") {
      const role = dataKeyRole(n.address, ctx);
      return [{ accountId, scheme: "ed25519", bytes: sigStructure(n.address, n.payload), approvalId, ...subPath(role) }];
    }
    const d = await analyse(n.tx, request, ctx);
    const out: SignablePayload[] = [];
    if (d.needs.payment) out.push({ accountId, scheme: "ed25519", bytes: n.tx.bodyHash, approvalId, ...subPath("payment") });
    if (d.needs.stake) out.push({ accountId, scheme: "ed25519", bytes: n.tx.bodyHash, approvalId, ...subPath("stake") });
    if (!out.length) throw new ClipError("This transaction doesn't need your signature.", "cardano/proof-generation");
    return out;
  }

  /** Checks a signature against the expected key and returns the public key that made it. */
  function checked(sig: Signature | undefined, bytes: Uint8Array, role: "payment" | "stake", ctx: ChainContext): Uint8Array {
    const me = meOf(ctx);
    if (!sig || sig.scheme !== "ed25519") throw new ClipError("The signature didn't match. Nothing was sent.", "cardano/bad-signature");
    const pub = role === "payment" ? fromHex(ctx.account.publicKey) : fromHex(sig.publicKey);
    const expected = role === "payment" ? me.paymentKeyHash : me.stake?.kind === "key" ? me.stake.hash : null;
    if (!expected || pub.length !== 32 || !equal(keyHash(pub), expected) || !ed25519.verify(sig.bytes, bytes, pub)) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "cardano/bad-signature");
    }
    return pub;
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(request);
    if (n.kind === "data") {
      const role = dataKeyRole(n.address, ctx);
      const pub = checked(signatures[0], sigStructure(n.address, n.payload), role, ctx);
      return { signature: hex(coseSign1(n.address, n.payload, signatures[0]!.bytes)), key: hex(coseKey(pub)) };
    }
    const d = await analyse(n.tx, request, ctx);
    const roles: ("payment" | "stake")[] = [...(d.needs.payment ? ["payment" as const] : []), ...(d.needs.stake ? ["stake" as const] : [])];
    if (signatures.length !== roles.length) throw new ClipError("Some signatures are missing. Nothing was sent.", "cardano/bad-signature");
    const vkeys = roles.map((role, i) => ({ publicKey: checked(signatures[i], n.tx.bodyHash, role, ctx), signature: signatures[i]!.bytes }));
    analysed.delete(request.id);
    if (!n.submit) return hex(encodeWitnessSet(vkeys));
    const signed = addWitnesses(n.tx, vkeys);
    const txHash = await koiosFor(ctx).submit(signed);
    if (txHash !== hex(n.tx.bodyHash)) {
      throw new ClipError("Cardano reported a different transaction than the one you signed. Check your activity.", "cardano/send-mismatch");
    }
    return { txHash };
  }

  /* ------------------------------------------------------------ CIP-30 reads */

  function utxoCbor(u: Utxo): string {
    return hex(encode([encodeInput(u.input), encodeOutput(u.address, u.value)]));
  }

  function paginate<T>(list: T[], params: unknown, index: number): T[] {
    const p = arg(params, index, "paginate") as { page?: unknown; limit?: unknown } | undefined;
    if (!p) return list;
    const page = Number(p.page);
    const limit = Number(p.limit);
    if (!Number.isInteger(page) || !Number.isInteger(limit) || page < 0 || limit <= 0) throw invalid("page");
    return list.slice(page * limit, page * limit + limit);
  }

  async function read(method: CardanoReadMethod, params: unknown, ctx: ChainContext): Promise<unknown> {
    switch (method) {
      case "cardano_getNetworkId":
        return addressNetworkId(ctx.network.id);
      case "cardano_getUtxos": {
        const utxos = await myUtxos(ctx);
        const amountHex = arg(params, 0, "amount");
        let list = utxos;
        if (amountHex !== undefined && amountHex !== null) {
          if (!isHex(amountHex)) throw invalid("amount");
          const need = parseValue(cborDecode(fromHex(amountHex)));
          const picked: Utxo[] = [];
          const have = emptyValue();
          for (const u of [...utxos].sort((a, b) => (a.value.coin > b.value.coin ? -1 : 1))) {
            if (covers(have, need)) break;
            picked.push(u);
            addValue(have, u.value);
          }
          if (!covers(have, need)) return null;
          list = picked;
        }
        return paginate(list, params, 1).map(utxoCbor);
      }
      case "cardano_getCollateral": {
        const a = arg(params, 0, "amount");
        const raw = a && typeof a === "object" && !Array.isArray(a) ? (a as { amount?: unknown }).amount : a;
        if (raw !== undefined && raw !== null && !/^\d+$/.test(String(raw))) throw invalid("amount");
        const amount = BigInt(String(raw ?? "5000000"));
        const pure = (await myUtxos(ctx)).filter((u) => u.value.assets.size === 0).sort((a, b) => (a.value.coin < b.value.coin ? -1 : 1));
        const picked: Utxo[] = [];
        let sum = 0n;
        for (const u of pure) {
          if (sum >= amount || picked.length === 3) break;
          if (u.value.coin < 1_000_000n) continue;
          picked.push(u);
          sum += u.value.coin;
        }
        return sum >= amount ? picked.map(utxoCbor) : null;
      }
      case "cardano_getBalance": {
        const total = emptyValue();
        for (const u of await myUtxos(ctx)) addValue(total, u.value);
        return hex(encode(encodeValue(total)));
      }
      case "cardano_getUsedAddresses":
        return paginate([hex(myAddress(ctx))], params, 0);
      case "cardano_getUnusedAddresses":
        return [];
      case "cardano_getChangeAddress":
        return hex(myAddress(ctx));
      case "cardano_getRewardAddresses": {
        const r = myRewardAddress(ctx);
        return r ? [hex(r)] : [];
      }
      case "cardano_submitTx": {
        const raw = arg(params, 0, "tx");
        if (!isHex(raw)) throw invalid("transaction");
        try {
          parseTransaction(fromHex(raw));
        } catch (cause) {
          throw new ClipError("This transaction can't be read.", "cardano/bad-transaction", cause);
        }
        return koiosFor(ctx).submit(fromHex(raw));
      }
      default:
        throw new ClipError("Clip Wallet doesn't support this Cardano request yet.", "cardano/unsupported-method");
    }
  }

  /* ------------------------------------------------------------ balances, NFTs, staking */

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const total = emptyValue();
    for (const u of await koiosFor(ctx).addressUtxos([addressToBech32(myAddress(ctx))])) if (!u.is_spent) addValue(total, utxoFromKoios(u).value);
    const out: TokenBalance[] = [{ asset: adaAsset(ctx.network.id), amount: total.coin.toString() }];
    const metas = await assetMetas(koiosFor(ctx), ctx.network.id, [...total.assets.keys()]);
    for (const [unit, q] of total.assets) {
      const m = metas.get(unit)!;
      if (m.nft) continue; // shown by getNfts
      out.push({ asset: assetRefFor(ctx.network.id, m), amount: q.toString() });
    }
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const units = new Set<string>();
    for (const u of await koiosFor(ctx).addressUtxos([addressToBech32(myAddress(ctx))])) {
      if (u.is_spent) continue;
      for (const a of u.asset_list ?? []) units.add(a.policy_id + (a.asset_name ?? ""));
    }
    const metas = await assetMetas(koiosFor(ctx), ctx.network.id, [...units]);
    return [...metas.values()].filter((m) => m.nft).map((m) => nftFor(ctx.network.id, m));
  }

  async function getStaking(ctx: ChainContext): Promise<StakingInfo> {
    const r = myRewardAddress(ctx);
    if (!r) throw new ClipError("This account can't stake: its address has no staking part.", "cardano/no-stake-key");
    const stake = addressToBech32(r);
    const koios = koiosFor(ctx);
    const [info] = await koios.accountInfo([stake]);
    const out: StakingInfo = {
      rewardAddress: stake,
      registered: info?.status === "registered",
      pool: null,
      rewardsAvailable: info?.rewards_available ?? "0",
      drep: info?.delegated_drep ?? null,
    };
    if (info?.deposit != null) out.deposit = info.deposit;
    if (info?.total_balance != null) out.totalBalance = info.total_balance;
    if (info?.delegated_pool) {
      out.pool = { id: info.delegated_pool };
      const [p] = await koios.poolInfo([info.delegated_pool]).catch(() => []);
      if (p?.meta_json?.ticker) out.pool.ticker = p.meta_json.ticker;
      if (p?.meta_json?.name) out.pool.name = p.meta_json.name;
    }
    return out;
  }

  /* ------------------------------------------------------------ building */

  async function ttl(ctx: ChainContext): Promise<bigint> {
    const [tip] = await koiosFor(ctx).tip();
    if (!tip) throw new ClipError("Cardano didn't answer. Try again shortly.", "cardano/indexer-error");
    return BigInt(tip.abs_slot) + ttlSlots;
  }

  function wrap(body: Uint8Array, ctx: ChainContext): DappRequest {
    return {
      id: randomId(),
      origin: "clip-wallet",
      via: "injected",
      family: "cardano",
      networkId: ctx.network.id,
      method: CARDANO_METHODS.signAndSubmitTx,
      params: { tx: hex(concatTx(body)) },
    };
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const to = p.to.trim();
    if (!isCardanoAddress(to)) throw new ClipError("That doesn't look like a Cardano address.", "cardano/bad-address");
    const dest = parseAddress(to);
    if (dest.networkId !== addressNetworkId(ctx.network.id)) {
      throw new ClipError(
        `That address is for ${dest.networkId === 1 ? "Cardano mainnet" : "a Cardano test network"}, not this one. Sending there would fail.`,
        "cardano/wrong-network",
      );
    }
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "cardano/bad-amount");
    const amount = BigInt(p.amount);
    const [utxos, params, slot] = await Promise.all([myUtxos(ctx), koiosFor(ctx).params(), ttl(ctx)]);
    let value: Value;
    if (!p.asset.address) {
      value = { coin: amount, assets: new Map() };
      const min = minAda(dest.bytes, value, params);
      if (amount < min) throw new ClipError(`Cardano needs at least ${ada(min)} in a payment.`, "cardano/below-min-utxo");
    } else {
      const unit = p.asset.address.toLowerCase();
      if (!/^[0-9a-f]{56,120}$/.test(unit)) throw new ClipError("That token couldn't be found on Cardano.", "cardano/unknown-asset");
      value = { coin: 0n, assets: new Map([[unit, amount]]) };
      value.coin = minAda(dest.bytes, value, params);
    }
    const built = buildTx({ utxos, outputs: [{ address: dest.bytes, value }], changeAddress: myAddress(ctx), params, ttl: slot, witnesses: 1 });
    return wrap(built.body, ctx);
  }

  async function buildDelegate(p: { poolId: string }, ctx: ChainContext): Promise<DappRequest> {
    let pool: Uint8Array;
    try {
      pool = fromHex(poolIdToHex(p.poolId));
    } catch (cause) {
      throw new ClipError("That isn't a Cardano stake pool id.", "cardano/bad-pool", cause);
    }
    const me = meOf(ctx);
    if (me.stake?.kind !== "key") throw new ClipError("This account can't stake: its address has no staking key.", "cardano/no-stake-key");
    const cred: CborValue = [0, me.stake.hash];
    const [staking, params, utxos, slot] = await Promise.all([getStaking(ctx), koiosFor(ctx).params(), myUtxos(ctx), ttl(ctx)]);
    const certs: CborValue[] = [];
    let deposit = 0n;
    if (!staking.registered) {
      certs.push([0, cred]);
      deposit = BigInt(params.stakeAddressDeposit);
    }
    certs.push([2, cred, pool]);
    const built = buildTx({ utxos, outputs: [], changeAddress: myAddress(ctx), params, ttl: slot, certs, deposit, witnesses: 2 });
    return wrap(built.body, ctx);
  }

  function stakeCred(ctx: ChainContext): CborValue {
    const me = meOf(ctx);
    if (me.stake?.kind !== "key") throw new ClipError("This account can't stake: its address has no staking key.", "cardano/no-stake-key");
    return [0, me.stake.hash];
  }

  function drepCbor(d: DrepChoice): CborValue {
    if (d === "abstain") return [2];
    if (d === "no-confidence") return [3];
    if (d && typeof d === "object" && (d.kind === "key" || d.kind === "script") && /^[0-9a-f]{56}$/i.test(d.hash)) return [d.kind === "key" ? 0 : 1, fromHex(d.hash)];
    throw new ClipError("That isn't a voting choice Clip Wallet knows.", "cardano/bad-drep");
  }

  function needsVoteDelegation(): ClipError {
    return new ClipError("Cardano needs you to choose how your voting power counts before you can take out rewards.", "cardano/needs-vote-delegation");
  }

  async function buildVoteDelegate(p: { drep: DrepChoice }, ctx: ChainContext): Promise<DappRequest> {
    const cred = stakeCred(ctx);
    const drep = drepCbor(p.drep);
    const [staking, params, utxos, slot] = await Promise.all([getStaking(ctx), koiosFor(ctx).params(), myUtxos(ctx), ttl(ctx)]);
    if (!staking.registered) throw new ClipError("Start staking first; then you can choose how your vote counts.", "cardano/not-registered");
    const built = buildTx({ utxos, outputs: [], changeAddress: myAddress(ctx), params, ttl: slot, certs: [[9, cred, drep]], witnesses: 2 });
    return wrap(built.body, ctx);
  }

  async function buildWithdrawRewards(ctx: ChainContext): Promise<DappRequest> {
    stakeCred(ctx);
    const [staking, params, utxos, slot] = await Promise.all([getStaking(ctx), koiosFor(ctx).params(), myUtxos(ctx), ttl(ctx)]);
    if (!staking.registered) throw new ClipError("This account isn't staking.", "cardano/not-registered");
    const amount = BigInt(staking.rewardsAvailable);
    if (amount <= 0n) throw new ClipError("There are no rewards to take out yet.", "cardano/no-rewards");
    if (!staking.drep) throw needsVoteDelegation();
    const reward = myRewardAddress(ctx)!;
    const built = buildTx({ utxos, outputs: [], changeAddress: myAddress(ctx), params, ttl: slot, withdrawals: [{ rewardAddress: reward, amount }], witnesses: 2 });
    return wrap(built.body, ctx);
  }

  async function buildDeregister(ctx: ChainContext): Promise<DappRequest> {
    const cred = stakeCred(ctx);
    const [staking, params, utxos, slot] = await Promise.all([getStaking(ctx), koiosFor(ctx).params(), myUtxos(ctx), ttl(ctx)]);
    if (!staking.registered) throw new ClipError("This account isn't staking.", "cardano/not-registered");
    const rewards = BigInt(staking.rewardsAvailable);
    if (rewards > 0n && !staking.drep) throw needsVoteDelegation();
    const deposit = BigInt(staking.deposit ?? params.stakeAddressDeposit);
    const withdrawals = rewards > 0n ? [{ rewardAddress: myRewardAddress(ctx)!, amount: rewards }] : [];
    const built = buildTx({ utxos, outputs: [], changeAddress: myAddress(ctx), params, ttl: slot, certs: [[8, cred, deposit]], deposit: -deposit, withdrawals, witnesses: 2 });
    return wrap(built.body, ctx);
  }

  return {
    family: "cardano",
    curve: "bip32-ed25519",
    /** CIP-1852 payment key (role 0, index 0). The staking key is role 2: m/1852'/1815'/<index>'/2/0. */
    derivationPath: (index: number) => `m/1852'/1815'/${index}'/0/0`,
    /**
     * 32 bytes (payment key) → enterprise address; 64 bytes (payment key ‖ stake key) → base address, which is
     * what the vault should store as the account address so staking works.
     */
    addressFromPublicKey(publicKey: Uint8Array, network: Network): string {
      const nid = addressNetworkId(network.id);
      if (publicKey.length === 32) return addressToBech32(enterpriseAddress(nid, keyHash(publicKey)));
      if (publicKey.length === 64) return addressToBech32(baseAddress(nid, keyHash(publicKey.subarray(0, 32)), keyHash(publicKey.subarray(32))));
      throw new Error("Cardano public key must be 32 bytes (payment) or 64 bytes (payment ‖ stake)");
    },
    isAddress: isCardanoAddress,
    /** The address's network id picks mainnet (1) or the testnets (0); preprod and preview share 0. */
    networksForAddress(value: string, candidates: Network[]): Network[] {
      if (!isCardanoAddress(value)) return [];
      const nid = parseAddress(value).networkId;
      return candidates.filter((c) => c.family === "cardano" && netOf(c.id) && CARDANO_NETS[netOf(c.id)!].networkId === nid);
    },
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    read,
    getStaking,
    buildDelegate,
    buildVoteDelegate,
    buildWithdrawRewards,
    buildDeregister,
  };
}

/** Unsigned transaction around a body: [body, {}, true, null]. */
function concatTx(body: Uint8Array): Uint8Array {
  const head = Uint8Array.of(0x84);
  const tail = Uint8Array.of(0xa0, 0xf5, 0xf6);
  const out = new Uint8Array(1 + body.length + 3);
  out.set(head, 0);
  out.set(body, 1);
  out.set(tail, 1 + body.length);
  return out;
}

export type { Credential };

/** The Msg a described title carries (explicit titles keep it through the mapping to a DecodedRequest). */
function msgOf(d: { title: string }): { titleMsg?: Msg } {
  const m = (d as { titleMsg?: Msg }).titleMsg;
  return m ? { titleMsg: m } : {};
}
