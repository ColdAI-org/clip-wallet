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
} from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { BadAction, parseAction } from "./actions.js";
import {
  type Action,
  type PublicKey,
  type Transaction,
  decodeTransaction,
  encodeSignedTransaction,
  encodeTransaction,
  publicKeyToString,
  samePublicKey,
} from "./borsh.js";
import { type Described, type TxView, TGAS, describeTx, near } from "./describe.js";
import { isPool, nearAsset, networkName, poolName } from "./networks.js";
import { type Nep413Params, nep413Hash } from "./nep413.js";
import { type AccessKeyView, NearRpc, RpcError, plainNearError } from "./rpc.js";
import { assetFor, fastnearJson, fastnearUrl, ftMetadata, nftsFor } from "./tokens.js";
import { b64encode, bytesShape, fromHex, hostOf, randomId, shapeBytes, toBytes } from "./util.js";

const base58Decode = (s: string) => base58.decode(s);

/**
 * Request methods. Injected (1Mask NEAR provider, wallet-selector style) and WalletConnect
 * (near/wallet-selector packages/wallet-connect WC_METHODS; docs.reown.com/advanced/multichain/rpc-reference/near-rpc).
 * `near_signMessage` is shared: wallet-selector's WalletConnect wallet sends the same params plus `accountId`.
 */
export const NEAR_METHODS = {
  signAndSendTransaction: "near_signAndSendTransaction",
  signAndSendTransactions: "near_signAndSendTransactions",
  signMessage: "near_signMessage",
  /** WalletConnect: { transaction: bytes (borsh Transaction) } → bytes (borsh SignedTransaction). Not sent. */
  wcSignTransaction: "near_signTransaction",
  /** WalletConnect: { transactions: bytes[] } → bytes[]. Not sent. */
  wcSignTransactions: "near_signTransactions",
  /** WalletConnect: { permission: { receiverId, methodNames }, accounts: [{ accountId, publicKey }] } → null. Adds an app key on chain. */
  wcSignIn: "near_signIn",
  /** WalletConnect: { accounts: [{ accountId, publicKey }] } → null. Deletes those app keys on chain. */
  wcSignOut: "near_signOut",
} as const;

/** One NEAR action as it travels in JSON (see actions.ts for every accepted shape). */
export type NearActionJson = Record<string, unknown>;

export interface StakePosition {
  validator: string;
  validatorName?: string;
  asset: AssetRef;
  /** Base units (yoctoNEAR), decimal strings. */
  staked: string;
  unstaking?: string;
  withdrawable?: string;
  withdrawableAt?: string;
}

export interface NearModuleOptions {
  /** Extra staking pools to check in staking.getPositions (per network id), besides the ones FastNEAR reports. */
  stakingPools?: Record<string, string[]>;
  ipfsGateway?: string;
  /** Fee allowance for app keys added by WalletConnect near_signIn (yoctoNEAR). Default 0.25 NEAR. */
  signInAllowance?: bigint;
}

/** Gas for FT calls (ft_transfer, storage_deposit) and staking-pool calls (MyNearWallet uses 5 × 25 Tgas). */
export const FT_GAS = 30n * TGAS;
export const STAKING_GAS = 125n * TGAS;
/** Storage is 1e19 yoctoNEAR per byte (EXPERIMENTAL_protocol_config storage_amount_per_byte, mainnet and testnet). */
export const STORAGE_PRICE_PER_BYTE = 10n ** 19n;
/** NEP-448: accounts using at most 770 bytes need no balance for storage. */
export const ZERO_BALANCE_STORAGE_LIMIT = 770;

type TxSpec = TxView;

type Normalized =
  | { kind: "build"; txs: TxSpec[]; result: "one" | "many" | "void" }
  | { kind: "signed"; txs: { bytes: Uint8Array; tx: Transaction }[]; shapes: ("buffer" | "array")[]; many: boolean }
  | { kind: "message"; accountId: string; params: Nep413Params; state?: string };

const IMPLICIT = /^[0-9a-f]{64}$/;
const ETH_IMPLICIT = /^0x[0-9a-f]{40}$/;
const NAMED = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** NEAR account id rules (nomicon DataStructures/Account): 2–64 chars of lowercase a-z, 0-9 and separators - _ . */
export function isAccountId(value: string): boolean {
  return value.length >= 2 && value.length <= 64 && NAMED.test(value);
}

export function isImplicit(value: string): boolean {
  return IMPLICIT.test(value) || ETH_IMPLICIT.test(value);
}

