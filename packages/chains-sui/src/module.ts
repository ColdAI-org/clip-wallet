import { type AssetRef, type ChainContext, type ChainModule, ClipError, type DappRequest, type DecodedRequest, type Network, type Nft, type Signature, type SignablePayload, type TokenBalance, type Warning, msg, titled, say, type Msg } from "@clip-wallet/core";
import { bcs } from "@mysten/sui/bcs";
import { messageWithIntent } from "@mysten/sui/cryptography";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { type TransactionData, Transaction, TransactionDataBuilder, coinWithBalance } from "@mysten/sui/transactions";
import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { assetFor, coinMeta, describeTransaction } from "./describe.js";
import { GraphQLError, type ObjectNode, Q, SuiGraphQL, plainSuiError } from "./graphql.js";
import { SUI_TYPE, fromChainId, suiAsset, suiNetworkOf } from "./networks.js";
import { BoundedMap, b64decode, b64encode, formatUnits, fromHex, hex, hostOf, randomId, textOf } from "./util.js";

/** Injected (Sui Wallet Standard via 1Mask) and WalletConnect (Reown Sui RPC reference) method names. */
export const SUI_METHODS = {
  signTransaction: "sui:signTransaction",
  signAndExecuteTransaction: "sui:signAndExecuteTransaction",
  signPersonalMessage: "sui:signPersonalMessage",
  wcSignTransaction: "sui_signTransaction",
  wcSignAndExecuteTransaction: "sui_signAndExecuteTransaction",
  wcSignPersonalMessage: "sui_signPersonalMessage",
} as const;

/** Signature scheme flag prepended to a serialized Sui signature (flag || sig || pubkey). */
export const ED25519_FLAG = 0x00;

export interface SuiModuleOptions {
  /** Dry-run transactions in decode() (default true). */
  simulate?: boolean;
  /** Max pages of owned objects scanned for NFTs (50 per page, default 4). */
  nftPages?: number;
}

export interface StakePosition {
  stakeId: string;
  poolId: string;
  /** MIST. */
  principal: string;
  activationEpoch: string;
}

type Normalized =
  | { kind: "tx"; execute: boolean; wc: boolean; source: string }
  | { kind: "message"; wc: boolean; message: Uint8Array };

function bad(what: string): ClipError {
  return new ClipError(`This request is missing its ${what}.`, "sui/bad-params");
}

function accountAddress(a: unknown): string | null {
  if (typeof a === "string") return a;
  if (a && typeof a === "object" && typeof (a as { address?: unknown }).address === "string") return (a as { address: string }).address;
  return null;
}

function firstInput(params: unknown): Record<string, unknown> {
  if (params && typeof params === "object") {
    const inputs = (params as { inputs?: unknown }).inputs;
    if (Array.isArray(inputs)) {
      if (inputs.length !== 1 || !inputs[0] || typeof inputs[0] !== "object") throw bad("details");
      return inputs[0] as Record<string, unknown>;
    }
    return params as Record<string, unknown>;
  }
  throw bad("details");
}

function sameAddress(a: string, b: string): boolean {
  try {
    return normalizeSuiAddress(a) === normalizeSuiAddress(b);
  } catch {
    return false;
  }
}

