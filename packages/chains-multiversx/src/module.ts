import {
  type AssetRef,
  type BalanceChange,
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
  msg,
  say,
  titled,
} from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { GatewayError, MultiversXClient, type NetworkConfig, plainMultiversXError } from "./api.js";
import { type Described, describeTransaction } from "./describe.js";
import { EGLD_DECIMALS, MULTIVERSX_NETS, type TokenInfo, egldAsset, esdtAsset, isEsdtIdentifier, netOf, specFor } from "./networks.js";
import { type Tx, bytesToSign, parseTransaction, plainOf, signedPlain } from "./tx.js";
import { concat, decodeAddress, encodeAddress, formatUnits, hex, hostOf, numberArg, randomId, sleep, textOf, utf8 } from "./util.js";

/**
 * Request methods: the MultiversX WalletConnect methods (mx-sdk-js-wallet-connect-provider `OPERATION`):
 * `mvx_signTransaction` `{ transaction }` → `{ signature }`, `mvx_signTransactions` `{ transactions }` →
 * `{ signatures: [{ signature }] }`, `mvx_signMessage` `{ message, address }` → `{ signature }`. Results also carry
 * the signed plain transactions. `mvx_signAndSendTransactions` is Clip Wallet's own (same params as
 * mvx_signTransactions; the wallet also sends them): buildTransfer uses it.
 */
export const MULTIVERSX_METHODS = {
  signTransaction: "mvx_signTransaction",
  signTransactions: "mvx_signTransactions",
  signMessage: "mvx_signMessage",
  signAndSendTransactions: "mvx_signAndSendTransactions",
} as const;

/** sdk-core MESSAGE_PREFIX (core/constants.ts). */
export const MESSAGE_PREFIX = "\x17Elrond Signed Message:\n";

/** Extra gas for an ESDTTransfer (sdk-core TransactionsFactoryConfig.gasLimitESDTTransfer + ADDITIONAL_GAS_FOR_ESDT_TRANSFER). */
export const ESDT_TRANSFER_GAS = 200_000n + 100_000n;

const MAX_TXS = 20;

export interface MultiversXModuleOptions {
  /** Dry-run single transactions in decode() through the gateway's /transaction/simulate (default true). */
  simulate?: boolean;
  /** process-status polls after sending (default 10) and the wait between them (default 1500 ms). */
  confirmAttempts?: number;
  confirmPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type Normalized =
  | { kind: "txs"; txs: Tx[]; single: boolean; send: boolean }
  | { kind: "message"; data: Uint8Array };

/**
 * sdk-core MessageComputer.computeBytesForSigning: keccak256("\x17Elrond Signed Message:\n" ‖ decimal byte length ‖
 * message). The ed25519 signature covers these 32 bytes.
 */
export function messageHash(message: Uint8Array): Uint8Array {
  return keccak_256(concat(utf8(MESSAGE_PREFIX), utf8(String(message.length)), message));
}

/** Checks a request against the connected account and network and parses it. */
export function normalize(request: DappRequest, ctx: ChainContext): Normalized {
  const spec = specFor(request.networkId);
  if (!spec || request.networkId !== ctx.network.id) {
    throw new ClipError("This app is asking for a different MultiversX network than the one it's connected to.", "multiversx/network-mismatch");
  }
  const me = ctx.account.address;
  const p = (request.params ?? {}) as Record<string, unknown>;
  if (typeof p !== "object") throw new ClipError("This request from the app is malformed, so we stopped it.", "multiversx/bad-params");
  if (typeof p.address === "string" && p.address && p.address !== me) {
    throw new ClipError("This request is for a different account than the one you connected.", "multiversx/wrong-account");
  }
  const checkTx = (raw: unknown): Tx => {
    const tx = parseTransaction(raw);
    if (tx.sender !== me) throw new ClipError("This request is for a different account than the one you connected.", "multiversx/wrong-account");
    if (tx.chainID !== spec.chainId) {
      throw new ClipError("This app is asking for a different MultiversX network than the one it's connected to.", "multiversx/network-mismatch");
    }
    return tx;
  };
  switch (request.method) {
    case MULTIVERSX_METHODS.signTransaction:
      return { kind: "txs", txs: [checkTx(p.transaction)], single: true, send: false };
    case MULTIVERSX_METHODS.signTransactions:
    case MULTIVERSX_METHODS.signAndSendTransactions: {
      const list = p.transactions;
      if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TXS) throw new ClipError("This transaction can't be read.", "multiversx/bad-params");
      const txs = list.map(checkTx);
      // Wallet-sent batches go out in nonce order, one after another.
      if (request.method === MULTIVERSX_METHODS.signAndSendTransactions && request.origin !== WALLET_ORIGIN) {
        throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "multiversx/unsupported-method");
      }
      return { kind: "txs", txs, single: false, send: request.method === MULTIVERSX_METHODS.signAndSendTransactions };
    }
    case MULTIVERSX_METHODS.signMessage: {
      if (typeof p.message !== "string") throw new ClipError("This request from the app is malformed, so we stopped it.", "multiversx/bad-params");
      return { kind: "message", data: utf8(p.message) };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "multiversx/unsupported-method");
  }
}

