import { type AssetRef, type ChainContext, type ChainModule, ClipError, type DappRequest, type DecodedRequest, type Network, type Nft, type Signature, type SignablePayload, type TokenBalance, type Warning, WALLET_ORIGIN, msg, titled, type Msg } from "@clip-wallet/core";
import { Enum, fromBufferToBase58, getSs58AddressInfo, u32 } from "@polkadot-api/substrate-bindings";
import { verify as sr25519Verify } from "@scure/sr25519";
import { readStorage, runtimeCall, storageKeys } from "./chain.js";
import { type AssetInfo, type DecodedCall, type Described, describeCall, mergeChanges } from "./describe.js";
import { type Runtime, loadRuntime, runtimeVersion } from "./metadata.js";
import { assetKey, fromChainId, nativeAsset, specOf, type SubstrateSpec } from "./networks.js";
import { type Payload, type SignerPayloadJSON, eraInfo, extensionParts, mortalEra, multiSignature, parsePayload, publicKeyOf, signedExtrinsic, signingBytes } from "./payload.js";
import { RpcError, SubstrateRpc, plainSubstrateError } from "./rpc.js";
import { concat, equal, formatUnits, fromHex, hex0x, hostOf, isHex, randomId, textOf } from "./util.js";

/**
 * DappRequest methods. Injected (1Mask injectedWeb3 signer) and WalletConnect "polkadot" namespace names.
 */
export const SUBSTRATE_METHODS = {
  /** signer.signPayload(SignerPayloadJSON) → { signature, signedTransaction? } */
  signPayload: "substrate_signPayload",
  /** signer.signRaw({ address, data, type }) → { signature } (data wrapped in <Bytes>…</Bytes>) */
  signRaw: "substrate_signRaw",
  /** Wallet-built transactions (buildTransfer / buildStake): sign and submit. */
  signAndSubmit: "substrate_signAndSubmit",
  /** WalletConnect: { address, transactionPayload } → { signature } */
  wcSignTransaction: "polkadot_signTransaction",
  /** WalletConnect: { address, message } → { signature } */
  wcSignMessage: "polkadot_signMessage",
} as const;

export interface SubstrateModuleOptions {
  /** Extra Asset Hub asset ids to show balances for, per network id (curated ones are always included). */
  assetIds?: Record<string, number[]>;
  ipfsGateway?: string;
  /** Mortality of wallet-built transactions, in blocks (power of two). Default 64. */
  eraPeriod?: number;
}

export type StakeAction =
  | { action: "join"; poolId: number; amount: string }
  | { action: "bondExtra"; amount: string }
  | { action: "bondRewards" }
  | { action: "unbond"; amount: string }
  | { action: "withdraw" }
  | { action: "claim" };

export interface PoolStaking {
  poolId: number;
  /** Base units, decimal strings. */
  bonded: string;
  pendingRewards: string;
  unbonding: { era: number; amount: string }[];
  withdrawable: string;
  currentEra: number | null;
}

/** Any call in this network's metadata, e.g. `{ pallet: "AssetConversion", call: "swap_exact_tokens_for_tokens", args: {…} }`. */
export interface CallSpec {
  pallet: string;
  call: string;
  /** Call arguments in polkadot-api dynamic-codec form (struct of named fields; `undefined` for no-arg calls). */
  args: unknown;
}

export interface SubstrateModule extends ChainModule {
  /** Nomination-pool membership on this network (null when the network has no pools or you're not in one). */
  getStaking(ctx: ChainContext): Promise<PoolStaking | null>;
  buildStake(p: StakeAction, ctx: ChainContext): Promise<DappRequest>;
  /**
   * A wallet-built `substrate_signAndSubmit` request for any call the runtime has, encoded through live metadata
   * (finalized head, mortal era, next nonce, mode 0). decode() describes it like any other payload.
   */
  buildCall(p: CallSpec, ctx: ChainContext): Promise<DappRequest>;
}

type Normalized =
  | { kind: "payload"; payload: Payload; submit: boolean; wc: boolean }
  | { kind: "raw"; address: string; data: Uint8Array; wc: boolean };

