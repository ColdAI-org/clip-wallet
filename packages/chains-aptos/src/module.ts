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
} from "@clip-wallet/core";
import {
  type AnyRawTransaction,
  AccountAddress,
  AccountAuthenticatorEd25519,
  AuthenticationKey,
  ChainId,
  Deserializer,
  Ed25519PublicKey,
  Ed25519Signature,
  MultiAgentTransaction,
  RawTransaction,
  SignedTransaction,
  SimpleTransaction,
  TransactionAuthenticatorEd25519,
  type TransactionPayloadEntryFunction,
  type TypeTag,
  generateSigningMessageForTransaction,
  generateTransactionPayloadWithABI,
  parseTypeTag,
} from "@aptos-labs/ts-sdk";
import { ed25519 } from "@noble/curves/ed25519.js";
import { type Role, assetFor, assetInfo, describeTransaction, simulate } from "./describe.js";
import { type SignMessageInput, buildFullMessage } from "./message.js";
import { APTOS_CHAINS, APT_COIN_TYPE, aptAsset, aptosNetworkOf, canonicalAddress, canonicalType, fromChainId, isApt, longAddress } from "./networks.js";
import { AptosApiError, AptosRest, plainAptosError } from "./rest.js";
import { BoundedMap, b64decode, b64encode, fromHex, hex, hostOf, randomId } from "./util.js";

/** Injected (AIP-62 Wallet Standard via 1Mask) method names. Params are always `{ inputs: [one input] }`. */
export const APTOS_METHODS = {
  signTransaction: "aptos:signTransaction",
  signAndSubmitTransaction: "aptos:signAndSubmitTransaction",
  signMessage: "aptos:signMessage",
} as const;

/** Wire form of a dapp's InputEntryFunctionData (bigints as decimal strings, bytes as 0x-hex). */
export interface PayloadData {
  function: `${string}::${string}::${string}`;
  typeArguments?: string[];
  functionArguments?: unknown[];
}

export interface AptosModuleOptions {
  /** Simulate transactions in decode() (default true). */
  simulate?: boolean;
  /** Clock for transaction expiry (ms). */
  now?: () => number;
}

type Normalized =
  | { kind: "tx"; submit: false; transaction: string; multiAgent: boolean; asFeePayer: boolean }
  | { kind: "tx"; submit: true; transaction: string }
  | { kind: "build"; payload: PayloadData; maxGasAmount?: number; gasUnitPrice?: number }
  | { kind: "message"; input: SignMessageInput };

const ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

function bad(what: string): ClipError {
  return new ClipError(`This request is missing its ${what}.`, "aptos/bad-params");
}