function bad(what: string): ClipError {
  return new ClipError(`This request is missing its ${what}.`, "near/bad-params");
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function myKey(ctx: ChainContext): PublicKey {
  const data = fromHex(ctx.account.publicKey);
  if (data.length !== 32) throw new ClipError("This account's key isn't a NEAR key.", "near/bad-account");
  return { keyType: 0, data };
}

function parseActions(list: unknown): Action[] {
  if (!Array.isArray(list)) throw bad("actions");
  try {
    return list.map(parseAction);
  } catch (e) {
    if (e instanceof BadAction) throw new ClipError("This transaction has an action that can't be read.", "near/bad-action", e);
    throw e;
  }
}

function txSpec(t: unknown, me: string): TxSpec {
  if (!isObj(t)) throw bad("transaction");
  const signerId = typeof t.signerId === "string" && t.signerId ? t.signerId : me;
  if (typeof t.receiverId !== "string" || !isAccountId(t.receiverId)) throw bad("receiver");
  if (!isAccountId(signerId)) throw bad("signer");
  return { signerId, receiverId: t.receiverId, actions: parseActions(t.actions) };
}

export function normalize(request: DappRequest, me: string, pk: PublicKey, signInAllowance = 250_000_000_000_000_000_000_000n): Normalized {
  const p = isObj(request.params) ? request.params : {};
  switch (request.method) {
    case NEAR_METHODS.signAndSendTransaction:
      return { kind: "build", txs: [txSpec(p, me)], result: "one" };
    case NEAR_METHODS.signAndSendTransactions: {
      if (!Array.isArray(p.transactions) || !p.transactions.length) throw bad("transactions");
      return { kind: "build", txs: p.transactions.map((t) => txSpec(t, me)), result: "many" };
    }
    case NEAR_METHODS.wcSignTransaction:
    case NEAR_METHODS.wcSignTransactions: {
      const many = request.method === NEAR_METHODS.wcSignTransactions;
      const raw = many ? p.transactions : [p.transaction];
      if (!Array.isArray(raw) || !raw.length || raw.some((x) => x == null)) throw bad(many ? "transactions" : "transaction");
      const txs = raw.map((x) => {
        let bytes: Uint8Array;
        let tx: Transaction;
        try {
          bytes = toBytes(x, "transaction");
          tx = decodeTransaction(bytes);
        } catch (cause) {
          throw new ClipError("This transaction can't be read.", "near/bad-transaction", cause);
        }
        if (!samePublicKey(tx.publicKey, pk)) {
          throw new ClipError("This transaction is for a different key than this wallet's.", "near/wrong-account");
        }
        return { bytes, tx };
      });
      return { kind: "signed", txs, shapes: raw.map(bytesShape), many };
    }
    case NEAR_METHODS.wcSignIn:
    case NEAR_METHODS.wcSignOut: {
      if (!Array.isArray(p.accounts) || !p.accounts.length) throw bad("accounts");
      const perm = isObj(p.permission) ? p.permission : {};
      if (request.method === NEAR_METHODS.wcSignIn && typeof perm.receiverId !== "string") throw bad("contract");
      const txs = p.accounts.map((a): TxSpec => {
        if (!isObj(a) || typeof a.accountId !== "string" || typeof a.publicKey !== "string") throw bad("accounts");
        const action =
          request.method === NEAR_METHODS.wcSignIn
            ? {
                type: "AddKey",
                params: {
                  publicKey: a.publicKey,
                  accessKey: {
                    permission: { receiverId: perm.receiverId, allowance: signInAllowance.toString(), methodNames: Array.isArray(perm.methodNames) ? perm.methodNames : [] },
                  },
                },
              }
            : { type: "DeleteKey", params: { publicKey: a.publicKey } };
        return { signerId: a.accountId, receiverId: a.accountId, actions: parseActions([action]) };
      });
      return { kind: "build", txs, result: "void" };
    }
    case NEAR_METHODS.signMessage: {
      if (typeof p.message !== "string") throw bad("message");
      if (typeof p.recipient !== "string" || !p.recipient) throw bad("recipient");
      let nonce: Uint8Array;
      try {
        nonce = toBytes(p.nonce, "nonce");
      } catch {
        throw bad("nonce");
      }
      if (nonce.length !== 32) throw new ClipError("This sign-in request has a bad nonce (it must be 32 bytes).", "near/bad-params");
      const accountId = typeof p.accountId === "string" && p.accountId ? p.accountId : me;
      const params: Nep413Params = { message: p.message, recipient: p.recipient, nonce };
      if (typeof p.callbackUrl === "string" && p.callbackUrl) params.callbackUrl = p.callbackUrl;
      const n: Normalized = { kind: "message", accountId, params };
      if (typeof p.state === "string") n.state = p.state;
      return n;
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this NEAR request yet.", "near/unsupported-method");
  }
}

function rpcFor(ctx: ChainContext): NearRpc {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("No NEAR connection is set up for this network.", "near/no-rpc");
  return new NearRpc(url, ctx.fetch);
}

function netError(e: unknown): ClipError {
  if (e instanceof ClipError) return e;
  return new ClipError("Couldn't reach NEAR. Check your connection and try again.", "near/network", e);
}

/** NEP-413 recipients are usually the app's host; account ids are allowed too. */
function recipientMatches(recipient: string, host: string): boolean {
  const r = recipient.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const h = host.toLowerCase();
  const strip = (x: string) => x.replace(/:\d+$/, "").replace(/^www\./, "");
  return strip(r) === strip(h) || strip(h).endsWith(`.${strip(r)}`);
}

function looksLikeAccountId(v: string): boolean {
  return isImplicit(v) || /\.(near|testnet|tg|aurora|sweat)$/.test(v) || (isAccountId(v) && !v.includes("."));
}

/** The access-key rules nearcore applies to function-call keys (receiver, method list, no deposit). */
function keyAllows(perm: AccessKeyView["permission"], tx: TxSpec): string | null {
  if (perm === "FullAccess") return null;
  const fc = isObj(perm) && isObj(perm.FunctionCall) ? (perm.FunctionCall as { receiver_id: string; method_names: string[] }) : null;
  if (!fc) return "This wallet's key for that account has permissions Clip Wallet doesn't recognise.";
  if (tx.receiverId !== fc.receiver_id) return `This wallet's key for ${tx.signerId} can only be used with ${fc.receiver_id}.`;
  for (const a of tx.actions) {
    if (a.kind !== "FunctionCall") return `This wallet's key for ${tx.signerId} can only call apps, not send NEAR or change keys.`;
    if (a.deposit > 0n) return `This wallet's key for ${tx.signerId} can't attach NEAR to app calls.`;
    if (fc.method_names.length && !fc.method_names.includes(a.methodName)) return `This wallet's key for ${tx.signerId} can't call ${a.methodName}.`;
  }
  return null;
}

async function accessKey(rpc: NearRpc, signerId: string, pk: PublicKey, me: string): Promise<AccessKeyView> {
  try {
    return await rpc.viewAccessKey(signerId, publicKeyToString(pk));
  } catch (e) {
    if (e instanceof RpcError && e.name === "UNKNOWN_ACCOUNT") {
      if (signerId === me && isImplicit(me)) {
        throw new ClipError("This account doesn't exist on NEAR yet. Receive some NEAR first, then try again.", "near/account-not-found", e);
      }
      throw new ClipError(`There's no NEAR account called ${signerId}.`, "near/account-not-found", e);
    }
    if (e instanceof RpcError && (e.name === "UNKNOWN_ACCESS_KEY" || e.name === "QUERY_ERROR")) {
      throw new ClipError("This NEAR account isn't controlled by this wallet's key.", "near/not-your-account", e);
    }
    throw netError(e);
  }
}

async function checkKey(rpc: NearRpc, tx: TxSpec, pk: PublicKey, me: string): Promise<bigint> {
  const ak = await accessKey(rpc, tx.signerId, pk, me);
  const why = keyAllows(ak.permission, tx);
  if (why) throw new ClipError(why, "near/limited-key");
  return BigInt(ak.nonce);
}

async function accountExists(rpc: NearRpc, id: string): Promise<boolean> {
  try {
    await rpc.viewAccount(id);
    return true;
  } catch (e) {
    if (e instanceof RpcError && e.name === "UNKNOWN_ACCOUNT") return false;
    throw netError(e);
  }
}

/** Liquid NEAR minus what storage locks (none for accounts within the NEP-448 zero-balance limit). */
export function spendable(amount: bigint, storageUsage: number): { storageReserved: bigint; available: bigint } {
  const storageReserved = storageUsage <= ZERO_BALANCE_STORAGE_LIMIT ? 0n : BigInt(storageUsage) * STORAGE_PRICE_PER_BYTE;
  const available = amount > storageReserved ? amount - storageReserved : 0n;
  return { storageReserved, available };
}

interface Prepared {
  approvalId: string;
  txBytes: Uint8Array[];
  hashes: Uint8Array[];
}

export interface NearStaking {
  getPositions(ctx: ChainContext): Promise<StakePosition[]>;
  buildStake(p: { validator: string; amount: string }, ctx: ChainContext): Promise<DappRequest>;
  /** `amount` in yoctoNEAR → `unstake {amount}`; absent → `unstake_all`. */
  buildUnstake(p: { validator: string; amount?: string }, ctx: ChainContext): Promise<DappRequest>;
  /** `amount` in yoctoNEAR → `withdraw {amount}`; absent → `withdraw_all`. */
  buildWithdraw(p: { validator: string; amount?: string }, ctx: ChainContext): Promise<DappRequest>;
}

export type NearModule = ChainModule & {
  buildTransfer(p: { asset: AssetRef; to: string; amount: string; signerId?: string }, ctx: ChainContext): Promise<DappRequest>;
  normalize: typeof normalize;
  listAccountIds(ctx: ChainContext): Promise<string[]>;
  getNearBalance(ctx: ChainContext): Promise<{ total: bigint; storageReserved: bigint; available: bigint; staked: bigint }>;
  staking: NearStaking;
};

export function createNearModule(options: NearModuleOptions = {}): NearModule {
  const gateway = options.ipfsGateway ?? "https://ipfs.io/ipfs/";
  /** Built transactions by request id: finalize() must sign-and-send exactly what prepare() asked the vault to sign. */
  const prepared = new Map<string, Prepared>();

  function norm(request: DappRequest, ctx: ChainContext): Normalized {
    if (request.family !== "near") throw new ClipError("This isn't a NEAR request.", "near/bad-params");
    return normalize(request, ctx.account.address, myKey(ctx), options.signInAllowance);
  }

  async function combine(txs: TxSpec[], ctx: ChainContext, host: string): Promise<Described> {
    const rpc = rpcFor(ctx);
    const ds: Described[] = [];
    for (const tx of txs) ds.push(await describeTx(tx, { networkId: ctx.network.id, publicKey: myKey(ctx), host, rpc }));
    if (ds.length === 1) return ds[0]!;
    const sum = new Map<string, { asset: AssetRef; delta: bigint }>();
    for (const c of ds.flatMap((d) => d.balanceChanges)) {
      const k = c.asset.address ?? c.asset.key;
      const e = sum.get(k) ?? { asset: c.asset, delta: 0n };
      e.delta += BigInt(c.delta);
      sum.set(k, e);
    }
    const warnings: Warning[] = [];
    for (const w of ds.flatMap((d) => d.warnings)) if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w);
    return {
      title: `Approve ${ds.length} transactions`,
      lines: ds.flatMap((d, i) => [{ label: `Transaction ${i + 1}`, value: d.title }, ...d.lines]),
      balanceChanges: [...sum.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() })),
      warnings,
      blind: ds.some((d) => d.blind),
      gas: ds.reduce((a, d) => a + d.gas, 0n),
    };
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = norm(request, ctx);
    const base = { requestId: request.id, networkId: request.networkId };
    const host = request.origin === "clip-wallet" ? "Clip Wallet" : hostOf(request.origin);
    const me = ctx.account.address;
    const pk = myKey(ctx);

    if (n.kind === "message") {
      const rpc = rpcFor(ctx);
      if (n.accountId !== me) {
        const ak = await accessKey(rpc, n.accountId, pk, me);
        if (ak.permission !== "FullAccess") throw new ClipError("Messages can only be signed with a full-access key, and this wallet's key for that account isn't one.", "near/limited-key");
      }
      const { recipient, message, nonce, callbackUrl } = n.params;
      const warnings: Warning[] = [];
      const matches = recipientMatches(recipient, host);
      if (!matches) {
        warnings.push(
          looksLikeAccountId(recipient)
            ? { level: "caution", code: "domain-mismatch", message: `This message is addressed to the NEAR account ${recipient}, not to ${host}. Only sign if you expect ${host} to use it there.` }
            : { level: "danger", code: "domain-mismatch", message: `This message is for ${recipient}, but the request comes from ${host}. It may be a phishing site.` },
        );
      }
      const lines = [
        { label: "Message", value: message },
        { label: "For", value: recipient },
        { label: "Account", value: n.accountId },
        { label: "Nonce", value: b64encode(nonce) },
      ];
      if (callbackUrl) lines.push({ label: "Returns to", value: callbackUrl });
      return { ...base, title: matches ? `Sign in to ${recipient}` : `Sign a message for ${host}`, lines, balanceChanges: [], simulated: false, blind: false, warnings };
    }

    const rpc = rpcFor(ctx);
    const txs: TxSpec[] = n.kind === "build" ? n.txs : n.txs.map((t) => t.tx);
    for (const tx of txs) await checkKey(rpc, tx, pk, me);
    const d = await combine(txs, ctx, host);
    const lines = [...d.lines];
    const warnings = [...d.warnings];
    const signers = [...new Set(txs.map((t) => t.signerId))];
    if (signers.some((s) => s !== me)) lines.unshift({ label: "From account", value: signers.join(", ") });
    // A transfer to a named account that doesn't exist fails on chain (the NEAR comes back, the fee doesn't).
    for (const tx of txs) {
      if (!tx.actions.some((a) => a.kind === "Transfer") || isImplicit(tx.receiverId)) continue;
      if (!(await accountExists(rpc, tx.receiverId))) {
        warnings.push({ level: "caution", code: "new-recipient", message: `There's no NEAR account called ${tx.receiverId}. This transfer will fail and only the fee will be spent.` });
      }
    }
    const NEAR = nearAsset(ctx.network.id);
    let fee: DecodedRequest["fee"];
    try {
      const price = await rpc.gasPrice();
      const amount = d.gas * price;
      fee = { asset: NEAR, amount: amount.toString() };
      const hasCalls = txs.some((t) => t.actions.some((a) => a.kind === "FunctionCall"));
      lines.push({ label: "Network fee", value: `${hasCalls ? "up to" : "about"} ${near(amount)}${hasCalls ? " (unused gas is refunded)" : ""}` });
    } catch {
      lines.push({ label: "Network fee", value: "A small amount of NEAR" });
    }
    if (n.kind === "signed") lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });
    const out: DecodedRequest = { ...base, title: d.title, lines, balanceChanges: d.balanceChanges, simulated: false, blind: d.blind, warnings };
    if (fee) out.fee = fee;
    return out;
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const n = norm(request, ctx);
    const me = ctx.account.address;
    const pk = myKey(ctx);
    const payload = (bytes: Uint8Array): SignablePayload => ({ accountId: ctx.account.id, scheme: "ed25519", bytes, approvalId });

    if (n.kind === "message") {
      if (n.accountId !== me) {
        const ak = await accessKey(rpcFor(ctx), n.accountId, pk, me);
        if (ak.permission !== "FullAccess") throw new ClipError("Messages can only be signed with a full-access key, and this wallet's key for that account isn't one.", "near/limited-key");
      }
      return [payload(nep413Hash(n.params))];
    }
    if (n.kind === "signed") return n.txs.map((t) => payload(sha256(t.bytes)));

    for (const tx of n.txs) {
      if (tx.actions.some((a) => a.kind === "Unknown")) {
        throw new ClipError("This transaction has an action Clip Wallet can't build yet.", "near/unsupported-action");
      }
    }
    const rpc = rpcFor(ctx);
    const nonces = new Map<string, bigint>();
    const built: Uint8Array[] = [];
    let blockHash: Uint8Array;
    try {
      blockHash = base58Decode(await rpc.finalBlockHash());
    } catch (e) {
      throw netError(e);
    }
    for (const tx of n.txs) {
      let nonce = nonces.get(tx.signerId);
      if (nonce === undefined) nonce = await checkKey(rpc, tx, pk, me);
      else {
        const why = keyAllows((await accessKey(rpc, tx.signerId, pk, me)).permission, tx);
        if (why) throw new ClipError(why, "near/limited-key");
      }
      nonce += 1n;
      nonces.set(tx.signerId, nonce);
      built.push(encodeTransaction({ signerId: tx.signerId, publicKey: pk, nonce, receiverId: tx.receiverId, blockHash, actions: tx.actions }));
    }
    const hashes = built.map((b) => sha256(b));
    prepared.set(request.id, { approvalId, txBytes: built, hashes });
    return hashes.map(payload);
  }

  function verify(signatures: Signature[], messages: Uint8Array[], pk: PublicKey): Uint8Array[] {
    if (signatures.length !== messages.length) throw new ClipError("Some signatures are missing. Nothing was sent.", "near/bad-signature");
    return messages.map((m, i) => {
      const sig = signatures[i]!;
      if (sig.scheme !== "ed25519" || sig.bytes.length !== 64 || !ed25519.verify(sig.bytes, m, pk.data)) {
        throw new ClipError("The signature didn't match. Nothing was sent.", "near/bad-signature");
      }
      return sig.bytes;
    });
  }

  async function send(rpc: NearRpc, signed: Uint8Array): Promise<Record<string, unknown>> {
    try {
      return await rpc.call<Record<string, unknown>>("send_tx", { signed_tx_base64: b64encode(signed), wait_until: "EXECUTED_OPTIMISTIC" });
    } catch (e) {
      if (e instanceof RpcError) throw new ClipError(plainNearError(`${e.name} ${e.message} ${JSON.stringify(e.data ?? "")}`), "near/send-failed", e);
      throw netError(e);
    }
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = norm(request, ctx);
    const pk = myKey(ctx);

    if (n.kind === "message") {
      const [sig] = verify(signatures, [nep413Hash(n.params)], pk);
      const out: Record<string, string> = { accountId: n.accountId, publicKey: publicKeyToString(pk), signature: b64encode(sig!) };
      if (n.state !== undefined) out.state = n.state;
      return out;
    }
    if (n.kind === "signed") {
      const sigs = verify(signatures, n.txs.map((t) => sha256(t.bytes)), pk);
      const out = n.txs.map((t, i) => shapeBytes(encodeSignedTransaction(t.bytes, sigs[i]!), n.shapes[i]!));
      return n.many ? out : out[0];
    }

    const p = prepared.get(request.id);
    if (!p) throw new ClipError("This request wasn't prepared for signing (or was already sent). Nothing was sent. Try again.", "near/not-prepared");
    const sigs = verify(signatures, p.hashes, pk);
    prepared.delete(request.id);
    const rpc = rpcFor(ctx);
    const outcomes: Record<string, unknown>[] = [];
    for (let i = 0; i < p.txBytes.length; i++) {
      const outcome = await send(rpc, encodeSignedTransaction(p.txBytes[i]!, sigs[i]!));
      outcomes.push(outcome);
      const status = outcome.status as Record<string, unknown> | undefined;
      if (status && isObj(status) && "Failure" in status) {
        // The wallet's own requests get plain words; dapps get the outcome (like other NEAR wallets) and the rest
        // of a batch is not sent.
        if (request.origin === "clip-wallet") throw new ClipError(plainNearError(JSON.stringify(status.Failure)), "near/tx-failed", outcome);
        break;
      }
    }
    if (n.result === "void") return null;
    return n.result === "one" ? outcomes[0] : outcomes;
  }

  async function getNearBalance(ctx: ChainContext): Promise<{ total: bigint; storageReserved: bigint; available: bigint; staked: bigint }> {
    const rpc = rpcFor(ctx);
    try {
      const v = await rpc.viewAccount(ctx.account.address);
      const total = BigInt(v.amount);
      return { total, ...spendable(total, v.storage_usage), staked: BigInt(v.locked) };
    } catch (e) {
      if (e instanceof RpcError && e.name === "UNKNOWN_ACCOUNT") return { total: 0n, storageReserved: 0n, available: 0n, staked: 0n };
      throw netError(e);
    }
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const rpc = rpcFor(ctx);
    const me = ctx.account.address;
    const nearBal = await getNearBalance(ctx);
    const out: TokenBalance[] = [{ asset: nearAsset(ctx.network.id), amount: nearBal.available.toString() }];
    let tokens: { contract_id: string; balance?: string | null }[] = [];
    try {
      tokens = (await fastnearJson<{ tokens?: typeof tokens }>(ctx.fetch, `${fastnearUrl(ctx.network)}/v1/account/${encodeURIComponent(me)}/ft`)).tokens ?? [];
    } catch {
      tokens = [];
    }
    for (const t of tokens) {
      if (typeof t.contract_id !== "string" || !t.balance || !/^\d+$/.test(t.balance) || BigInt(t.balance) === 0n) continue;
      const meta = await ftMetadata(rpc, t.contract_id);
      if (!meta) continue;
      out.push({ asset: assetFor(ctx.network.id, t.contract_id, meta), amount: BigInt(t.balance).toString() });
    }
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const me = ctx.account.address;
    let contracts: string[] = [];
    try {
      const r = await fastnearJson<{ tokens?: { contract_id: string }[] }>(ctx.fetch, `${fastnearUrl(ctx.network)}/v1/account/${encodeURIComponent(me)}/nft`);
      contracts = [...new Set((r.tokens ?? []).map((t) => t.contract_id).filter((c) => typeof c === "string" && isAccountId(c)))];
    } catch {
      return [];
    }
    return nftsFor(rpcFor(ctx), ctx.network, me, contracts, gateway);
  }

  /** The implicit account plus named accounts that hold this key as a full-access key (FastNEAR /v0/public_key). */
  async function listAccountIds(ctx: ChainContext): Promise<string[]> {
    const implicit = addressFromPublicKey(fromHex(ctx.account.publicKey));
    const ids = [implicit];
    try {
      const r = await fastnearJson<{ account_ids?: string[] }>(ctx.fetch, `${fastnearUrl(ctx.network)}/v0/public_key/${publicKeyToString(myKey(ctx))}`);
      for (const id of r.account_ids ?? []) if (typeof id === "string" && isAccountId(id) && !ids.includes(id)) ids.push(id);
    } catch {
      // Named accounts are a nicety; the implicit account always works.
    }
    return ids;
  }

  function request(ctx: ChainContext, receiverId: string, actions: NearActionJson[], signerId = ctx.account.address): DappRequest {
    return {
      id: randomId(),
      origin: "clip-wallet",
      via: "injected",
      family: "near",
      networkId: ctx.network.id,
      method: NEAR_METHODS.signAndSendTransaction,
      params: { signerId, receiverId, actions },
    };
  }

  function checkAmount(amount: string): bigint {
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "near/bad-amount");
    return BigInt(amount);
  }

  function checkRecipient(to: string, ctx: ChainContext): void {
    if (!isAddress(to)) throw new ClipError("That doesn't look like a NEAR account.", "near/bad-address");
    const net = networkName(ctx.network.id);
    if (net === "mainnet" && to.endsWith(".testnet")) throw new ClipError("That's a NEAR testnet account. It can't receive real NEAR.", "near/wrong-network");
    if (net === "testnet" && to.endsWith(".near")) throw new ClipError("That's a NEAR mainnet account name. On testnet, use a .testnet account.", "near/wrong-network");
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string; signerId?: string }, ctx: ChainContext): Promise<DappRequest> {
    const to = p.to.trim().toLowerCase();
    const from = p.signerId ?? ctx.account.address;
    checkRecipient(to, ctx);
    if (to === from) throw new ClipError("That's your own account.", "near/self-transfer");
    const amount = checkAmount(p.amount);
    const rpc = rpcFor(ctx);
    if (!isImplicit(to) && !(await accountExists(rpc, to))) throw new ClipError(`There's no NEAR account called ${to}. Check the name.`, "near/account-not-found");

    if (!p.asset.address) {
      const bal = await getNearBalance({ ...ctx, account: { ...ctx.account, address: from } });
      if (bal.available < amount) throw new ClipError("You don't have enough NEAR for this.", "near/insufficient-funds");
      return request(ctx, to, [{ type: "Transfer", params: { deposit: amount.toString() } }], from);
    }

    const contract = p.asset.address;
    const meta = await ftMetadata(rpc, contract);
    if (!meta) throw new ClipError("That token couldn't be found on NEAR.", "near/unknown-token");
    let mine: bigint;
    let registered: unknown;
    try {
      mine = BigInt(await rpc.view<string>(contract, "ft_balance_of", { account_id: from }));
    } catch (e) {
      throw netError(e);
    }
    if (mine < amount) throw new ClipError(`You don't have enough ${meta.symbol}.`, "near/insufficient-token");
    try {
      registered = await rpc.view<unknown>(contract, "storage_balance_of", { account_id: to });
    } catch (e) {
      throw netError(e);
    }
    const actions: NearActionJson[] = [];
    if (registered === null) {
      // NEP-145: the recipient isn't registered with the token yet; pay the minimum storage deposit for them.
      let min: bigint;
      try {
        const bounds = await rpc.view<{ min: string }>(contract, "storage_balance_bounds", {});
        min = BigInt(bounds.min);
      } catch (e) {
        throw netError(e);
      }
      actions.push({
        type: "FunctionCall",
        params: { methodName: "storage_deposit", args: { account_id: to, registration_only: true }, gas: FT_GAS.toString(), deposit: min.toString() },
      });
    }
    actions.push({
      type: "FunctionCall",
      params: { methodName: "ft_transfer", args: { receiver_id: to, amount: amount.toString() }, gas: FT_GAS.toString(), deposit: "1" },
    });
    return request(ctx, contract, actions, from);
  }

  const staking = {
    async getPositions(ctx: ChainContext): Promise<StakePosition[]> {
      const me = ctx.account.address;
      const pools = new Set(options.stakingPools?.[ctx.network.id] ?? []);
      try {
        const r = await fastnearJson<{ pools?: { pool_id: string }[] }>(ctx.fetch, `${fastnearUrl(ctx.network)}/v1/account/${encodeURIComponent(me)}/staking`);
        for (const p of r.pools ?? []) if (typeof p.pool_id === "string" && isAccountId(p.pool_id)) pools.add(p.pool_id);
      } catch {
        // fall back to the configured pools
      }
      const rpc = rpcFor(ctx);
      const out: StakePosition[] = [];
      for (const pool of pools) {
        let acct: { staked_balance: string; unstaked_balance: string; can_withdraw: boolean };
        try {
          acct = await rpc.view(pool, "get_account", { account_id: me });
        } catch {
          continue;
        }
        const staked = BigInt(acct.staked_balance ?? "0");
        const unstaked = BigInt(acct.unstaked_balance ?? "0");
        // Pools leave a few yocto of rounding dust in unstaked balances.
        const dust = 1000n;
        if (staked === 0n && unstaked <= dust) continue;
        const pos: StakePosition = { validator: pool, validatorName: poolName(pool), asset: nearAsset(ctx.network.id), staked: staked.toString() };
        if (unstaked > dust) {
          if (acct.can_withdraw) pos.withdrawable = unstaked.toString();
          else pos.unstaking = unstaked.toString();
        }
        out.push(pos);
      }
      return out;
    },
    async buildStake(p: { validator: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
      checkValidator(p.validator, ctx);
      const amount = checkAmount(p.amount);
      const bal = await getNearBalance(ctx);
      if (bal.available < amount) throw new ClipError("You don't have enough NEAR to stake that much (keep a little for fees).", "near/insufficient-funds");
      return request(ctx, p.validator, [{ type: "FunctionCall", params: { methodName: "deposit_and_stake", args: {}, gas: STAKING_GAS.toString(), deposit: amount.toString() } }]);
    },
    async buildUnstake(p: { validator: string; amount?: string }, ctx: ChainContext): Promise<DappRequest> {
      checkValidator(p.validator, ctx);
      if (p.amount === undefined) return request(ctx, p.validator, [{ type: "FunctionCall", params: { methodName: "unstake_all", args: {}, gas: STAKING_GAS.toString(), deposit: "0" } }]);
      const amount = checkAmount(p.amount);
      return request(ctx, p.validator, [{ type: "FunctionCall", params: { methodName: "unstake", args: { amount: amount.toString() }, gas: STAKING_GAS.toString(), deposit: "0" } }]);
    },
    async buildWithdraw(p: { validator: string; amount?: string }, ctx: ChainContext): Promise<DappRequest> {
      checkValidator(p.validator, ctx);
      if (p.amount === undefined) return request(ctx, p.validator, [{ type: "FunctionCall", params: { methodName: "withdraw_all", args: {}, gas: STAKING_GAS.toString(), deposit: "0" } }]);
      const amount = checkAmount(p.amount);
      return request(ctx, p.validator, [{ type: "FunctionCall", params: { methodName: "withdraw", args: { amount: amount.toString() }, gas: STAKING_GAS.toString(), deposit: "0" } }]);
    },
  };

  function checkValidator(v: string, ctx: ChainContext) {
    if (!isAccountId(v) || isImplicit(v)) throw new ClipError("That isn't a NEAR staking pool.", "near/bad-validator");
    const configured = options.stakingPools?.[ctx.network.id] ?? [];
    if (!isPool(ctx.network.id, v) && !configured.includes(v)) throw new ClipError("That isn't a NEAR staking pool Clip Wallet knows.", "near/bad-validator");
  }

  const module: NearModule = {
    family: "near",
    curve: "ed25519",
    /** m/44'/397'/i' (SLIP-10, all hardened): near-seed-phrase KEY_DERIVATION_PATH, used by MyNearWallet / Meteor / near-cli. */
    derivationPath: (index: number) => `m/44'/397'/${index}'`,
    addressFromPublicKey,
    isAddress,
    networksForAddress(value: string, candidates: Network[]): Network[] {
      const v = value.trim();
      if (!isAddress(v)) return [];
      const near = candidates.filter((c) => c.family === "near");
      if (v.endsWith(".near")) return near.filter((c) => networkName(c.id) === "mainnet");
      if (v.endsWith(".testnet")) return near.filter((c) => networkName(c.id) === "testnet");
      return near;
    },
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
    listAccountIds,
    getNearBalance,
    staking,
  };
  return module;
}

/** Implicit account id: lowercase hex of the 32-byte ed25519 public key. */
export function addressFromPublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  let s = "";
  for (const b of publicKey) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * Named accounts (alice.near), implicit accounts (64 lowercase hex) and ETH-implicit accounts (NEP-518, 0x + 40
 * lowercase hex). All three can receive NEAR; this wallet's own accounts are ed25519 implicit or named.
 */
export function isAddress(value: string): boolean {
  const v = value.trim();
  return isImplicit(v) || isAccountId(v);
}