/**
 * The site a MultiversX native-auth login token is for, or null. Token (sdk-native-auth-client `initialize`):
 * base64url(origin) "." blockHash "." ttl "." base64url(extraInfo JSON); sdk-native-auth-server verifies the signature
 * over the message `address + token` (MessageComputer).
 */
export function nativeAuthOrigin(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || !/^[0-9a-f]{64}$/i.test(parts[1]!) || !/^\d{1,10}$/.test(parts[2]!)) return null;
  try {
    const p = parts[0]!;
    const b = atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4));
    const origin = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
    return /^https?:\/\/[^\s/]+$/.test(origin) ? origin : null;
  } catch {
    return null;
  }
}

function payloadBytes(n: Normalized): Uint8Array[] {
  return n.kind === "message" ? [messageHash(n.data)] : n.txs.map(bytesToSign);
}

export interface MultiversXModule extends ChainModule {
  normalize: typeof normalize;
}

export function createMultiversXModule(options: MultiversXModuleOptions = {}): MultiversXModule {
  const configs = new Map<string, Promise<NetworkConfig>>();
  const tokenCache = new Map<string, Promise<TokenInfo | null>>();
  const wait = options.sleep ?? sleep;
  const attempts = options.confirmAttempts ?? 10;
  const pollMs = options.confirmPollMs ?? 1500;

  function clientFor(ctx: ChainContext): MultiversXClient {
    const n = netOf(ctx.network.id);
    const spec = n ? MULTIVERSX_NETS[n] : null;
    const gateway = ctx.network.rpcUrls[0] ?? spec?.gateway;
    const api = ctx.network.indexerUrl ?? spec?.api;
    if (!gateway || !api) throw new ClipError("No connection is set up for this network.", "multiversx/no-rpc");
    return new MultiversXClient(gateway.replace(/\/$/, ""), api.replace(/\/$/, ""), ctx.fetch);
  }

  function configFor(ctx: ChainContext, client: MultiversXClient): Promise<NetworkConfig> {
    let c = configs.get(ctx.network.id);
    if (!c) {
      c = client.networkConfig();
      configs.set(ctx.network.id, c);
      c.catch(() => configs.delete(ctx.network.id));
    }
    return c;
  }

  function tokenInfo(ctx: ChainContext, client: MultiversXClient, identifier: string): Promise<TokenInfo | null> {
    const key = `${ctx.network.id}:${identifier}`;
    let t = tokenCache.get(key);
    if (!t) {
      t = client.token(identifier);
      tokenCache.set(key, t);
    }
    return t;
  }

  async function describeAll(req: DappRequest, ctx: ChainContext, txs: Tx[]): Promise<Described[]> {
    const client = clientFor(ctx);
    const config = await configFor(ctx, client);
    const d = { networkId: ctx.network.id, me: ctx.account.address, host: hostOf(req.origin), config, client, token: (id: string) => tokenInfo(ctx, client, id) };
    const out: Described[] = [];
    for (const tx of txs) out.push(await describeTransaction(tx, d));
    return out;
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(req, ctx);
    const base = { requestId: req.id, networkId: req.networkId };
    const host = hostOf(req.origin);
    if (n.kind === "message") {
      const text = textOf(n.data);
      const me = ctx.account.address;
      const site = text?.startsWith(me) ? nativeAuthOrigin(text.slice(me.length)) : null;
      if (site) {
        // A native-auth login: address + token, the token naming the site it signs in to.
        const domain = hostOf(site);
        const warnings: Warning[] = [];
        if (domain !== host) {
          const w = msg("bg.warn.signInPhishing", { domain, host });
          warnings.push({ level: "danger", code: "domain-mismatch", message: w.fallback, msg: w });
        }
        return { ...base, ...titled(msg("bg.req.signIn", { domain })), lines: [{ label: "Website", value: site }, { label: "Message", value: text! }], balanceChanges: [], simulated: false, blind: false, warnings };
      }
      const warnings: Warning[] = text === null ? [{ level: "danger", code: "blind-signing", message: "This message isn't readable text. Only sign it if you trust the app." }] : [];
      return { ...base, ...titled(msg("bg.req.signMessage", { host })), lines: [{ label: "Message", value: text ?? hex(n.data) }], balanceChanges: [], simulated: false, blind: text === null, warnings };
    }
    const ds = await describeAll(req, ctx, n.txs);
    const egld = egldAsset(ctx.network.id);
    let simulated = false;
    const simWarnings: Warning[] = [];
    if ((options.simulate ?? true) && n.txs.length === 1 && !ds[0]!.blind) {
      const sim = await clientFor(ctx).simulate(plainOf(n.txs[0]!)).catch(() => null);
      if (sim?.ok) simulated = true;
      else if (sim) {
        simWarnings.push({
          level: "caution",
          code: "simulation-failed",
          message: /insufficient|not enough/i.test(sim.reason ?? "")
            ? "A test run says you don't have enough EGLD for this and its network fee."
            : "A test run of this transaction failed. It would probably fail and still cost the network fee.",
        });
      }
    }
    const sponsored = n.txs.every((t) => !!t.relayer);
    const fee = ds.reduce((a, d, i) => a + (n.txs[i]!.relayer ? 0n : d.fee), 0n);
    const lines = ds.length === 1 ? [...ds[0]!.lines] : ds.map((d, i) => ({ label: say("bg.label.transactionN", { n: i + 1 }), value: d.title }));
    lines.push({ label: "Network fee", value: `up to ${formatUnits(fee, EGLD_DECIMALS)} EGLD` });
    if (!n.send) lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });
    const head = ds.length === 1 ? { title: ds[0]!.title, ...(ds[0]!.titleMsg ? { titleMsg: ds[0]!.titleMsg } : {}) } : titled(msg("bg.req.approveCount", { count: ds.length }));
    return {
      ...base,
      ...head,
      lines,
      balanceChanges: merge(ds.flatMap((d) => d.balanceChanges)),
      fee: { asset: egld, amount: fee.toString(), ...(sponsored ? { sponsored: true } : {}) },
      blind: ds.some((d) => d.blind),
      simulated,
      warnings: [...ds.flatMap((d) => d.warnings), ...simWarnings],
    };
  }

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    return payloadBytes(normalize(req, ctx)).map((bytes) => ({ accountId: ctx.account.id, scheme: "ed25519", bytes, approvalId }));
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(req, ctx);
    const payloads = payloadBytes(n);
    if (signatures.length !== payloads.length) throw new ClipError("Some signatures are missing. Nothing was sent.", "multiversx/bad-signature");
    const pub = decodeAddress(ctx.account.address);
    if (!pub) throw new ClipError("That address isn't valid. Check it and try again.", "multiversx/bad-address");
    payloads.forEach((bytes, i) => {
      const s = signatures[i]!;
      if (s.scheme !== "ed25519" || s.bytes.length !== 64 || !ed25519.verify(s.bytes, bytes, pub)) {
        throw new ClipError("The signature didn't match. Nothing was sent.", "multiversx/bad-signature");
      }
    });
    if (n.kind === "message") return { signature: hex(signatures[0]!.bytes), address: ctx.account.address };
    const signed = n.txs.map((tx, i) => signedPlain(tx, signatures[i]!.bytes));
    if (n.single) return { signature: signed[0]!.signature, transaction: signed[0] };
    if (!n.send) return { signatures: signed.map((t) => ({ signature: t.signature })), transactions: signed };

    const client = clientFor(ctx);
    const hashes: string[] = [];
    for (const tx of signed) {
      let hash: string;
      try {
        hash = await client.send(tx);
      } catch (e) {
        if (e instanceof ClipError) throw e;
        if (e instanceof GatewayError) throw new ClipError(plainMultiversXError(e.message), "multiversx/send-failed", e);
        throw new ClipError("The MultiversX network rejected this transaction. Nothing was sent.", "multiversx/send-failed", e);
      }
      hashes.push(hash);
      await confirm(client, hash);
    }
    return { txHash: hashes[0]!, txHashes: hashes, status: "success" };
  }

  /** Polls process-status. "fail"/"invalid" become plain errors; still pending after the last poll = accepted. */
  async function confirm(client: MultiversXClient, hash: string): Promise<void> {
    for (let k = 0; k < attempts; k++) {
      await wait(pollMs);
      const s = await client.processStatus(hash).catch(() => null);
      if (!s || s.status === "pending" || s.status === "received") continue;
      if (s.status === "success") return;
      if (s.status === "fail" || s.status === "invalid") {
        const reason = reasonText(s.reason);
        throw new ClipError(
          reason && /insufficient funds|not enough/i.test(reason) ? "The transaction failed: there wasn't enough to cover it. Only the network fee was spent." : "The transaction failed on MultiversX. Only the network fee was spent.",
          "multiversx/transaction-failed",
          s,
        );
      }
    }
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const client = clientFor(ctx);
    const acct = await client.account(ctx.account.address);
    const out: TokenBalance[] = [{ asset: egldAsset(ctx.network.id), amount: /^\d+$/.test(acct.balance) ? acct.balance : "0" }];
    const tokens = await client.tokens(ctx.account.address).catch(() => []);
    for (const t of tokens) {
      if (t.type && t.type !== "FungibleESDT") continue;
      if (!t.identifier || !isEsdtIdentifier(t.identifier) || !/^\d+$/.test(t.balance ?? "")) continue;
      out.push({ asset: esdtAsset(ctx.network.id, t), amount: t.balance! });
    }
    return out;
  }

  async function getNfts(): Promise<Nft[]> {
    // NFTs/SFTs are listed by the API (/accounts/{a}/nfts) but not shown yet.
    return [];
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const me = ctx.account.address;
    const to = p.to.trim();
    if (!decodeAddress(to)) throw new ClipError("That address isn't valid. Check it and try again.", "multiversx/bad-address");
    if (to === me) throw new ClipError("That's your own address.", "multiversx/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "multiversx/bad-amount");
    const amount = BigInt(p.amount);
    const spec = specFor(ctx.network.id);
    if (!spec) throw new ClipError("That network isn't available in this wallet.", "multiversx/unknown-network");
    const client = clientFor(ctx);
    const config = await configFor(ctx, client);
    if (config.chainId !== spec.chainId) throw new ClipError("This app is asking for a different MultiversX network than the one it's connected to.", "multiversx/network-mismatch");
    const [acct, guarded] = await Promise.all([client.account(me), client.isGuarded(me)]);
    if (guarded) throw new ClipError(msg("bg.multiversx.guardedAccount"), "multiversx/guarded");
    const balance = /^\d+$/.test(acct.balance) ? BigInt(acct.balance) : 0n;

    let data = new Uint8Array();
    let value = amount;
    let receiver = to;
    let gasLimit = config.minGasLimit;
    if (p.asset.address) {
      const id = p.asset.address;
      if (!isEsdtIdentifier(id)) throw new ClipError("That token couldn't be found.", "multiversx/unknown-token");
      const held = await client.esdtBalance(me, id);
      if (held < amount) throw new ClipError(msg("bg.err.notEnough", { symbol: p.asset.symbol }), "multiversx/insufficient-token");
      data = utf8(`ESDTTransfer@${hex(utf8(id))}@${numberArg(amount)}`);
      value = 0n;
      receiver = to;
      gasLimit = config.minGasLimit + config.gasPerDataByte * BigInt(data.length) + ESDT_TRANSFER_GAS;
    }
    const fee = gasLimit * config.minGasPrice;
    if (balance < value + fee) {
      throw new ClipError(msg("bg.err.notEnoughForFee", { symbol: "EGLD" }), "multiversx/insufficient-funds");
    }
    const tx: Tx = {
      nonce: BigInt(acct.nonce),
      value,
      receiver,
      sender: me,
      senderUsername: new Uint8Array(),
      receiverUsername: new Uint8Array(),
      gasPrice: config.minGasPrice,
      gasLimit,
      data,
      chainID: spec.chainId,
      version: 2,
      options: 0,
      guardian: "",
      relayer: "",
      guardianSignature: "",
      relayerSignature: "",
    };
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "multiversx",
      networkId: ctx.network.id,
      method: MULTIVERSX_METHODS.signAndSendTransactions,
      params: { transactions: [plainOf(tx)] },
    };
  }

  return {
    family: "multiversx",
    curve: "ed25519",
    /** xPortal / MultiversX DeFi Wallet / sdk-core Mnemonic.deriveKey(i): SLIP-10 ed25519, all hardened. */
    derivationPath: (index: number) => `m/44'/508'/0'/0'/${index}'`,
    addressFromPublicKey(publicKey: Uint8Array, _network: Network): string {
      if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
      return encodeAddress(publicKey);
    },
    /** "erd1…" bech32 with a valid checksum and a 32-byte key (accounts and contracts). */
    isAddress: (value: string) => decodeAddress(value.trim()) !== null,
    /** The same address works on every MultiversX network. */
    networksForAddress: (value: string, candidates: Network[]) => (decodeAddress(value.trim()) ? candidates.filter((c) => c.family === "multiversx") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
  };
}

function merge(changes: BalanceChange[]): BalanceChange[] {
  const by = new Map<string, BalanceChange>();
  for (const c of changes) {
    const k = `${c.asset.key}:${c.asset.address ?? ""}`;
    const prev = by.get(k);
    by.set(k, prev ? { asset: prev.asset, delta: (BigInt(prev.delta) + BigInt(c.delta)).toString() } : c);
  }
  return [...by.values()].filter((c) => c.delta !== "0");
}

/** process-status reasons look like "@04@<hex message>@…": the message as text, or the raw reason. */
function reasonText(reason: string | undefined): string | null {
  if (!reason) return null;
  const parts = reason.split("@");
  const hexMsg = parts[2];
  if (hexMsg && /^([0-9a-f]{2})+$/i.test(hexMsg)) {
    const bytes = Uint8Array.from(hexMsg.match(/../g)!.map((x) => parseInt(x, 16)));
    return textOf(bytes) ?? reason;
  }
  return reason;
}