export function normalize(request: DappRequest, me: string): Normalized {
  const i = firstInput(request.params);
  const acct = accountAddress(i.account) ?? (typeof i.address === "string" ? i.address : null);
  if (acct && !sameAddress(acct, me)) throw new ClipError("This request is for a different account than the one you connected.", "sui/wrong-account");
  if (typeof i.chain === "string" && fromChainId(i.chain) !== request.networkId) {
    throw new ClipError("This app is asking for a different Sui network than the one it's connected to.", "sui/network-mismatch");
  }
  switch (request.method) {
    case SUI_METHODS.signTransaction:
    case SUI_METHODS.signAndExecuteTransaction:
    case SUI_METHODS.wcSignTransaction:
    case SUI_METHODS.wcSignAndExecuteTransaction: {
      if (typeof i.transaction !== "string" || !i.transaction) throw bad("transaction");
      return {
        kind: "tx",
        execute: request.method === SUI_METHODS.signAndExecuteTransaction || request.method === SUI_METHODS.wcSignAndExecuteTransaction,
        wc: request.method.startsWith("sui_"),
        source: i.transaction,
      };
    }
    case SUI_METHODS.signPersonalMessage: {
      if (typeof i.message !== "string") throw bad("message");
      return { kind: "message", wc: false, message: b64decode(i.message) };
    }
    case SUI_METHODS.wcSignPersonalMessage: {
      if (typeof i.message !== "string") throw bad("message");
      // Reown's Sui reference passes the message as a string; it is signed as its UTF-8 bytes.
      return { kind: "message", wc: true, message: new TextEncoder().encode(i.message) };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this Sui request yet.", "sui/unsupported-method");
  }
}

function gqlFor(ctx: ChainContext): SuiGraphQL {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("No Sui connection is set up for this network.", "sui/no-rpc");
  return new SuiGraphQL(url, ctx.fetch);
}

function sdkClient(ctx: ChainContext): SuiGraphQLClient {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("No Sui connection is set up for this network.", "sui/no-rpc");
  const network = suiNetworkOf(ctx.network.id) ?? "testnet";
  return new SuiGraphQLClient({ url, network, fetch: ctx.fetch });
}

/** The 32-byte digest Sui's ed25519 signatures cover: blake2b-256(intent || BCS). */
export function transactionDigestToSign(txBytes: Uint8Array): Uint8Array {
  return blake2b(messageWithIntent("TransactionData", txBytes), { dkLen: 32 });
}

export function personalMessageDigestToSign(message: Uint8Array): Uint8Array {
  return blake2b(messageWithIntent("PersonalMessage", bcs.byteVector().serialize(message).toBytes()), { dkLen: 32 });
}

export function suiAddressFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  const buf = new Uint8Array(33);
  buf[0] = ED25519_FLAG;
  buf.set(publicKey, 1);
  return `0x${hex(blake2b(buf, { dkLen: 32 }))}`;
}

export function serializeSignature(sig: Uint8Array, publicKey: Uint8Array): string {
  const out = new Uint8Array(1 + sig.length + publicKey.length);
  out[0] = ED25519_FLAG;
  out.set(sig, 1);
  out.set(publicKey, 1 + sig.length);
  return b64encode(out);
}

const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

function parseData(bytes: Uint8Array): TransactionData {
  try {
    return TransactionDataBuilder.fromBytes(bytes).snapshot();
  } catch (cause) {
    throw new ClipError("This transaction can't be read.", "sui/bad-transaction", cause);
  }
}