function bad(what: string): ClipError {
  return new ClipError(`This request is missing its ${what}.`, "substrate/bad-params");
}

/** `<Bytes>` ‖ data ‖ `</Bytes>` unless already wrapped (polkadot.js u8aWrapBytes). */
export function wrapBytes(data: Uint8Array): Uint8Array {
  const pre = new TextEncoder().encode("<Bytes>");
  const post = new TextEncoder().encode("</Bytes>");
  const wrapped = data.length >= pre.length + post.length && equal(data.subarray(0, pre.length), pre) && equal(data.subarray(data.length - post.length), post);
  return wrapped ? data : concat(pre, data, post);
}

export function normalize(request: DappRequest): Normalized {
  const p = (request.params ?? {}) as Record<string, unknown>;
  switch (request.method) {
    case SUBSTRATE_METHODS.signPayload:
    case SUBSTRATE_METHODS.signAndSubmit:
      return { kind: "payload", payload: parsePayload(p.payload ?? p), submit: request.method === SUBSTRATE_METHODS.signAndSubmit, wc: false };
    case SUBSTRATE_METHODS.wcSignTransaction: {
      if (!p.transactionPayload) throw bad("transaction");
      const payload = parsePayload(p.transactionPayload);
      if (typeof p.address === "string" && !equal(publicKeyOf(p.address), payload.publicKey)) {
        throw new ClipError("This request is for a different account than the one you connected.", "substrate/wrong-account");
      }
      return { kind: "payload", payload, submit: false, wc: true };
    }
    case SUBSTRATE_METHODS.signRaw: {
      if (typeof p.address !== "string" || typeof p.data !== "string") throw bad("message");
      return { kind: "raw", address: p.address, data: isHex(p.data) ? fromHex(p.data) : new TextEncoder().encode(p.data), wc: false };
    }
    case SUBSTRATE_METHODS.wcSignMessage: {
      if (typeof p.address !== "string" || typeof p.message !== "string") throw bad("message");
      return { kind: "raw", address: p.address, data: isHex(p.message) ? fromHex(p.message) : new TextEncoder().encode(p.message), wc: true };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this Polkadot request yet.", "substrate/unsupported-method");
  }
}

function specFor(ctx: ChainContext): SubstrateSpec {
  const s = specOf(ctx.network.id);
  if (!s) throw new ClipError("Clip Wallet doesn't know this Polkadot network.", "substrate/unknown-network");
  return s;
}

function rpcFor(ctx: ChainContext): SubstrateRpc {
  return new SubstrateRpc(ctx.network.rpcUrls, ctx.fetch);
}

function myKey(ctx: ChainContext): Uint8Array {
  const k = fromHex(ctx.account.publicKey);
  if (k.length !== 32) throw new ClipError("This Polkadot account isn't set up correctly.", "substrate/bad-account");
  return k;
}

const ss58 = (pub: Uint8Array, prefix: number) => fromBufferToBase58(prefix)(pub);

function checkMine(ctx: ChainContext, address: string | Uint8Array): void {
  const pub = typeof address === "string" ? publicKeyOf(address) : address;
  if (!equal(pub, myKey(ctx))) throw new ClipError("This request is for a different account than the one you connected.", "substrate/wrong-account");
}

/** 6-second blocks on relay chains and Asset Hubs (async backing). */
const BLOCK_SECONDS = 6;

export function createSubstrateModule(options: SubstrateModuleOptions = {}): SubstrateModule {
  const gateway = options.ipfsGateway ?? "https://ipfs.io/ipfs/";
  const eraPeriod = options.eraPeriod ?? 64;

  async function runtimeFor(ctx: ChainContext, p?: Payload): Promise<{ rt: Runtime; stale: boolean }> {
    const rpc = rpcFor(ctx);
    const spec = specFor(ctx);
    const rt = await loadRuntime(rpc, spec.genesisHash);
    if (!p || rt.version.specVersion === p.specVersion) return { rt, stale: false };
    try {
      const at = hex0x(p.blockHash);
      const v = await runtimeVersion(rpc, at);
      if (v.specVersion === p.specVersion) return { rt: await loadRuntime(rpc, spec.genesisHash, at, v), stale: false };
    } catch {
      /* pruned state: fall through */
    }
    return { rt, stale: true };
  }

  async function assetInfo(rt: Runtime, ctx: ChainContext, id: number): Promise<AssetInfo | null> {
    const curated = specFor(ctx).assets?.find((a) => a.id === id);
    if (curated) return curated;
    try {
      const m = await readStorage<{ name: Uint8Array; symbol: Uint8Array; decimals: number }>(rpcFor(ctx), rt, "Assets", "Metadata", id);
      if (!m || !m.symbol?.length) return null;
      return { symbol: textOf(m.symbol) ?? `#${id}`, name: textOf(m.name) ?? `Asset #${id}`, decimals: m.decimals };
    } catch {
      return null;
    }
  }

  function checkNetwork(p: Payload, ctx: ChainContext): void {
    if (fromChainId(hex0x(p.genesisHash)) !== ctx.network.id) {
      throw new ClipError("This app is asking you to sign for a different Polkadot network than the one it's connected to.", "substrate/network-mismatch");
    }
    checkMine(ctx, p.publicKey);
  }

  async function fee(rpc: SubstrateRpc, rt: Runtime, p: Payload): Promise<bigint | null> {
    try {
      const xt = signedExtrinsic(rt, p, new Uint8Array(64));
      const c = rt.builder.buildRuntimeCall("TransactionPaymentApi", "query_info");
      const res = await rpc.call<string>("state_call", ["TransactionPaymentApi_query_info", hex0x(concat(xt, u32.enc(xt.length)))]);
      const v = c.value.dec(res) as { partial_fee?: bigint };
      return typeof v.partial_fee === "bigint" ? v.partial_fee : null;
    } catch {
      return null;
    }
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(request);
    const base = { requestId: request.id, networkId: request.networkId };
    const host = hostOf(request.origin);
    const spec = specFor(ctx);

    if (n.kind === "raw") {
      checkMine(ctx, n.address);
      const text = textOf(n.data);
      const blind = text == null;
      const warnings: Warning[] = blind ? [{ level: "danger", code: "blind-signing", message: "This message isn't readable text. Only sign it if you trust the app." }] : [];
      return {
        ...base,
        ...titled(msg("bg.req.signMessage", { host })),
        lines: [text != null ? { label: "Message", value: text } : { label: "Message (not text)", value: hex0x(n.data) }],
        balanceChanges: [],
        simulated: false,
        blind,
        warnings,
      };
    }

    const p = n.payload;
    checkNetwork(p, ctx);
    const rpc = rpcFor(ctx);
    const { rt, stale } = await runtimeFor(ctx, p);
    const parts = extensionParts(rt, p);
    if (parts.unknown.length) {
      throw new ClipError(`This network uses a transaction extension Clip Wallet doesn't know yet (${parts.unknown.join(", ")}).`, "substrate/unknown-extension");
    }
    let d: Described;
    try {
      const call = rt.builder.buildDefinition(rt.callType).dec(p.method) as DecodedCall;
      d = await describeCall(call, {
        networkId: ctx.network.id,
        native: nativeAsset(spec),
        me: myKey(ctx),
        host,
        asset: (id) => assetInfo(rt, ctx, id),
      });
    } catch {
      d = {
        ...titled(msg("bg.req.approveTxFor", { host })),
        lines: [{ label: "Action (undecoded)", value: hex0x(p.method) }],
        balanceChanges: [],
        warnings: [{ level: "danger", code: "blind-signing", message: "This transaction can't be read. Only sign it if you trust the app." }],
        blind: true,
      };
    }
    const warnings = [...d.warnings];
    const lines = [...d.lines];
    const f = await fee(rpc, rt, p);
    const sym = spec.symbol;
    if (f !== null) lines.push({ label: "Network fee", value: `${formatUnits(f, spec.decimals)} ${sym}` });
    if (p.tip > 0n) lines.push({ label: "Tip", value: `${formatUnits(p.tip, spec.decimals)} ${sym}` });
    const era = eraInfo(p.era, p.blockNumber);
    lines.push({ label: "Valid for", value: era ? `about ${Math.round((era.period * BLOCK_SECONDS) / 60)} minutes` : "Never expires" });
    if (p.mode === 1 && p.metadataHash) {
      const ours = rt.metadataHash(spec.decimals, spec.symbol);
      if (equal(ours, p.metadataHash)) lines.push({ label: "Metadata check", value: "On (matches this network)" });
      else {
        warnings.push({
          level: "danger",
          code: "simulation-failed",
          message: "The app described this network differently from Clip Wallet (metadata hash mismatch). The network will reject it.",
        });
      }
    }
    if (stale) {
      warnings.push({ level: "caution", code: "simulation-failed", message: "The app built this for an older version of the network. It may be rejected." });
    }
    if (!n.submit && request.origin !== WALLET_ORIGIN) lines.push({ label: "Sent by", value: `${host} (it gets your signature)` });
    return {
      ...base,
      title: d.title, ...msgOf(d),
      lines,
      balanceChanges: mergeChanges(d.balanceChanges),
      ...(f !== null ? { fee: { asset: nativeAsset(spec), amount: f.toString() } } : {}),
      simulated: false,
      blind: d.blind,
      warnings,
    };
  }

  async function bytesToSign(n: Normalized, ctx: ChainContext): Promise<Uint8Array> {
    if (n.kind === "raw") {
      checkMine(ctx, n.address);
      return wrapBytes(n.data);
    }
    checkNetwork(n.payload, ctx);
    const { rt } = await runtimeFor(ctx, n.payload);
    return signingBytes(rt, n.payload);
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const bytes = await bytesToSign(normalize(request), ctx);
    return [{ accountId: ctx.account.id, scheme: "sr25519", bytes, approvalId }];
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(request);
    const bytes = await bytesToSign(n, ctx);
    const sig = signatures[0];
    if (!sig || signatures.length !== 1 || sig.scheme !== "sr25519" || sig.bytes.length !== 64 || !sr25519Verify(bytes, sig.bytes, myKey(ctx))) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "substrate/bad-signature");
    }
    if (n.kind === "raw") return { signature: hex0x(multiSignature(null, sig.bytes)) };
    const { rt } = await runtimeFor(ctx, n.payload);
    const signature = hex0x(multiSignature(rt, sig.bytes));
    if (n.wc) return { signature };
    const xt = signedExtrinsic(rt, n.payload, sig.bytes);
    if (n.submit) {
      try {
        const txHash = await rpcFor(ctx).call<string>("author_submitExtrinsic", [hex0x(xt)]);
        return { txHash };
      } catch (e) {
        if (e instanceof RpcError) throw new ClipError(plainSubstrateError(`${e.message} ${JSON.stringify(e.data ?? "")}`), "substrate/send-failed", e);
        throw e;
      }
    }
    return n.payload.withSignedTransaction ? { signature, signedTransaction: hex0x(xt) } : { signature };
  }

  /* ------------------------------------------------------------ balances, NFTs, staking */

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const rpc = rpcFor(ctx);
    const spec = specFor(ctx);
    const { rt } = await runtimeFor(ctx);
    const me = ss58(myKey(ctx), rt.ss58);
    const acct = await readStorage<{ data: { free: bigint; reserved: bigint } }>(rpc, rt, "System", "Account", me);
    const out: TokenBalance[] = [{ asset: nativeAsset(spec), amount: (acct?.data.free ?? 0n).toString() }];
    if (!rt.pallets.has("Assets")) return out;
    const ids = [...new Set([...(spec.assets ?? []).map((a) => a.id), ...(options.assetIds?.[ctx.network.id] ?? [])])];
    for (const id of ids) {
      const bal = await readStorage<{ balance: bigint }>(rpc, rt, "Assets", "Account", id, me).catch(() => null);
      if (!bal || bal.balance === 0n) continue;
      const info = await assetInfo(rt, ctx, id);
      const asset: AssetRef = {
        key: assetKey(ctx.network.id, id),
        symbol: info?.symbol ?? `#${id}`,
        name: info?.name ?? `Asset #${id}`,
        decimals: info?.decimals ?? 0,
        networkId: ctx.network.id,
        address: String(id),
      };
      out.push({ asset, amount: bal.balance.toString() });
    }
    return out;
  }

  async function offchain(data: Uint8Array, f: typeof fetch): Promise<{ name?: string; image?: string; attributes?: { trait: string; value: string }[] } | null> {
    const text = textOf(data)?.trim();
    if (!text) return null;
    const media = (s: unknown) => (typeof s === "string" && /^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(s) ? s : typeof s === "string" && /^(Qm|baf)/.test(s) ? `ipfs://${s}` : undefined);
    let json: Record<string, unknown> | null = null;
    if (text.startsWith("{")) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return null;
      }
    } else {
      const url = text.startsWith("ipfs://") ? `${gateway}${text.slice(7).replace(/^ipfs\//, "")}` : /^(Qm|baf)/.test(text) ? `${gateway}${text}` : /^https:\/\//.test(text) ? text : null;
      if (!url) return null;
      try {
        const r = await f(url);
        if (!r.ok) return { image: media(text) ?? "" };
        json = (await r.json()) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    if (!json) return null;
    const out: { name?: string; image?: string; attributes?: { trait: string; value: string }[] } = {};
    if (typeof json.name === "string") out.name = json.name;
    const img = media(json.image ?? json.mediaUri);
    if (img) out.image = img;
    if (Array.isArray(json.attributes)) {
      out.attributes = (json.attributes as { trait_type?: unknown; value?: unknown }[])
        .filter((a) => a && (typeof a.value === "string" || typeof a.value === "number"))
        .map((a) => ({ trait: String(a.trait_type ?? ""), value: String(a.value) }));
    }
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const rpc = rpcFor(ctx);
    const { rt } = await runtimeFor(ctx);
    const me = ss58(myKey(ctx), rt.ss58);
    const out: Nft[] = [];
    for (const [pallet, standard, metaEntry] of [
      ["Nfts", "substrate-nfts", "ItemMetadataOf"],
      ["Uniques", "substrate-uniques", "InstanceMetadataOf"],
    ] as const) {
      if (!rt.pallets.has(pallet)) continue;
      const keys = await storageKeys(rpc, rt, pallet, "Account", [me]).catch(() => []);
      for (const k of keys) {
        const collection = String(k[1]);
        const item = String(k[2]);
        const nft: Nft = { networkId: ctx.network.id, standard, collection: { address: `${pallet.toLowerCase()}:${collection}`, name: `Collection #${collection}` }, tokenId: item };
        const meta = await readStorage<{ data: Uint8Array }>(rpc, rt, pallet, metaEntry, Number(collection), Number(item)).catch(() => null);
        const off = meta?.data ? await offchain(meta.data, ctx.fetch) : null;
        if (off?.name) nft.name = off.name;
        if (off?.image) nft.mediaUrl = off.image; // untrusted: sandboxed media proxy only
        if (off?.attributes?.length) nft.attributes = off.attributes;
        out.push(nft);
      }
    }
    return out;
  }

  async function getStaking(ctx: ChainContext): Promise<PoolStaking | null> {
    const rpc = rpcFor(ctx);
    const { rt } = await runtimeFor(ctx);
    if (!rt.pallets.has("NominationPools")) return null;
    const me = ss58(myKey(ctx), rt.ss58);
    const member = await readStorage<{ pool_id: number; points: bigint; unbonding_eras: [number, bigint][] }>(rpc, rt, "NominationPools", "PoolMembers", me);
    if (!member) return null;
    // staking-async counts pool unbonding from the active era (current_era() returns ActiveEra); CurrentEra can be one ahead.
    const active = await readStorage<{ index: number } | null>(rpc, rt, "Staking", "ActiveEra").catch(() => null);
    const currentEra = active && typeof active.index === "number" ? active.index : await readStorage<number>(rpc, rt, "Staking", "CurrentEra").catch(() => null);
    const bonded = rt.hasApi("NominationPoolsApi", "points_to_balance")
      ? await runtimeCall<bigint>(rpc, rt, "NominationPoolsApi", "points_to_balance", [member.pool_id, member.points]).catch(() => member.points)
      : member.points;
    const pending = rt.hasApi("NominationPoolsApi", "pending_rewards") ? await runtimeCall<bigint>(rpc, rt, "NominationPoolsApi", "pending_rewards", [me]).catch(() => 0n) : 0n;
    const unbonding = (member.unbonding_eras ?? []).map(([era, amount]) => ({ era: Number(era), amount: BigInt(amount) }));
    const withdrawable = currentEra === null ? 0n : unbonding.filter((u) => u.era <= currentEra).reduce((a, u) => a + u.amount, 0n);
    return {
      poolId: Number(member.pool_id),
      bonded: bonded.toString(),
      pendingRewards: pending.toString(),
      unbonding: unbonding.map((u) => ({ era: u.era, amount: u.amount.toString() })),
      withdrawable: withdrawable.toString(),
      currentEra: currentEra === null ? null : Number(currentEra),
    };
  }

  /* ------------------------------------------------------------ building */

  async function payloadFor(ctx: ChainContext, rt: Runtime, pallet: string, call: string, args: unknown): Promise<DappRequest> {
    if (!rt.hasCall(pallet, call)) throw new ClipError("This network doesn't support that action.", "substrate/unsupported-call");
    const rpc = rpcFor(ctx);
    const spec = specFor(ctx);
    const c = rt.builder.buildCall(pallet, call);
    const method = concat(Uint8Array.from(c.location), c.codec.enc(args));
    const me = ss58(myKey(ctx), rt.ss58);
    const head = await rpc.call<string>("chain_getFinalizedHead");
    const header = await rpc.call<{ number: string }>("chain_getHeader", [head]);
    const nonce = await rpc.call<number>("system_accountNextIndex", [me]);
    const blockNumber = BigInt(header.number);
    const json: SignerPayloadJSON = {
      address: me,
      blockHash: head,
      blockNumber: `0x${blockNumber.toString(16).padStart(8, "0")}`,
      era: hex0x(mortalEra(blockNumber, eraPeriod)),
      genesisHash: spec.genesisHash,
      method: hex0x(method),
      nonce: `0x${nonce.toString(16).padStart(8, "0")}`,
      specVersion: `0x${rt.version.specVersion.toString(16).padStart(8, "0")}`,
      transactionVersion: `0x${rt.version.transactionVersion.toString(16).padStart(8, "0")}`,
      tip: "0x00000000000000000000000000000000",
      signedExtensions: rt.extensions.map((e) => e.identifier),
      version: 4,
      mode: 0,
    };
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "substrate",
      networkId: ctx.network.id,
      method: SUBSTRATE_METHODS.signAndSubmit,
      params: { payload: json },
    };
  }

  function amountOf(v: string): bigint {
    if (!/^\d+$/.test(v) || BigInt(v) <= 0n) throw new ClipError("Enter an amount greater than zero.", "substrate/bad-amount");
    return BigInt(v);
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const spec = specFor(ctx);
    const info = getSs58AddressInfo(p.to.trim());
    if (!info.isValid || info.publicKey.length !== 32) throw new ClipError("That doesn't look like a Polkadot address.", "substrate/bad-address");
    if (info.ss58Format !== spec.ss58 && info.ss58Format !== 42) {
      throw new ClipError(`That address is formatted for a different network than ${spec.name}. Check it with the recipient.`, "substrate/wrong-network");
    }
    if (equal(info.publicKey, myKey(ctx))) throw new ClipError("That's your own address.", "substrate/self-transfer");
    const amount = amountOf(p.amount);
    const { rt } = await runtimeFor(ctx);
    const dest = ss58(info.publicKey, rt.ss58);
    if (!p.asset.address) return payloadFor(ctx, rt, "Balances", "transfer_keep_alive", { dest: Enum("Id", dest), value: amount });
    const id = Number(p.asset.address);
    if (!Number.isSafeInteger(id) || id < 0) throw new ClipError("That token couldn't be found on this network.", "substrate/unknown-asset");
    return payloadFor(ctx, rt, "Assets", "transfer_keep_alive", { id, target: Enum("Id", dest), amount });
  }

  async function buildStake(p: StakeAction, ctx: ChainContext): Promise<DappRequest> {
    const { rt } = await runtimeFor(ctx);
    if (!rt.pallets.has("NominationPools")) throw new ClipError("Staking pools live on Asset Hub for this network. Switch there to stake.", "substrate/no-pools");
    const me = ss58(myKey(ctx), rt.ss58);
    switch (p.action) {
      case "join":
        return payloadFor(ctx, rt, "NominationPools", "join", { amount: amountOf(p.amount), pool_id: p.poolId });
      case "bondExtra":
        return payloadFor(ctx, rt, "NominationPools", "bond_extra", { extra: Enum("FreeBalance", amountOf(p.amount)) });
      case "bondRewards":
        return payloadFor(ctx, rt, "NominationPools", "bond_extra", { extra: Enum("Rewards") });
      case "unbond": {
        const amount = amountOf(p.amount);
        const member = await getStaking(ctx);
        if (!member) throw new ClipError("You're not in a staking pool on this network.", "substrate/not-a-member");
        const points = rt.hasApi("NominationPoolsApi", "balance_to_points")
          ? await runtimeCall<bigint>(rpcFor(ctx), rt, "NominationPoolsApi", "balance_to_points", [member.poolId, amount]).catch(() => amount)
          : amount;
        return payloadFor(ctx, rt, "NominationPools", "unbond", { member_account: Enum("Id", me), unbonding_points: points });
      }
      case "withdraw":
        return payloadFor(ctx, rt, "NominationPools", "withdraw_unbonded", { member_account: Enum("Id", me), num_slashing_spans: 0 });
      case "claim":
        return payloadFor(ctx, rt, "NominationPools", "claim_payout", undefined);
    }
  }

  async function buildCall(p: CallSpec, ctx: ChainContext): Promise<DappRequest> {
    const { rt } = await runtimeFor(ctx);
    return payloadFor(ctx, rt, p.pallet, p.call, p.args);
  }

  return {
    family: "substrate",
    curve: "sr25519",
    /** The vault's convention: account 0 = the phrase's root key, account i ≥ 1 = //(i-1). */
    derivationPath: (index: number) => (index === 0 ? "" : `//${index - 1}`),
    addressFromPublicKey(publicKey: Uint8Array, network: Network): string {
      if (publicKey.length !== 32) throw new Error("sr25519 public key must be 32 bytes");
      return ss58(publicKey, specOf(network.id)?.ss58 ?? 42);
    },
    isAddress(value: string): boolean {
      try {
        const i = getSs58AddressInfo(value.trim());
        return i.isValid && i.publicKey.length === 32;
      } catch {
        return false;
      }
    },
    /** The SS58 prefix says which networks an address was formatted for; 42 is the generic (testnet) format. */
    networksForAddress(value: string, candidates: Network[]): Network[] {
      let info;
      try {
        info = getSs58AddressInfo(value.trim());
      } catch {
        return [];
      }
      if (!info.isValid) return [];
      return candidates.filter((c) => c.family === "substrate" && specOf(c.id)?.ss58 === info.ss58Format);
    },
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    getStaking,
    buildStake,
    buildCall,
  };
}

/** The Msg a described title carries (explicit titles keep it through the mapping to a DecodedRequest). */
function msgOf(d: { title: string }): { titleMsg?: Msg } {
  const m = (d as { titleMsg?: Msg }).titleMsg;
  return m ? { titleMsg: m } : {};
}
