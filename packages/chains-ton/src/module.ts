import "./buffer.js";
import { type AssetRef, type BalanceChange, type ChainContext, type ChainModule, ClipError, type DappRequest, type DecodedRequest, type Network, type Nft, type Signature, type SignablePayload, type TokenBalance, type Warning, msg, titled, say, type Msg } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Address, Cell, type MessageRelaxed, type StateInit, internal, loadStateInit } from "@ton/core";
import { type AccountEvent, HttpError, type JettonBalance, type JettonPreview, TonHttp, type TonapiNft, type WalletInformation } from "./api.js";
import { CURATED_JETTONS, endpoints, gramAsset, netOf, tonConnectNetwork } from "./networks.js";
import { type Body, cellFromB64, jettonTransferBody, nftTransferBody, parseBody } from "./payload.js";
import { type SendTxPayload, type SignDataPayload, parseSendTx, parseSignData, payloadOf, signDataHash, tonProofHash } from "./tonconnect.js";
import { b64encode, formatUnits, fromHex, hex, hostOf, randomId, short } from "./util.js";
import { MAX_MESSAGES, type TonWallet, type TonWalletVersion, externalBoc, friendly, signingHash, stateInitBoc, transferBody, walletFor } from "./wallet.js";

/**
 * Methods. TON Connect (JS bridge via 1Mask: `sendTransaction`, `signData`, plus `ton_proof` for the connect
 * item) and WalletConnect/Reown's TON namespace (`ton_sendMessage`, `ton_signData`). `signMessage` (gasless
 * relays) is not offered yet, so the wallet doesn't advertise the SignMessage feature.
 */
export const TON_METHODS = {
  sendTransaction: "sendTransaction",
  signData: "signData",
  signMessage: "signMessage",
  tonProof: "ton_proof",
  wcSendMessage: "ton_sendMessage",
  wcSignData: "ton_signData",
} as const;

export interface TonModuleOptions {
  /** Wallet contract (default v5r1). Must match what the vault records for the account. */
  walletVersion?: TonWalletVersion;
  /** Emulate with tonapi in decode() for balance changes (default true). */
  emulate?: boolean;
  /** Spacing between calls to the same keyless API host (default 1100 ms; tests use 0). */
  minIntervalMs?: number;
  /** Unix seconds (tests pin it). */
  now?: () => number;
}

/** GRAM attached to a jetton / NFT transfer when the app doesn't say (covers the token contracts' gas; the rest comes back). */
export const DEFAULT_ATTACH = 50_000_000n;

type Normalized =
  | { kind: "tx"; payload: SendTxPayload; wc: boolean }
  | { kind: "signData"; payload: SignDataPayload; wc: boolean }
  | { kind: "proof"; payload: string };

interface Resolved {
  to: Address;
  bounce: boolean;
  testOnly: boolean;
  amount: bigint;
  body: Cell | null;
  init: StateInit | null;
}

type Prepared =
  | { kind: "tx"; hash: Uint8Array; seqno: number; timeout: number; deploy: boolean; messages: MessageRelaxed[] }
  | { kind: "signData" | "proof"; hash: Uint8Array; timestamp: number; domain: string };

function normalize(request: DappRequest): Normalized {
  switch (request.method) {
    case TON_METHODS.sendTransaction:
      return { kind: "tx", payload: parseSendTx(request.params), wc: false };
    case TON_METHODS.wcSendMessage:
      return { kind: "tx", payload: parseSendTx(request.params), wc: true };
    case TON_METHODS.signData:
      return { kind: "signData", payload: parseSignData(request.params), wc: false };
    case TON_METHODS.wcSignData:
      return { kind: "signData", payload: parseSignData(request.params), wc: true };
    case TON_METHODS.tonProof: {
      const p = payloadOf(request.params);
      if (typeof p.payload !== "string" || p.payload.length > 4096) throw new ClipError("This sign-in request can't be read.", "ton/bad-params");
      return { kind: "proof", payload: p.payload };
    }
    case TON_METHODS.signMessage:
      throw new ClipError("Clip Wallet doesn't sign messages for relayers yet.", "ton/unsupported-method");
    default:
      throw new ClipError("Clip Wallet doesn't support this TON request yet.", "ton/unsupported-method");
  }
}

const isRawAddress = (v: string) => Address.isRaw(v.trim());
const isAnyAddress = (v: string) => Address.isFriendly(v.trim()) || Address.isRaw(v.trim());