export function createSuiModule(options: SuiModuleOptions = {}): ChainModule & {
  normalize: typeof normalize;
  getStakes(ctx: ChainContext): Promise<StakePosition[]>;
} {
  /** request id → final transaction bytes, so decode, prepare and finalize all see the same bytes. */
  const built = new BoundedMap<string, Uint8Array>();

  async function txBytes(request: DappRequest, n: Extract<Normalized, { kind: "tx" }>, ctx: ChainContext): Promise<Uint8Array> {
    const cached = built.get(request.id);
    if (cached) return cached;
    const me = normalizeSuiAddress(ctx.account.address);
    let bytes: Uint8Array;
    if (n.source.trimStart().startsWith("{")) {
      // Unresolved transaction JSON from the Wallet Standard (`transaction.toJSON()`): resolve it here.
      let tx: Transaction;
      try {
        tx = Transaction.from(n.source);
      } catch (cause) {
        throw new ClipError("This transaction can't be read.", "sui/bad-transaction", cause);
      }
      tx.setSenderIfNotSet(me);
      try {
        bytes = await tx.build({ client: sdkClient(ctx) });
      } catch (cause) {
        if (cause instanceof ClipError) throw cause;
        throw new ClipError(plainSuiError(String((cause as Error)?.message ?? cause)), "sui/build-failed", cause);
      }
    } else {
      try {
        bytes = b64decode(n.source);
      } catch (cause) {
        throw new ClipError("This transaction can't be read.", "sui/bad-transaction", cause);
      }
    }
    const data = parseData(bytes);
    if (!data.sender || normalizeSuiAddress(data.sender) !== me) {
      throw new ClipError("This transaction is for a different account than the one you connected.", "sui/not-a-signer");
    }
    built.set(request.id, bytes);
    return bytes;
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const me = ctx.account.address;
    const n = normalize(request, me);
    const base = { requestId: request.id, networkId: request.networkId };
    const host = hostOf(request.origin);

    if (n.kind === "message") {
      const text = textOf(n.message);
      const blind = text == null;
      const warnings: Warning[] = blind
        ? [{ level: "danger", code: "blind-signing", message: "This message isn't readable text. Only sign it if you trust the app." }]
        : [];
      return {
        ...base,
        ...titled(msg("bg.req.signMessage", { host })),
        lines: [text != null ? { label: "Message", value: text } : { label: "Message (not text)", value: `0x${hex(n.message)}` }],
        balanceChanges: [],
        simulated: false,
        blind,
        warnings,
      };
    }

    const bytes = await txBytes(request, n, ctx);
    const data = parseData(bytes);
    const gql = gqlFor(ctx);
    const d = await describeTransaction(data, bytes, { networkId: ctx.network.id, me, gql, host, simulate: options.simulate ?? true });
    const lines = [...d.lines];
    if (!d.sponsored) {
      const max = BigInt(data.gasData.budget ?? 0);
      lines.push({ label: "Network fee", value: `${formatUnits(d.fee, 9)} SUI${d.simulated && max > d.fee ? ` (at most ${formatUnits(max, 9)})` : ""}` });
    }
    if (!n.execute) lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });
    const fee: NonNullable<DecodedRequest["fee"]> = { asset: suiAsset(ctx.network.id), amount: d.fee.toString() };
    if (d.sponsored) fee.sponsored = true;
    return { ...base, title: d.title, ...msgOf(d), lines, balanceChanges: d.balanceChanges, fee, simulated: d.simulated, blind: false, warnings: d.warnings };
  }

  async function digestFor(request: DappRequest, ctx: ChainContext): Promise<{ n: Normalized; digest: Uint8Array; bytes: Uint8Array }> {
    const n = normalize(request, ctx.account.address);
    if (n.kind === "message") return { n, digest: personalMessageDigestToSign(n.message), bytes: n.message };
    const bytes = await txBytes(request, n, ctx);
    return { n, digest: transactionDigestToSign(bytes), bytes };
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const { digest } = await digestFor(request, ctx);
    return [{ accountId: ctx.account.id, scheme: "ed25519", bytes: digest, approvalId }];
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const { n, digest, bytes } = await digestFor(request, ctx);
    const pub = fromHex(ctx.account.publicKey);
    if (suiAddressFromPublicKey(pub) !== normalizeSuiAddress(ctx.account.address)) {
      throw new ClipError("This account's key doesn't match its address. Nothing was signed.", "sui/bad-account");
    }
    const sig = signatures[0];
    if (signatures.length !== 1 || !sig || sig.scheme !== "ed25519" || !ed25519.verify(sig.bytes, digest, pub)) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "sui/bad-signature");
    }
    const signature = serializeSignature(sig.bytes, pub);

    if (n.kind === "message") return n.wc ? { signature } : { bytes: b64encode(n.message), signature };

    if (!n.execute) {
      built.delete(request.id);
      return n.wc ? { signature, transactionBytes: b64encode(bytes) } : { bytes: b64encode(bytes), signature };
    }
    const data = parseData(bytes);
    if (data.gasData.owner && !sameAddress(data.gasData.owner, ctx.account.address)) {
      throw new ClipError("Another account pays the fee for this transaction, so the app has to send it. Nothing was sent.", "sui/sponsored-execute");
    }
    const gql = gqlFor(ctx);
    let res: { executeTransaction: { effects: { status: string; effectsBcs?: string | null; executionError?: { message?: string | null } | null; transaction?: { digest: string } | null } | null } };
    try {
      res = await gql.query(Q.execute, { bytes: b64encode(bytes), signatures: [signature] });
    } catch (e) {
      if (e instanceof GraphQLError) throw new ClipError(plainSuiError(e.message), "sui/send-failed", e);
      throw e;
    }
    built.delete(request.id);
    const effects = res.executeTransaction.effects;
    if (!effects?.transaction?.digest) throw new ClipError("Sui didn't confirm this transaction. Check your activity before trying again.", "sui/send-unknown");
    if (effects.status !== "SUCCESS") {
      throw new ClipError(plainSuiError(effects.executionError?.message ?? ""), "sui/execution-failed");
    }
    if (n.wc) return { digest: effects.transaction.digest };
    return { bytes: b64encode(bytes), signature, digest: effects.transaction.digest, effects: effects.effectsBcs ?? "" };
  }

  async function ownedObjects(gql: SuiGraphQL, owner: string, type: string | null, pages: number): Promise<ObjectNode[]> {
    const out: ObjectNode[] = [];
    let after: string | null = null;
    for (let p = 0; p < pages; p++) {
      const r: { address: { objects: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ObjectNode[] } } | null } = await gql.query(Q.objects, {
        owner,
        after,
        type,
      });
      const page = r.address?.objects;
      if (!page) break;
      out.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    return out;
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const gql = gqlFor(ctx);
    const me = normalizeSuiAddress(ctx.account.address);
    const totals = new Map<string, bigint>();
    let after: string | null = null;
    for (let p = 0; p < 10; p++) {
      const r: { address: { balances: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { coinType: { repr: string }; totalBalance: string }[] } } | null } =
        await gql.query(Q.balances, { owner: me, after });
      const page = r.address?.balances;
      if (!page) break;
      for (const b of page.nodes) {
        const t = normalizeStructTag(b.coinType.repr);
        totals.set(t, (totals.get(t) ?? 0n) + BigInt(b.totalBalance ?? "0"));
      }
      if (!page.pageInfo.hasNextPage) break;
      after = page.pageInfo.endCursor;
    }
    const out: TokenBalance[] = [{ asset: suiAsset(ctx.network.id), amount: (totals.get(SUI_TYPE) ?? 0n).toString() }];
    for (const [type, amount] of totals) {
      if (type === SUI_TYPE || amount === 0n) continue;
      out.push({ asset: assetFor(ctx.network.id, type, await coinMeta(gql, type)), amount: amount.toString() });
    }
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const gql = gqlFor(ctx);
    const me = normalizeSuiAddress(ctx.account.address);
    const objects = await ownedObjects(gql, me, null, options.nftPages ?? 4);
    const out: Nft[] = [];
    for (const o of objects) {
      const type = o.contents?.type?.repr;
      if (!type || /^0x0*2::coin::Coin</.test(type) || /^0x0*3::staking_pool::StakedSui$/.test(type)) continue;
      const display = o.contents?.display?.output;
      if (!display || typeof display !== "object") continue; // no Display standard: not a collectible
      const str = (k: string) => (typeof display[k] === "string" && (display[k] as string).length ? (display[k] as string) : undefined);
      const name = str("name");
      const image = str("image_url") ?? str("image");
      if (!name && !image) continue;
      const nft: Nft = {
        networkId: ctx.network.id,
        standard: "sui-object",
        collection: { address: type, name: str("collection_name") ?? str("project_name") ?? type.split("::").slice(1).join("::") },
        tokenId: o.address,
      };
      if (name) nft.name = name;
      if (image && /^(https:\/\/|ipfs:\/\/|ar:\/\/)/.test(image)) nft.mediaUrl = image; // untrusted: sandboxed media proxy only
      const attrs = display.attributes;
      if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
        nft.attributes = Object.entries(attrs as Record<string, unknown>).map(([trait, value]) => ({ trait, value: String(value) }));
      }
      out.push(nft);
    }
    return out;
  }

  async function getStakes(ctx: ChainContext): Promise<StakePosition[]> {
    const gql = gqlFor(ctx);
    const me = normalizeSuiAddress(ctx.account.address);
    const objects = await ownedObjects(gql, me, "0x3::staking_pool::StakedSui", 10);
    return objects.map((o) => {
      const j = (o.contents?.json ?? {}) as { pool_id?: string; stake_activation_epoch?: string | number; principal?: string | number | { value?: string } };
      const principal = typeof j.principal === "object" && j.principal ? String(j.principal.value ?? "0") : String(j.principal ?? "0");
      return { stakeId: o.address, poolId: String(j.pool_id ?? ""), principal, activationEpoch: String(j.stake_activation_epoch ?? "") };
    });
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const me = normalizeSuiAddress(ctx.account.address);
    const raw = p.to.trim();
    if (!SUI_ADDRESS.test(raw)) throw new ClipError("That doesn't look like a Sui address.", "sui/bad-address");
    const to = normalizeSuiAddress(raw);
    if (to === me) throw new ClipError("That's your own address.", "sui/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "sui/bad-amount");
    const type = p.asset.address ? normalizeStructTag(p.asset.address) : SUI_TYPE;
    const tx = new Transaction();
    tx.setSender(me);
    tx.transferObjects([coinWithBalance({ type, balance: BigInt(p.amount) })], to);
    let bytes: Uint8Array;
    try {
      bytes = await tx.build({ client: sdkClient(ctx) });
    } catch (cause) {
      const msg = String((cause as Error)?.message ?? cause);
      if (/insufficient/i.test(msg)) {
        throw new ClipError(type === SUI_TYPE ? "You don't have enough SUI for this and the network fee." : say("bg.err.notEnough", { symbol: p.asset.symbol }), "sui/insufficient", cause);
      }
      throw new ClipError(plainSuiError(msg), "sui/build-failed", cause);
    }
    return {
      id: randomId(),
      origin: "clip-wallet",
      via: "injected",
      family: "sui",
      networkId: ctx.network.id,
      method: SUI_METHODS.signAndExecuteTransaction,
      params: { inputs: [{ account: me, transaction: b64encode(bytes), chain: ctx.network.id }] },
    };
  }

  return {
    family: "sui",
    curve: "ed25519",
    /** Sui's default ed25519 path (SLIP-0010, all hardened): @mysten/sui DEFAULT_ED25519_DERIVATION_PATH with the account index. */
    derivationPath: (index: number) => `m/44'/784'/${index}'/0'/0'`,
    addressFromPublicKey: (publicKey: Uint8Array) => suiAddressFromPublicKey(publicKey),
    isAddress: (value: string) => SUI_ADDRESS.test(value.trim()),
    /** The same address works on every Sui network. */
    networksForAddress: (value: string, candidates: Network[]) => (SUI_ADDRESS.test(value.trim()) ? candidates.filter((c) => c.family === "sui") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
    getStakes,
  };
}

/** The Msg a described title carries (explicit titles keep it through the mapping to a DecodedRequest). */
function msgOf(d: { title: string }): { titleMsg?: Msg } {
  const m = (d as { titleMsg?: Msg }).titleMsg;
  return m ? { titleMsg: m } : {};
}