function sameAddress(a: string, b: string): boolean {
  try {
    return longAddress(a) === longAddress(b);
  } catch {
    return false;
  }
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

export function normalize(request: DappRequest, me: string): Normalized {
  const i = firstInput(request.params);
  const acct = typeof i.account === "string" ? i.account : null;
  if (acct && !sameAddress(acct, me)) throw new ClipError("This request is for a different account than the one you connected.", "aptos/wrong-account");
  if (typeof i.chain === "string" && fromChainId(i.chain) !== request.networkId) {
    throw new ClipError("This app is asking for a different Aptos network than the one it's connected to.", "aptos/network-mismatch");
  }
  switch (request.method) {
    case APTOS_METHODS.signTransaction:
      if (typeof i.transaction !== "string" || !i.transaction) throw bad("transaction");
      return { kind: "tx", submit: false, transaction: i.transaction, multiAgent: i.multiAgent === true, asFeePayer: i.asFeePayer === true };
    case APTOS_METHODS.signAndSubmitTransaction: {
      if (typeof i.transaction === "string" && i.transaction) return { kind: "tx", submit: true, transaction: i.transaction };
      const payload = i.payload as PayloadData | undefined;
      if (!payload || typeof payload.function !== "string" || payload.function.split("::").length !== 3) throw bad("transaction");
      const out: Normalized = { kind: "build", payload };
      if (typeof i.maxGasAmount === "number") out.maxGasAmount = i.maxGasAmount;
      if (typeof i.gasUnitPrice === "number") out.gasUnitPrice = i.gasUnitPrice;
      return out;
    }
    case APTOS_METHODS.signMessage: {
      if (typeof i.message !== "string" || typeof i.nonce !== "string") throw bad("message");
      return {
        kind: "message",
        input: { message: i.message, nonce: i.nonce, address: i.address === true, application: i.application === true, chainId: i.chainId === true },
      };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this Aptos request yet.", "aptos/unsupported-method");
  }
}

function restFor(ctx: ChainContext): AptosRest {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("No Aptos connection is set up for this network.", "aptos/no-rpc");
  return new AptosRest(url.replace(/\/$/, ""), ctx.fetch, ctx.network.indexerUrl);
}

/** Legacy single-key Ed25519 address: sha3-256(pubkey || 0x00). */
export function aptosAddressFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  return AuthenticationKey.fromPublicKey({ publicKey: new Ed25519PublicKey(publicKey) }).derivedAddress().toStringLong();
}

/** What the vault signs for a transaction: sha3-256("APTOS::RawTransaction" | "APTOS::RawTransactionWithData") || BCS. */
export function signingMessage(tx: AnyRawTransaction): Uint8Array {
  return generateSigningMessageForTransaction(tx);
}

export function deserializeTransaction(b64: string, multiAgent: boolean): AnyRawTransaction {
  try {
    const d = new Deserializer(b64decode(b64));
    const tx = multiAgent ? MultiAgentTransaction.deserialize(d) : SimpleTransaction.deserialize(d);
    if (d.remaining() !== 0) throw new Error("trailing bytes");
    return tx;
  } catch (cause) {
    throw new ClipError("This transaction can't be read.", "aptos/bad-transaction", cause);
  }
}

const chainIdCache = new Map<string, number>();

async function expectedChainId(rest: AptosRest, networkId: string): Promise<number> {
  const n = aptosNetworkOf(networkId);
  const fixed = n ? APTOS_CHAINS[n].chainId : null;
  if (fixed != null) return fixed;
  const cached = chainIdCache.get(rest.base);
  if (cached != null) return cached;
  const info = await rest.get<{ chain_id: number }>("");
  chainIdCache.set(rest.base, info.chain_id);
  return info.chain_id;
}

/** Turns a dapp's wire-safe argument back into what the SDK's ABI encoder accepts. */
function fromWireArg(a: unknown): unknown {
  if (Array.isArray(a)) return a.map(fromWireArg);
  if (a && typeof a === "object" && typeof (a as { $bytes?: unknown }).$bytes === "string") return fromHex((a as { $bytes: string }).$bytes);
  return a;
}

export function createAptosModule(options: AptosModuleOptions = {}): ChainModule & { normalize: typeof normalize } {
  const now = options.now ?? (() => Date.now());
  /** request id → the exact transaction (and my role in it), so decode, prepare and finalize agree. */
  const built = new BoundedMap<string, { tx: AnyRawTransaction; role: Role }>();

  async function sequenceNumber(rest: AptosRest, me: string): Promise<bigint> {
    try {
      const a = await rest.get<{ sequence_number: string }>(`/accounts/${me}`);
      return BigInt(a.sequence_number);
    } catch (e) {
      if (e instanceof AptosApiError && e.status === 404) return 0n; // not created on chain yet
      throw e;
    }
  }

  /** Builds a simple transaction for `payload`, sized by a gas-estimating simulation. */
  async function buildSimple(
    rest: AptosRest,
    ctx: ChainContext,
    payload: TransactionPayloadEntryFunction,
    o: { maxGasAmount?: number; gasUnitPrice?: number } = {},
  ): Promise<SimpleTransaction> {
    const me = AccountAddress.from(ctx.account.address);
    const [seq, chainId, price] = await Promise.all([
      sequenceNumber(rest, me.toStringLong()),
      expectedChainId(rest, ctx.network.id),
      o.gasUnitPrice != null ? Promise.resolve(BigInt(o.gasUnitPrice)) : rest.get<{ gas_estimate: number }>("/estimate_gas_price").then((g) => BigInt(g.gas_estimate)),
    ]);
    const expiry = BigInt(Math.floor(now() / 1000) + 600);
    const make = (maxGas: bigint) => new SimpleTransaction(new RawTransaction(me, seq, payload, maxGas, price, expiry, new ChainId(chainId)));
    if (o.maxGasAmount != null) return make(BigInt(o.maxGasAmount));
    let maxGas = 20_000n;
    try {
      const sim = await simulate(rest, make(maxGas), ctx.account.publicKey, "sender", true);
      if (sim.success) {
        const used = BigInt(sim.gas_used);
        maxGas = (used * 3n + 1n) / 2n;
        if (maxGas < 2_000n) maxGas = 2_000n;
      } else {
        throw new ClipError(plainAptosError(sim.vm_status), "aptos/simulation-failed");
      }
    } catch (e) {
      if (e instanceof ClipError && e.code === "aptos/simulation-failed") throw e;
      // estimation unavailable: keep the default ceiling
    }
    return make(maxGas);
  }

  async function payloadFor(rest: AptosRest, data: PayloadData): Promise<TransactionPayloadEntryFunction> {
    const [rawAddr, mod, fn] = data.function.split("::") as [string, string, string];
    const addr = canonicalAddress(rawAddr);
    let abi: { generic_type_params: { constraints: string[] }[]; params: string[] } | undefined;
    try {
      const m = await rest.get<{ abi?: { exposed_functions: { name: string; is_entry: boolean; generic_type_params: { constraints: string[] }[]; params: string[] }[] } }>(
        `/accounts/${addr}/module/${mod}`,
      );
      abi = m.abi?.exposed_functions.find((f) => f.name === fn && f.is_entry);
    } catch (cause) {
      throw new ClipError("Clip Wallet couldn't find the app's contract on Aptos.", "aptos/no-abi", cause);
    }
    if (!abi) throw new ClipError("The app asked for a contract function that doesn't exist.", "aptos/no-abi");
    const parameters: TypeTag[] = abi.params.filter((p) => p !== "signer" && p !== "&signer").map((p) => parseTypeTag(p, { allowGenerics: true }));
    try {
      return generateTransactionPayloadWithABI({
        function: `${addr}::${mod}::${fn}`,
        typeArguments: (data.typeArguments ?? []).map(canonicalType),
        functionArguments: (data.functionArguments ?? []).map(fromWireArg) as never,
        abi: { typeParameters: abi.generic_type_params as never, parameters },
      });
    } catch (cause) {
      throw new ClipError("The app sent details this contract doesn't accept.", "aptos/bad-arguments", cause);
    }
  }

  async function resolve(request: DappRequest, n: Exclude<Normalized, { kind: "message" }>, ctx: ChainContext): Promise<{ tx: AnyRawTransaction; role: Role }> {
    const cached = built.get(request.id);
    if (cached) return cached;
    const me = longAddress(ctx.account.address);
    const rest = restFor(ctx);
    let tx: AnyRawTransaction;
    let role: Role;
    if (n.kind === "build") {
      tx = await buildSimple(rest, ctx, await payloadFor(rest, n.payload), n);
      role = "sender";
    } else {
      tx = deserializeTransaction(n.transaction, !n.submit && n.multiAgent);
      const sender = tx.rawTransaction.sender.toStringLong();
      if (!n.submit && n.asFeePayer) {
        if (!tx.feePayerAddress) throw new ClipError("This transaction has no fee payer to sign as.", "aptos/bad-transaction");
        tx.feePayerAddress = AccountAddress.from(me); // the fee payer signs with its own address in place (as the SDK does)
        role = "feePayer";
      } else if (sender === me) {
        role = "sender";
      } else if (tx.secondarySignerAddresses?.some((a) => a.toStringLong() === me)) {
        role = "secondary";
      } else {
        throw new ClipError("This transaction doesn't need your signature.", "aptos/not-a-signer");
      }
      if (n.submit && (tx.feePayerAddress || tx.secondarySignerAddresses?.length)) {
        throw new ClipError("This transaction needs other signatures, so the app has to send it.", "aptos/needs-other-signers");
      }
    }
    if (tx.rawTransaction.chain_id.chainId !== (await expectedChainId(rest, ctx.network.id))) {
      throw new ClipError("This transaction is for a different Aptos network than the one the app is connected to.", "aptos/network-mismatch");
    }
    const entry = { tx, role };
    built.set(request.id, entry);
    return entry;
  }

  async function messageFields(request: DappRequest, input: SignMessageInput, ctx: ChainContext) {
    const rest = restFor(ctx);
    const chainId = input.chainId ? await expectedChainId(rest, ctx.network.id) : null;
    let application = request.origin;
    try {
      application = new URL(request.origin).origin;
    } catch {
      /* keep as is */
    }
    return buildFullMessage(input, { address: longAddress(ctx.account.address), application, chainId });
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(request, ctx.account.address);
    const base = { requestId: request.id, networkId: request.networkId };
    const host = hostOf(request.origin);
    if (n.kind === "message") {
      const f = await messageFields(request, n.input, ctx);
      const lines = [{ label: "Message", value: n.input.message }];
      if (f.application) lines.push({ label: "For", value: f.application });
      return { ...base, title: `Sign a message for ${host}`, lines, balanceChanges: [], simulated: false, blind: false, warnings: [] };
    }
    const { tx, role } = await resolve(request, n, ctx);
    const rest = restFor(ctx);
    const d = await describeTransaction(tx, {
      networkId: ctx.network.id,
      me: ctx.account.address,
      publicKey: ctx.account.publicKey,
      rest,
      host,
      role,
      simulate: options.simulate ?? true,
    });
    const lines = [...d.lines];
    if (!d.sponsored) lines.push({ label: "Network fee", value: `${(Number(d.fee) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 8 })} APT` });
    if (n.kind === "tx" && !n.submit) lines.push({ label: "Sent by", value: `${host} (it gets your signature)` });
    const fee: NonNullable<DecodedRequest["fee"]> = { asset: aptAsset(ctx.network.id), amount: d.fee.toString() };
    if (d.sponsored) fee.sponsored = true;
    return { ...base, title: d.title, lines, balanceChanges: d.balanceChanges, fee, simulated: d.simulated, blind: d.blind, warnings: d.warnings };
  }

  async function signable(request: DappRequest, ctx: ChainContext): Promise<{ n: Normalized; bytes: Uint8Array; tx?: AnyRawTransaction; fields?: Awaited<ReturnType<typeof messageFields>> }> {
    const n = normalize(request, ctx.account.address);
    if (n.kind === "message") {
      const fields = await messageFields(request, n.input, ctx);
      return { n, bytes: new TextEncoder().encode(fields.fullMessage), fields };
    }
    const { tx } = await resolve(request, n, ctx);
    return { n, bytes: signingMessage(tx), tx };
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const { bytes } = await signable(request, ctx);
    return [{ accountId: ctx.account.id, scheme: "ed25519", bytes, approvalId }];
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const { n, bytes, tx, fields } = await signable(request, ctx);
    const pub = fromHex(ctx.account.publicKey);
    if (aptosAddressFromPublicKey(pub) !== longAddress(ctx.account.address)) {
      throw new ClipError("This account's key doesn't match its address. Nothing was signed.", "aptos/bad-account");
    }
    const sig = signatures[0];
    if (signatures.length !== 1 || !sig || sig.scheme !== "ed25519" || !ed25519.verify(sig.bytes, bytes, pub)) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "aptos/bad-signature");
    }
    if (n.kind === "message") return { ...fields!, signature: `0x${hex(sig.bytes)}` };

    const publicKey = new Ed25519PublicKey(pub);
    const signature = new Ed25519Signature(sig.bytes);
    if (n.kind === "tx" && !n.submit) {
      built.delete(request.id);
      const out: Record<string, unknown> = { authenticator: b64encode(new AccountAuthenticatorEd25519(publicKey, signature).bcsToBytes()) };
      if (n.asFeePayer) out.feePayerAddress = longAddress(ctx.account.address);
      return out;
    }
    const signed = new SignedTransaction(tx!.rawTransaction, new TransactionAuthenticatorEd25519(publicKey, signature)).bcsToBytes();
    let res: { hash: string };
    try {
      res = await restFor(ctx).postBcs<{ hash: string }>("/transactions", signed);
    } catch (e) {
      if (e instanceof AptosApiError) throw new ClipError(plainAptosError(`${e.errorCode ?? ""} ${e.message}`), "aptos/send-failed", e);
      throw e;
    }
    built.delete(request.id);
    return { hash: res.hash };
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const rest = restFor(ctx);
    const me = longAddress(ctx.account.address);
    let apt = 0n;
    try {
      apt = BigInt(await rest.get<string | number>(`/accounts/${me}/balance/${APT_COIN_TYPE}`));
    } catch (e) {
      if (!(e instanceof AptosApiError && e.status === 404)) throw e;
    }
    const out: TokenBalance[] = [{ asset: aptAsset(ctx.network.id), amount: apt.toString() }];
    try {
      const r = await rest.graphql<{
        current_fungible_asset_balances: { asset_type: string; amount: string | number; metadata: { symbol: string; decimals: number; name: string; icon_uri?: string | null } | null }[];
      }>(
        `query clipBalances($owner: String!) { current_fungible_asset_balances(where: { owner_address: { _eq: $owner }, amount: { _gt: "0" } }, limit: 100) { asset_type amount metadata { symbol decimals name icon_uri } } }`,
        { owner: me },
      );
      const totals = new Map<string, { amount: bigint; meta: (typeof r.current_fungible_asset_balances)[number]["metadata"] }>();
      for (const b of r.current_fungible_asset_balances) {
        if (!b.asset_type || isApt(b.asset_type)) continue;
        const key = b.asset_type.includes("::") ? b.asset_type : longAddress(b.asset_type);
        const e = totals.get(key) ?? { amount: 0n, meta: b.metadata };
        e.amount += BigInt(b.amount);
        totals.set(key, e);
      }
      for (const [type, e] of totals) {
        const info = e.meta ? { symbol: e.meta.symbol, decimals: Number(e.meta.decimals), name: e.meta.name, ...(e.meta.icon_uri ? { iconUri: e.meta.icon_uri } : {}) } : await assetInfo(rest, type);
        out.push({ asset: assetFor(ctx.network.id, type, info), amount: e.amount.toString() });
      }
    } catch (e) {
      if (e instanceof ClipError && e.code !== "aptos/no-indexer") throw e;
      // indexer unavailable: APT only
    }
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const rest = restFor(ctx);
    const me = longAddress(ctx.account.address);
    const r = await rest.graphql<{
      current_token_ownerships_v2: {
        token_data_id: string;
        amount: number | string;
        current_token_data: {
          token_name: string;
          token_uri: string;
          token_properties: Record<string, unknown> | null;
          current_collection: { collection_id: string; collection_name: string } | null;
        } | null;
      }[];
    }>(
      `query clipNfts($owner: String!) { current_token_ownerships_v2(where: { owner_address: { _eq: $owner }, amount: { _gt: "0" } }, limit: 100) { token_data_id amount current_token_data { token_name token_uri token_properties current_collection { collection_id collection_name } } } }`,
      { owner: me },
    );
    return r.current_token_ownerships_v2.map((o) => {
      const d = o.current_token_data;
      const nft: Nft = {
        networkId: ctx.network.id,
        standard: "aptos-digital-asset",
        collection: { address: d?.current_collection?.collection_id ?? "", name: d?.current_collection?.collection_name ?? "Collection" },
        tokenId: o.token_data_id,
      };
      if (d?.token_name) nft.name = d.token_name;
      const uri = d?.token_uri ?? "";
      if (/^(https:\/\/|ipfs:\/\/|ar:\/\/)\S+\.(png|jpe?g|gif|webp|svg|avif)(\?\S*)?$/i.test(uri)) nft.mediaUrl = uri; // untrusted: sandboxed media proxy only
      const props = d?.token_properties;
      if (props && typeof props === "object" && Object.keys(props).length) {
        nft.attributes = Object.entries(props).map(([trait, value]) => ({ trait, value: typeof value === "string" ? value : JSON.stringify(value) }));
      }
      return nft;
    });
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const me = longAddress(ctx.account.address);
    const raw = p.to.trim();
    if (!ADDRESS.test(raw)) throw new ClipError("That doesn't look like an Aptos address.", "aptos/bad-address");
    const to = longAddress(raw);
    if (to === me) throw new ClipError("That's your own address.", "aptos/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "aptos/bad-amount");
    const amount = BigInt(p.amount);
    const rest = restFor(ctx);
    const parse = (t: string) => parseTypeTag(t);
    let payload: TransactionPayloadEntryFunction;
    if (!p.asset.address || isApt(p.asset.address)) {
      payload = generateTransactionPayloadWithABI({
        function: "0x1::aptos_account::transfer",
        functionArguments: [to, amount],
        abi: { typeParameters: [], parameters: [parse("address"), parse("u64")] },
      });
    } else if (p.asset.address.includes("::")) {
      payload = generateTransactionPayloadWithABI({
        function: "0x1::aptos_account::transfer_coins",
        typeArguments: [canonicalType(p.asset.address)],
        functionArguments: [to, amount],
        abi: { typeParameters: [{ constraints: [] }], parameters: [parse("address"), parse("u64")] },
      });
    } else {
      payload = generateTransactionPayloadWithABI({
        function: "0x1::primary_fungible_store::transfer",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [longAddress(p.asset.address), to, amount],
        abi: {
          typeParameters: [{ constraints: ["key" as never] }],
          parameters: [parseTypeTag("0x1::object::Object<T0>", { allowGenerics: true }), parse("address"), parse("u64")],
        },
      });
    }
    const tx = await buildSimple(rest, ctx, payload);
    return {
      id: randomId(),
      origin: "clip-wallet",
      via: "injected",
      family: "aptos",
      networkId: ctx.network.id,
      method: APTOS_METHODS.signAndSubmitTransaction,
      params: { inputs: [{ account: me, chain: ctx.network.id, transaction: b64encode(tx.bcsToBytes()) }] },
    };
  }

  return {
    family: "aptos",
    curve: "ed25519",
    /** Petra / Aptos SDK hardened path (SLIP-0010; ts-sdk APTOS_HARDENED_REGEX m/44'/637'/a'/c'/i'). */
    derivationPath: (index: number) => `m/44'/637'/${index}'/0'/0'`,
    addressFromPublicKey: (publicKey: Uint8Array) => aptosAddressFromPublicKey(publicKey),
    isAddress: (value: string) => /^0x[0-9a-fA-F]{64}$/.test(value.trim()),
    /** The same address works on every Aptos network. */
    networksForAddress: (value: string, candidates: Network[]) => (/^0x[0-9a-fA-F]{64}$/.test(value.trim()) ? candidates.filter((c) => c.family === "aptos") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
  };
}