function parseAddr(v: unknown, what: string): Address {
  if (typeof v !== "string" || !isAnyAddress(v)) throw new ClipError(`This request has an invalid ${what}.`, "ton/bad-params");
  return Address.parse(v.trim());
}

function coins(v: unknown, what: string, fallback?: bigint): bigint {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw new ClipError(`This request has an invalid ${what}.`, "ton/bad-params");
  return BigInt(v);
}

export function createTonModule(options: TonModuleOptions = {}): ChainModule & {
  /** Address of this account's wallet on `network` (v5r1 addresses differ between mainnet and testnet). */
  walletAddress(publicKey: Uint8Array, network: Network): { raw: string; friendly: string };
  /** TON Connect `ton_addr` connect item for an account. */
  tonAddrItem(publicKey: Uint8Array, network: Network): { name: "ton_addr"; address: string; network: string; publicKey: string; walletStateInit: string };
  /** DeviceInfo.features this module supports (for the TON Connect bridge). */
  features: readonly unknown[];
} {
  const version = options.walletVersion ?? "v5r1";
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const prepared = new Map<string, Prepared>();

  const http = (ctx: ChainContext) => new TonHttp(ctx.fetch, options.minIntervalMs ?? 1100);

  function walletOf(publicKey: Uint8Array, net: Network): TonWallet {
    return walletFor(publicKey, endpoints(net).globalId, version);
  }

  function me(ctx: ChainContext) {
    let pub: Uint8Array;
    try {
      pub = fromHex(ctx.account.publicKey);
    } catch (cause) {
      throw new ClipError("This account's key can't be read.", "ton/bad-account", cause);
    }
    if (pub.length !== 32) throw new ClipError("This account's key can't be read.", "ton/bad-account");
    const e = endpoints(ctx.network);
    const wallet = walletOf(pub, ctx.network);
    return { pub, wallet, address: wallet.address, raw: wallet.address.toRawString(), friendly: friendly(wallet.address, e.testnet), ...e };
  }
  type Me = ReturnType<typeof me>;

  async function walletInfo(ctx: ChainContext, m: Me): Promise<WalletInformation> {
    return http(ctx).json<WalletInformation>(`${m.toncenter}/v3/walletInformation?address=${encodeURIComponent(m.friendly)}&use_v2=false`);
  }

  /* -------------------------------------------------------------- token metadata */

  const curated = (ctx: ChainContext, master: string) => {
    const n = netOf(ctx.network.id);
    const a = Address.parse(master);
    return CURATED_JETTONS.find((j) => j.net === n && Address.parse(j.master).equals(a));
  };

  function jettonAsset(ctx: ChainContext, j: JettonPreview): AssetRef {
    const master = Address.parse(j.address);
    const c = curated(ctx, j.address);
    const raw = master.toRawString();
    if (c) return { key: c.key, symbol: c.symbol, name: c.name, decimals: c.decimals, networkId: ctx.network.id, address: raw };
    const a: AssetRef = { key: `ton:${raw}`, symbol: j.symbol, name: j.name, decimals: Number(j.decimals), networkId: ctx.network.id, address: raw };
    if (j.image) a.logoUrl = j.image;
    const lookalike = CURATED_JETTONS.some((x) => x.symbol.replace("₮", "T").toUpperCase() === j.symbol.replace("₮", "T").toUpperCase());
    if (j.verification === "blacklist" || lookalike) a.spam = true;
    return a;
  }

  async function jettonMeta(ctx: ChainContext, m: Me, master: Address): Promise<AssetRef | null> {
    try {
      const r = await http(ctx).json<{ metadata: JettonPreview & { address: string }; verification?: string }>(`${m.tonapi}/v2/jettons/${master.toRawString()}`);
      return jettonAsset(ctx, { ...r.metadata, address: master.toRawString(), ...(r.verification ? { verification: r.verification } : {}) });
    } catch {
      return null;
    }
  }

  /** get_wallet_data on a jetton wallet: [balance, owner, master, code]. */
  async function jettonWalletData(ctx: ChainContext, m: Me, jw: Address): Promise<{ owner: Address; master: Address } | null> {
    try {
      const r = await http(ctx).json<{ success: boolean; stack: { type: string; cell?: string }[] }>(
        `${m.tonapi}/v2/blockchain/accounts/${jw.toRawString()}/methods/get_wallet_data`,
      );
      if (!r.success || r.stack.length < 3) return null;
      const addrAt = (i: number) => Cell.fromBoc(Buffer.from(r.stack[i]!.cell!, "hex"))[0]!.beginParse().loadAddress();
      return { owner: addrAt(1), master: addrAt(2) };
    } catch {
      return null;
    }
  }

  async function myJettonWallet(ctx: ChainContext, m: Me, master: Address): Promise<Address> {
    try {
      const r = await http(ctx).json<JettonBalance>(`${m.tonapi}/v2/accounts/${m.raw}/jettons/${master.toRawString()}`);
      return Address.parse(r.wallet_address.address);
    } catch (e) {
      if (e instanceof HttpError && (e.status === 404 || e.status === 400)) {
        throw new ClipError("You don't hold that token.", "ton/no-jetton-wallet");
      }
      throw e;
    }
  }

  /* -------------------------------------------------------------- messages */

  async function resolve(ctx: ChainContext, m: Me, p: SendTxPayload): Promise<Resolved[]> {
    const out: Resolved[] = [];
    const raw = (msg: { address: string; amount: string; payload?: string; stateInit?: string }): Resolved => {
      const a = msg.address.trim();
      // TON Connect: wallets MUST reject raw-form addresses (the bounce flag would be lost).
      if (isRawAddress(a)) throw new ClipError("This app sent an address without its safety flags. Clip Wallet won't send to it.", "ton/raw-address");
      if (!Address.isFriendly(a)) throw new ClipError("This request has an invalid address.", "ton/bad-params");
      const f = Address.parseFriendly(a);
      let body: Cell | null = null;
      let init: StateInit | null = null;
      try {
        if (msg.payload) body = cellFromB64(msg.payload, "payload");
        if (msg.stateInit) init = loadStateInit(cellFromB64(msg.stateInit, "stateInit").beginParse());
      } catch (cause) {
        throw new ClipError("This request has data that can't be read.", "ton/bad-payload", cause);
      }
      return { to: f.address, bounce: f.isBounceable, testOnly: f.isTestOnly, amount: coins(msg.amount, "amount"), body, init };
    };
    if (p.messages) {
      for (const msg of p.messages) out.push(raw(msg));
      return out;
    }
    for (const it of p.items ?? []) {
      if (it.type === "ton") out.push(raw(it));
      else if (it.type === "jetton") {
        const master = parseAddr(it.master, "token");
        const jw = await myJettonWallet(ctx, m, master);
        const forwardTon = coins(it.forwardAmount, "forward amount", 1n);
        const body = jettonTransferBody({
          queryId: coins(it.queryId, "query id", 0n),
          amount: coins(it.amount, "amount"),
          destination: parseAddr(it.destination, "recipient"),
          responseDestination: it.responseDestination ? parseAddr(it.responseDestination, "response address") : m.address,
          customPayload: it.customPayload ? cellFromB64(it.customPayload, "custom payload") : null,
          forwardTon,
          forwardPayload: it.forwardPayload ? cellFromB64(it.forwardPayload, "forward payload") : null,
        });
        out.push({ to: jw, bounce: true, testOnly: m.testnet, amount: coins(it.attachAmount, "attached amount", forwardTon + DEFAULT_ATTACH), body, init: null });
      } else if (it.type === "nft") {
        const forwardTon = coins(it.forwardAmount, "forward amount", 1n);
        const body = nftTransferBody({
          queryId: coins(it.queryId, "query id", 0n),
          newOwner: parseAddr(it.newOwner, "new owner"),
          responseDestination: it.responseDestination ? parseAddr(it.responseDestination, "response address") : m.address,
          customPayload: it.customPayload ? cellFromB64(it.customPayload, "custom payload") : null,
          forwardTon,
          forwardPayload: it.forwardPayload ? cellFromB64(it.forwardPayload, "forward payload") : null,
        });
        out.push({ to: parseAddr(it.nftAddress, "NFT"), bounce: true, testOnly: m.testnet, amount: coins(it.attachAmount, "attached amount", forwardTon + DEFAULT_ATTACH), body, init: null });
      } else {
        throw new ClipError("This request has an item type Clip Wallet doesn't know.", "ton/bad-params");
      }
    }
    return out;
  }

  const toRelaxed = (r: Resolved): MessageRelaxed =>
    internal({ to: r.to, value: r.amount, bounce: r.bounce, ...(r.body ? { body: r.body } : {}), ...(r.init ? { init: r.init } : {}) });

  function checkPayload(p: SendTxPayload | SignDataPayload, ctx: ChainContext, m: Me) {
    if (p.network !== undefined && String(p.network) !== tonConnectNetwork(ctx.network.id)) {
      throw new ClipError("This app is asking for a different TON network than the one it's connected to. Nothing was signed.", "ton/network-mismatch");
    }
    if (p.from !== undefined) {
      if (typeof p.from !== "string" || !isAnyAddress(p.from) || !Address.parse(p.from).equals(m.address)) {
        throw new ClipError("This request is for a different account than the one you connected.", "ton/wrong-account");
      }
    }
  }

  function checkTx(p: SendTxPayload, ctx: ChainContext, m: Me) {
    checkPayload(p, ctx, m);
    if (p.valid_until !== undefined && p.valid_until < now()) throw new ClipError("This request has expired. Try again from the app.", "ton/expired");
    const count = (p.messages ?? p.items ?? []).length;
    if (count > MAX_MESSAGES[version]) throw new ClipError(`This request has more than ${MAX_MESSAGES[version]} transfers, more than your wallet can send at once.`, "ton/too-many-messages");
  }

  interface Described {
    title: string;
    lines: { label: string; value: string }[];
    warnings: Warning[];
    blind: boolean;
    declared: Map<string, { asset: AssetRef; delta: bigint }>;
  }

  async function describe(ctx: ChainContext, m: Me, msgs: Resolved[], host: string): Promise<Described> {
    const d: Described = { title: "", lines: [], warnings: [], blind: false, declared: new Map() };
    const add = (asset: AssetRef, delta: bigint) => {
      const k = asset.address ?? asset.key;
      const e = d.declared.get(k) ?? { asset, delta: 0n };
      e.delta += delta;
      d.declared.set(k, e);
    };
    const gram = gramAsset(ctx.network.id);
    const g = (v: bigint) => `${formatUnits(v, 9)} GRAM`;
    const addr = (a: Address | null) => (a ? friendly(a, m.testnet) : "nobody");
    const titles: string[] = [];
    for (const msg of msgs) {
      const to = friendly(msg.to, m.testnet, msg.bounce);
      const body: Body = parseBody(msg.body);
      add(gram, -msg.amount);
      if (msg.testOnly && !m.testnet) {
        d.warnings.push({ level: "caution", code: "network-matters", message: say("bg.ton.testAddressOnMainnet", { address: short(to) }) });
      }
      switch (body.kind) {
        case "empty":
        case "comment":
        case "encrypted-comment":
          titles.push(say("bg.req.sendTo", { amount: g(msg.amount), to: short(to) }));
          d.lines.push({ label: "To", value: to }, { label: "Amount", value: g(msg.amount) });
          if (body.kind === "comment") d.lines.push({ label: "Comment", value: body.text });
          if (body.kind === "encrypted-comment") d.lines.push({ label: "Comment", value: "Encrypted" });
          break;
        case "jetton-transfer": {
          const data = await jettonWalletData(ctx, m, msg.to);
          const asset = data ? await jettonMeta(ctx, m, data.master) : null;
          if (!data || !data.owner.equals(m.address) || !asset) {
            d.blind = true;
            titles.push(say("bg.ton.sendTokensFrom", { from: short(to) }));
            d.lines.push({ label: "Token wallet", value: to }, { label: "Amount", value: `${body.amount} units` });
            d.warnings.push({
              level: "danger",
              code: "blind-signing",
              message: data && !data.owner.equals(m.address) ? "This token transfer goes through a token wallet that isn't yours." : "We couldn't tell which token this sends.",
            });
            break;
          }
          const amt = `${formatUnits(body.amount, asset.decimals)} ${asset.symbol}`;
          titles.push(say("bg.req.sendTo", { amount: amt, to: short(addr(body.destination)) }));
          d.lines.push({ label: "To", value: addr(body.destination) }, { label: "Amount", value: amt }, { label: "Covers token fees", value: `${g(msg.amount)} (unused part comes back)` });
          if (body.forwardComment) d.lines.push({ label: "Comment", value: body.forwardComment });
          if (body.forwardTon > 1n) d.lines.push({ label: "Also forwards", value: g(body.forwardTon) });
          if (asset.spam) d.warnings.push({ level: "danger", code: "known-scam", message: say("bg.starknet.notReal", { symbol: asset.symbol }) });
          add(asset, -body.amount);
          break;
        }
        case "jetton-burn": {
          const data = await jettonWalletData(ctx, m, msg.to);
          const asset = data ? await jettonMeta(ctx, m, data.master) : null;
          const amt = asset ? `${formatUnits(body.amount, asset.decimals)} ${asset.symbol}` : `${body.amount} token units`;
          titles.push(say("bg.ton.burn", { amount: amt }));
          d.lines.push({ label: "Burns", value: amt });
          d.warnings.push({ level: "caution", code: "blind-signing", message: "Burned tokens are destroyed for good." });
          if (asset) add(asset, -body.amount);
          break;
        }
        case "nft-transfer": {
          let name = `NFT ${short(friendly(msg.to, m.testnet, true))}`;
          try {
            const n = await http(ctx).json<TonapiNft>(`${m.tonapi}/v2/nfts/${msg.to.toRawString()}`);
            if (n.metadata?.name) name = n.metadata.name;
            if (n.owner && !Address.parse(n.owner.address).equals(m.address)) {
              d.warnings.push({ level: "caution", code: "blind-signing", message: "You don't own this NFT, so this transfer will fail." });
            }
          } catch {
            /* name stays generic */
          }
          titles.push(say("bg.req.sendTo", { amount: name, to: short(addr(body.newOwner)) }));
          d.lines.push({ label: "To", value: addr(body.newOwner) }, { label: "NFT", value: name }, { label: "Covers fees", value: `${g(msg.amount)} (unused part comes back)` });
          break;
        }
        case "unknown":
          d.blind = true;
          titles.push(say("bg.ton.sendToAppContract", { amount: g(msg.amount) }));
          d.lines.push({ label: "To", value: to }, { label: "Amount", value: g(msg.amount) }, { label: "Data", value: body.op === null ? "Unreadable" : `Operation 0x${body.op.toString(16).padStart(8, "0")}` });
          d.warnings.push({ level: "danger", code: "blind-signing", message: "We can't read what this message tells the contract to do. Only continue if you fully trust this app." });
          break;
      }
      if (msg.init) d.lines.push({ label: "Also", value: `Creates a new contract at ${short(to)}` });
    }
    d.title = titles.length === 1 ? titles[0]! : `Approve ${titles.length} transfers for ${host}`;
    if (titles.length > 1) d.lines.unshift(...titles.map((t, i) => ({ label: say("bg.label.transferN", { n: i + 1 }), value: t })));
    return d;
  }

  async function plan(ctx: ChainContext, m: Me, p: SendTxPayload, msgs: Resolved[]) {
    const info = await walletInfo(ctx, m);
    const deploy = info.status !== "active";
    if (info.status === "frozen") throw new ClipError("This wallet is frozen on TON and can't send right now.", "ton/frozen");
    const t = now();
    const timeout = p.valid_until !== undefined ? Math.min(p.valid_until, t + 600) : t + 300;
    return { seqno: deploy ? 0 : (info.seqno ?? 0), timeout, deploy, messages: msgs.map(toRelaxed), balance: BigInt(info.balance ?? "0") };
  }

  async function emulate(ctx: ChainContext, m: Me, pl: Awaited<ReturnType<typeof plan>>): Promise<{ changes: BalanceChange[]; fee: bigint } | null> {
    const body = await transferBody(m.wallet, pl, async () => Buffer.alloc(64));
    const boc = externalBoc(m.wallet, body, pl.deploy);
    const ev = await http(ctx).json<AccountEvent>(`${m.tonapi}/v2/accounts/${m.raw}/events/emulate?ignore_signature_check=true`, { body: { boc } });
    const mine = (a?: { address: string }) => !!a && Address.parse(a.address).equals(m.address);
    const sums = new Map<string, { asset: AssetRef; delta: bigint }>();
    const add = (asset: AssetRef, delta: bigint) => {
      const k = asset.address ?? asset.key;
      const e = sums.get(k) ?? { asset, delta: 0n };
      e.delta += delta;
      sums.set(k, e);
    };
    for (const a of ev.actions) {
      if (a.TonTransfer) {
        const amt = BigInt(a.TonTransfer.amount);
        if (mine(a.TonTransfer.sender)) add(gramAsset(ctx.network.id), -amt);
        if (mine(a.TonTransfer.recipient)) add(gramAsset(ctx.network.id), amt);
      } else if (a.JettonTransfer) {
        const asset = jettonAsset(ctx, a.JettonTransfer.jetton);
        const amt = BigInt(a.JettonTransfer.amount);
        if (mine(a.JettonTransfer.sender)) add(asset, -amt);
        if (mine(a.JettonTransfer.recipient)) add(asset, amt);
      }
    }
    const extra = BigInt(ev.extra);
    return {
      changes: [...sums.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() })),
      fee: extra < 0n ? -extra : 0n,
    };
  }

  async function estimateFee(ctx: ChainContext, m: Me, pl: Awaited<ReturnType<typeof plan>>): Promise<bigint | null> {
    try {
      const body = await transferBody(m.wallet, pl, async () => Buffer.alloc(64));
      const r = await http(ctx).json<{ ok: boolean; result: { source_fees: Record<string, number> } }>(`${m.toncenter}/v2/estimateFee`, {
        body: {
          address: m.friendly,
          body: body.toBoc().toString("base64"),
          ...(pl.deploy ? { init_code: m.wallet.init.code.toBoc().toString("base64"), init_data: m.wallet.init.data.toBoc().toString("base64") } : {}),
          ignore_chksig: true,
        },
      });
      const f = r.result.source_fees;
      return BigInt((f.in_fwd_fee ?? 0) + (f.storage_fee ?? 0) + (f.gas_fee ?? 0) + (f.fwd_fee ?? 0));
    } catch {
      return null;
    }
  }

  /* -------------------------------------------------------------- ChainModule */

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const m = me(ctx);
    const n = normalize(request);
    const host = hostOf(request.origin);
    const base = { requestId: request.id, networkId: request.networkId };

    if (n.kind === "proof") {
      return {
        ...base,
        ...titled(msg("bg.req.proveOwnership", { host })),
        lines: [
          { label: "Wallet", value: m.friendly },
          { label: "Website", value: host },
        ],
        balanceChanges: [],
        simulated: false,
        blind: false,
        warnings: [],
      };
    }

    if (n.kind === "signData") {
      checkPayload(n.payload, ctx, m);
      const p = n.payload;
      if (p.type === "text") {
        return { ...base, ...titled(msg("bg.req.signMessage", { host })), lines: [{ label: "Message", value: p.text }], balanceChanges: [], simulated: false, blind: false, warnings: [] };
      }
      const lines =
        p.type === "binary"
          ? [{ label: "Data (not text)", value: `0x${hex(Uint8Array.from(Buffer.from(p.bytes, "base64"))).slice(0, 256)}` }]
          : [{ label: "Data format", value: p.schema.length > 200 ? `${p.schema.slice(0, 200)}…` : p.schema }];
      if (p.type === "cell") cellFromB64(p.cell, "cell");
      return {
        ...base,
        ...titled(msg("bg.req.signData", { host })),
        lines,
        balanceChanges: [],
        simulated: false,
        blind: true,
        warnings: [{ level: "danger", code: "blind-signing", message: "We can't show what this data says. Only sign it if you trust the app." }],
      };
    }

    checkTx(n.payload, ctx, m);
    const msgs = await resolve(ctx, m, n.payload);
    const d = await describe(ctx, m, msgs, host);
    const pl = await plan(ctx, m, n.payload, msgs);
    const warnings = [...d.warnings];
    let balanceChanges: BalanceChange[] = [...d.declared.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() }));
    let simulated = false;
    let fee: bigint | null = null;
    if (options.emulate ?? true) {
      try {
        const e = await emulate(ctx, m, pl);
        if (e) {
          balanceChanges = e.changes;
          fee = e.fee;
          simulated = true;
        }
      } catch {
        /* falls through to the no-preview warning */
      }
    }
    if (!simulated) {
      warnings.push({ level: "caution", code: "simulation-failed", message: "We couldn't preview this on TON right now. Check the details carefully." });
      fee = await estimateFee(ctx, m, pl);
    }
    const lines = [...d.lines];
    if (pl.deploy) lines.push({ label: "Wallet", value: "Not active yet. This first transfer also activates it." });
    if (fee !== null) lines.push({ label: "Network fee", value: `≈ ${formatUnits(fee, 9)} GRAM` });
    const out = msgs.reduce((a, x) => a + x.amount, 0n);
    if (pl.balance < out + (fee ?? 0n)) warnings.push({ level: "danger", code: "high-fee", message: "You don't have enough GRAM for this and its network fee." });
    if (!n.wc && n.payload.valid_until === undefined) lines.push({ label: "Valid for", value: "5 minutes" });
    const res: DecodedRequest = { ...base, title: d.title, ...msgOf(d), lines, balanceChanges, simulated, blind: d.blind, warnings };
    if (fee !== null) res.fee = { asset: gramAsset(ctx.network.id), amount: fee.toString() };
    return res;
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const m = me(ctx);
    const n = normalize(request);
    const payload = (bytes: Uint8Array): SignablePayload[] => [{ accountId: ctx.account.id, scheme: "ed25519", bytes, approvalId }];
    const domain = hostOf(request.origin);
    if (n.kind === "proof") {
      const timestamp = now();
      const h = tonProofHash(m.address, domain, timestamp, n.payload);
      prepared.set(request.id, { kind: "proof", hash: h, timestamp, domain });
      return payload(h);
    }
    if (n.kind === "signData") {
      checkPayload(n.payload, ctx, m);
      const timestamp = now();
      const h = signDataHash(n.payload, m.address, domain, timestamp);
      prepared.set(request.id, { kind: "signData", hash: h, timestamp, domain });
      return payload(h);
    }
    checkTx(n.payload, ctx, m);
    const msgs = await resolve(ctx, m, n.payload);
    const pl = await plan(ctx, m, n.payload, msgs);
    const h = await signingHash(m.wallet, pl);
    prepared.set(request.id, { kind: "tx", hash: h, seqno: pl.seqno, timeout: pl.timeout, deploy: pl.deploy, messages: pl.messages });
    return payload(h);
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const m = me(ctx);
    const n = normalize(request);
    const prep = prepared.get(request.id);
    if (!prep || prep.kind !== n.kind) throw new ClipError("This approval expired. Try again from the app.", "ton/not-prepared");
    const sig = signatures[0];
    if (signatures.length !== 1 || !sig || sig.scheme !== "ed25519" || sig.bytes.length !== 64 || !ed25519.verify(sig.bytes, prep.hash, m.pub)) {
      throw new ClipError("The signature didn't match. Nothing was sent.", "ton/bad-signature");
    }
    prepared.delete(request.id);
    if (prep.kind === "proof") {
      const p = n as Extract<Normalized, { kind: "proof" }>;
      return {
        name: "ton_proof",
        proof: { timestamp: prep.timestamp, domain: { lengthBytes: new TextEncoder().encode(prep.domain).length, value: prep.domain }, signature: b64encode(sig.bytes), payload: p.payload },
      };
    }
    if (prep.kind === "signData") {
      const p = (n as Extract<Normalized, { kind: "signData" }>).payload;
      return { signature: b64encode(sig.bytes), address: m.raw, timestamp: prep.timestamp, domain: prep.domain, payload: p };
    }
    if (prep.kind !== "tx") throw new ClipError("This approval expired. Try again from the app.", "ton/not-prepared");
    const body = await transferBody(m.wallet, prep, async () => Buffer.from(sig.bytes));
    const boc = externalBoc(m.wallet, body, prep.deploy);
    try {
      await http(ctx).json<{ ok: boolean }>(`${m.toncenter}/v2/sendBocReturnHash`, { body: { boc } });
    } catch (e) {
      if (e instanceof ClipError) throw e;
      const text = JSON.stringify((e as HttpError).body ?? "");
      throw new ClipError(
        /not enough|insufficient|balance/i.test(text) ? "You don't have enough GRAM for this and its network fee." : "TON didn't accept this transfer. Nothing was sent.",
        "ton/send-failed",
        e,
      );
    }
    return boc;
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const m = me(ctx);
    const info = await walletInfo(ctx, m);
    const out: TokenBalance[] = [{ asset: gramAsset(ctx.network.id), amount: BigInt(info.balance ?? "0").toString() }];
    let jettons: JettonBalance[] = [];
    try {
      jettons = (await http(ctx).json<{ balances: JettonBalance[] }>(`${m.tonapi}/v2/accounts/${m.raw}/jettons`)).balances;
    } catch {
      jettons = [];
    }
    for (const j of jettons) {
      if (!/^\d+$/.test(j.balance) || BigInt(j.balance) === 0n) continue;
      out.push({ asset: jettonAsset(ctx, j.jetton), amount: j.balance });
    }
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const m = me(ctx);
    let items: TonapiNft[] = [];
    try {
      items = (await http(ctx).json<{ nft_items: TonapiNft[] }>(`${m.tonapi}/v2/accounts/${m.raw}/nfts?limit=100&offset=0&indirect_ownership=false`)).nft_items;
    } catch {
      return [];
    }
    return items.map((it) => {
      const nft: Nft = {
        networkId: ctx.network.id,
        standard: "tep62",
        collection: it.collection ? { address: Address.parse(it.collection.address).toRawString(), name: it.collection.name } : { address: Address.parse(it.address).toRawString(), name: "Single item" },
        tokenId: Address.parse(it.address).toRawString(),
      };
      if (it.metadata?.name) nft.name = it.metadata.name;
      const media = it.previews?.find((p) => p.resolution === "500x500")?.url ?? it.metadata?.image;
      if (media) nft.mediaUrl = media; // untrusted: sandboxed media proxy only
      const attrs = (it.metadata?.attributes ?? []).filter((a) => a.trait_type).map((a) => ({ trait: String(a.trait_type), value: String(a.value) }));
      if (attrs.length) nft.attributes = attrs;
      if (it.trust === "blacklist") nft.spam = true;
      return nft;
    });
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const m = me(ctx);
    const to = p.to.trim();
    if (!isAnyAddress(to)) throw new ClipError("That doesn't look like a TON address.", "ton/bad-address");
    const dest = Address.parse(to);
    if (dest.equals(m.address)) throw new ClipError("That's your own address.", "ton/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "ton/bad-amount");
    const amount = BigInt(p.amount);
    const info = await walletInfo(ctx, m);
    const balance = BigInt(info.balance ?? "0");
    const network = tonConnectNetwork(ctx.network.id);
    const base = { id: randomId(), origin: "clip-wallet", via: "injected" as const, family: "ton" as const, networkId: ctx.network.id, method: TON_METHODS.sendTransaction };
    if (!p.asset.address) {
      if (balance < amount) throw new ClipError("You don't have enough GRAM.", "ton/insufficient");
      // A friendly address keeps the sender's bounce choice; a raw one bounces only if the recipient is active.
      let bounce: boolean;
      if (Address.isFriendly(to)) bounce = Address.parseFriendly(to).isBounceable;
      else {
        const st = await http(ctx).json<{ status: string }>(`${m.toncenter}/v3/addressInformation?address=${encodeURIComponent(to)}&use_v2=false`).catch(() => ({ status: "active" }));
        bounce = st.status === "active";
      }
      return { ...base, params: { network, from: m.raw, messages: [{ address: dest.toString({ urlSafe: true, bounceable: bounce, testOnly: m.testnet }), amount: amount.toString() }] } };
    }
    const master = Address.parse(p.asset.address);
    if (dest.equals(master)) throw new ClipError("That's the token's own contract, not a wallet. Ask the recipient for their address.", "ton/token-recipient");
    const r = await http(ctx)
      .json<JettonBalance>(`${m.tonapi}/v2/accounts/${m.raw}/jettons/${master.toRawString()}`)
      .catch(() => null);
    if (!r || BigInt(r.balance) < amount) throw new ClipError(msg("bg.err.notEnough", { symbol: p.asset.symbol }), "ton/insufficient-token");
    if (balance < DEFAULT_ATTACH + 1n) throw new ClipError("You need a little GRAM to send tokens (about 0.05).", "ton/insufficient");
    return {
      ...base,
      params: {
        network,
        from: m.raw,
        items: [{ type: "jetton", master: master.toRawString(), destination: dest.toRawString(), amount: amount.toString(), forwardAmount: "1" }],
      },
    };
  }

  const features = [
    { name: "SendTransaction", maxMessages: MAX_MESSAGES[version], itemTypes: ["ton", "jetton", "nft"] },
    { name: "SignData", types: ["text", "binary", "cell"] },
  ] as const;

  return {
    family: "ton",
    curve: "ed25519",
    /** BIP-39 + SLIP-10, all hardened: Trust Wallet / MyTonWallet "BIP39" accounts (SLIP-44 coin type 607). */
    derivationPath: (index: number) => `m/44'/607'/${index}'`,
    addressFromPublicKey(publicKey: Uint8Array, network: Network): string {
      return friendly(walletOf(publicKey, network).address, endpoints(network).testnet);
    },
    isAddress: (value: string) => isAnyAddress(value),
    /** A test-only friendly address belongs on testnets; anything else could be either. */
    networksForAddress(value: string, candidates: Network[]): Network[] {
      if (!isAnyAddress(value)) return [];
      const ton = candidates.filter((c) => c.family === "ton");
      if (Address.isFriendly(value.trim()) && Address.parseFriendly(value.trim()).isTestOnly) return ton.filter((c) => c.testnet);
      return ton;
    },
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    walletAddress(publicKey, network) {
      const w = walletOf(publicKey, network);
      return { raw: w.address.toRawString(), friendly: friendly(w.address, endpoints(network).testnet) };
    },
    tonAddrItem(publicKey, network) {
      const w = walletOf(publicKey, network);
      return { name: "ton_addr", address: w.address.toRawString(), network: tonConnectNetwork(network.id), publicKey: hex(publicKey), walletStateInit: stateInitBoc(w) };
    },
    features,
  };
}

/** The Msg a described title carries (explicit titles keep it through the mapping to a DecodedRequest). */
function msgOf(d: { title: string }): { titleMsg?: Msg } {
  const m = (d as { titleMsg?: Msg }).titleMsg;
  return m ? { titleMsg: m } : {};
}
