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
import { hash, transaction } from "starknet";
import { ARGENT_ACCOUNT_CLASS_HASH, type AccountClass, type AccountKind, DEFAULT_ACCOUNT_CLASS, deploymentData, isDeployed, isStarknetAddress, starkKeyX, verifyStark, type DeploymentData } from "./account.js";
import {
  type FeeEstimate,
  type SimResult,
  type StarkCall,
  balanceChangesFromSim,
  checkTypedDataChain,
  describeCalls,
  describeTypedData,
  normalizeCalls,
  normalizeTypedData,
  plainRevert,
  typedDataHash,
} from "./describe.js";
import { STRK_ADDRESS, strkAsset, walletChainId } from "./networks.js";
import { RpcError, StarknetRpc, plainStarknetError } from "./rpc.js";
import { curatedToken, curatedTokens, curatedAsset, tokenAsset } from "./tokens.js";
import { bytesToBigInt, feltToBytes32, formatUnits, fromHex, hostOf, padAddress, randomId, sleep, toHexFelt } from "./util.js";

/**
 * Methods. Injected (get-starknet / Starknet wallet API, `request({ type, params })`) and WalletConnect
 * (Reown "Starknet RPC" reference). Connect / chain / permission methods are answered by 1Mask itself.
 */
export const STARKNET_METHODS = {
  addInvokeTransaction: "wallet_addInvokeTransaction",
  signTypedData: "wallet_signTypedData",
  addDeclareTransaction: "wallet_addDeclareTransaction",
  wcAddInvokeTransaction: "starknet_requestAddInvokeTransaction",
  wcSignTypedData: "starknet_signTypedData",
} as const;

/** Query-only transaction version: estimates and simulations can never be replayed as real transactions. */
const QUERY_V3 = "0x100000000000000000000000000000003";

export interface StarknetModuleOptions {
  /**
   * Account contract (default "openzeppelin", the vault's default address). "argent" = Argent X 0.4.0 accounts.
   * `accountClassHash` overrides the class for the chosen kind (same constructor shape).
   */
  account?: AccountKind;
  accountClassHash?: string;
  /** Run starknet_simulateTransactions in decode() for balance changes (default true). */
  simulate?: boolean;
  /** Safety margin on estimated gas amounts and prices, in percent (default 50). */
  feeMarginPercent?: number;
  /**
   * NFT source. There is no public, keyless Starknet NFT indexer (NFTScan and Voyager need API keys), so the
   * default lists none. Plug an indexer in here.
   */
  nfts?: (owner: string, network: Network, f: typeof fetch) => Promise<Nft[]>;
  /** How long finalize() waits for a first-use DEPLOY_ACCOUNT to be received before sending the invoke (ms). */
  deployWaitMs?: number;
  pollMs?: number;
}

type ResourceBounds = { l1_gas: Bound; l1_data_gas: Bound; l2_gas: Bound };
type Bound = { max_amount: bigint; max_price_per_unit: bigint };

interface PreparedTx {
  kind: "deploy" | "invoke";
  hash: bigint;
  body: Record<string, unknown>;
}
type Prepared = { kind: "tx"; txs: PreparedTx[] } | { kind: "typed"; hash: bigint };

type Normalized = { kind: "invoke"; calls: StarkCall[]; wc: boolean } | { kind: "typed"; data: ReturnType<typeof normalizeTypedData>; wc: boolean };

function normalize(request: DappRequest, me: string): Normalized {
  const p = (request.params ?? {}) as { accountAddress?: unknown };
  const checkAccount = () => {
    if (p.accountAddress !== undefined && (typeof p.accountAddress !== "string" || !isStarknetAddress(p.accountAddress) || BigInt(p.accountAddress) !== BigInt(me))) {
      throw new ClipError("This request is for a different account than the one you connected.", "starknet/wrong-account");
    }
  };
  switch (request.method) {
    case STARKNET_METHODS.addInvokeTransaction:
      return { kind: "invoke", calls: normalizeCalls(request.params), wc: false };
    case STARKNET_METHODS.wcAddInvokeTransaction:
      checkAccount();
      return { kind: "invoke", calls: normalizeCalls(request.params), wc: true };
    case STARKNET_METHODS.signTypedData:
      return { kind: "typed", data: normalizeTypedData(request.params), wc: false };
    case STARKNET_METHODS.wcSignTypedData:
      checkAccount();
      return { kind: "typed", data: normalizeTypedData(request.params), wc: true };
    case STARKNET_METHODS.addDeclareTransaction:
      throw new ClipError("Clip Wallet doesn't publish new contracts. Use a developer tool for that.", "starknet/unsupported-method");
    default:
      throw new ClipError("Clip Wallet doesn't support this Starknet request yet.", "starknet/unsupported-method");
  }
}

const big = (v: string | number | bigint | undefined) => (v === undefined ? 0n : BigInt(v));

function bounds(fee: FeeEstimate, marginPct: number): ResourceBounds {
  const m = (v: bigint) => (v * BigInt(100 + marginPct)) / 100n + (v > 0n ? 1n : 0n);
  return {
    l1_gas: { max_amount: m(big(fee.l1_gas_consumed)), max_price_per_unit: m(big(fee.l1_gas_price)) },
    l1_data_gas: { max_amount: m(big(fee.l1_data_gas_consumed)), max_price_per_unit: m(big(fee.l1_data_gas_price)) },
    l2_gas: { max_amount: m(big(fee.l2_gas_consumed)), max_price_per_unit: m(big(fee.l2_gas_price)) },
  };
}

/** The most a transaction with these bounds can be charged (fri). */
const boundsCost = (b: ResourceBounds): bigint =>
  b.l1_gas.max_amount * b.l1_gas.max_price_per_unit + b.l1_data_gas.max_amount * b.l1_data_gas.max_price_per_unit + b.l2_gas.max_amount * b.l2_gas.max_price_per_unit;

const zeroBounds: ResourceBounds = {
  l1_gas: { max_amount: 0n, max_price_per_unit: 0n },
  l1_data_gas: { max_amount: 0n, max_price_per_unit: 0n },
  l2_gas: { max_amount: 0n, max_price_per_unit: 0n },
};

const boundsJson = (b: ResourceBounds) =>
  Object.fromEntries(
    (["l1_gas", "l1_data_gas", "l2_gas"] as const).map((k) => [k, { max_amount: toHexFelt(b[k].max_amount), max_price_per_unit: toHexFelt(b[k].max_price_per_unit) }]),
  );

function invokeBody(sender: string, calldata: string[], nonce: bigint, b: ResourceBounds, query: boolean): Record<string, unknown> {
  return {
    type: "INVOKE",
    sender_address: sender,
    calldata,
    version: query ? QUERY_V3 : "0x3",
    signature: [],
    nonce: toHexFelt(nonce),
    resource_bounds: boundsJson(b),
    tip: "0x0",
    paymaster_data: [],
    account_deployment_data: [],
    nonce_data_availability_mode: "L1",
    fee_data_availability_mode: "L1",
  };
}

function deployBody(d: DeploymentData, b: ResourceBounds, query: boolean): Record<string, unknown> {
  return {
    type: "DEPLOY_ACCOUNT",
    version: query ? QUERY_V3 : "0x3",
    signature: [],
    nonce: "0x0",
    contract_address_salt: d.salt,
    constructor_calldata: d.calldata,
    class_hash: d.class_hash,
    resource_bounds: boundsJson(b),
    tip: "0x0",
    paymaster_data: [],
    nonce_data_availability_mode: "L1",
    fee_data_availability_mode: "L1",
  };
}

export const executeCalldata = (calls: StarkCall[]): string[] =>
  transaction.getExecuteCalldata(calls.map((c) => ({ contractAddress: c.contractAddress, entrypoint: c.entrypoint, calldata: c.calldata })), "1").map((x) => toHexFelt(BigInt(x as string)));

export function createStarknetModule(options: StarknetModuleOptions = {}): ChainModule & {
  /** "active" once the account contract exists on this network; "not-deployed" before its first transaction. */
  accountStatus(ctx: ChainContext): Promise<"active" | "not-deployed">;
  /** wallet_deploymentData answer, or null once deployed. */
  deploymentDataFor(ctx: ChainContext): Promise<DeploymentData | null>;
} {
  const kind = options.account ?? "openzeppelin";
  const accountClass: AccountClass = {
    kind,
    classHash: options.accountClassHash ?? (kind === "argent" ? ARGENT_ACCOUNT_CLASS_HASH : DEFAULT_ACCOUNT_CLASS.classHash),
  };
  const margin = options.feeMarginPercent ?? 50;
  /** Fee estimates each approval screen was built on, by request id (audit STK-02). */
  const shownFees = new Map<string, { est: FeeEstimate[]; at: number }>();
  const SHOWN_FEE_TTL_MS = 15 * 60_000;
  const prepared = new Map<string, Prepared>();

  function rpcFor(ctx: ChainContext): StarknetRpc {
    return new StarknetRpc(ctx.network.rpcUrls, ctx.fetch);
  }

  function pubOf(ctx: ChainContext): Uint8Array {
    try {
      return fromHex(ctx.account.publicKey);
    } catch (cause) {
      throw new ClipError("This account's key can't be read.", "starknet/bad-account", cause);
    }
  }

  /** The account address comes from the public key; a different stored address means a different account class. */
  function me(ctx: ChainContext): { address: string; deploy: DeploymentData; pub: Uint8Array } {
    const pub = pubOf(ctx);
    const deploy = deploymentData(starkKeyX(pub), accountClass);
    const stored = ctx.account.address;
    if (stored && isStarknetAddress(stored) && BigInt(stored) !== BigInt(deploy.address)) {
      throw new ClipError("This Starknet account uses a different account type than Clip Wallet supports.", "starknet/account-mismatch");
    }
    return { address: deploy.address, deploy, pub };
  }

  async function nonceOf(rpc: StarknetRpc, address: string): Promise<bigint> {
    return BigInt(await rpc.call<string>("starknet_getNonce", ["pre_confirmed", address]));
  }

  /** Transactions to run, in order: DEPLOY_ACCOUNT first while the account isn't active. */
  async function plan(ctx: ChainContext, calls: StarkCall[]) {
    const rpc = rpcFor(ctx);
    const m = me(ctx);
    const deployed = await isDeployed(rpc, m.address);
    const nonce = deployed ? await nonceOf(rpc, m.address) : 1n;
    return { rpc, m, deployed, nonce, calldata: executeCalldata(calls) };
  }

  function queryTxs(p: Awaited<ReturnType<typeof plan>>) {
    const txs: Record<string, unknown>[] = [];
    if (!p.deployed) txs.push(deployBody(p.m.deploy, zeroBounds, true));
    txs.push(invokeBody(p.m.address, p.calldata, p.nonce, zeroBounds, true));
    return txs;
  }

  async function strkBalance(rpc: StarknetRpc, address: string): Promise<bigint> {
    const r = await rpc.call<string[]>("starknet_call", [
      { contract_address: STRK_ADDRESS, entry_point_selector: hash.getSelectorFromName("balanceOf"), calldata: [address] },
      "latest",
    ]);
    return big(r[0]) + big(r[1]) * 2n ** 128n;
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const { address } = me(ctx);
    const n = normalize(request, address);
    const host = hostOf(request.origin);
    const base = { requestId: request.id, networkId: request.networkId };

    if (n.kind === "typed") {
      checkTypedDataChain(n.data, ctx.network.id);
      typedDataHash(n.data, address); // refuses data that can't be hashed
      const d = describeTypedData(n.data, host);
      return { ...base, title: d.title, lines: d.lines, balanceChanges: [], simulated: false, blind: d.blind, warnings: d.warnings };
    }

    const p = await plan(ctx, n.calls);
    const d = await describeCalls(n.calls, { me: address, host, networkId: ctx.network.id, rpc: p.rpc });
    const warnings: Warning[] = [...d.warnings];
    const lines = [...d.lines];
    if (!p.deployed) {
      lines.push({ label: "Account", value: "Not active yet. This first transaction also activates it (one-time fee)." });
    }

    let fee: bigint | null = null;
    let balanceChanges = d.declared;
    let simulated = false;
    if (options.simulate ?? true) {
      try {
        const sims = await p.rpc.call<SimResult[]>("starknet_simulateTransactions", ["pre_confirmed", queryTxs(p), ["SKIP_VALIDATE", "SKIP_FEE_CHARGE"]]);
        fee = sims.reduce((a, s) => a + big(s.fee_estimation.overall_fee), 0n);
        const r = await balanceChangesFromSim(sims, { me: address, networkId: ctx.network.id, rpc: p.rpc });
        if (r.revert !== undefined) {
          warnings.push({ level: "danger", code: "simulation-failed", message: plainRevert(r.revert) });
        } else {
          balanceChanges = r.changes;
          simulated = true;
        }
      } catch (e) {
        if (e instanceof ClipError) throw e;
        warnings.push({ level: "caution", code: "simulation-failed", message: e instanceof RpcError ? plainRevert(`${e.message} ${JSON.stringify(e.data ?? "")}`) : "We couldn't preview this transaction." });
      }
    }
    // Audit STK-02: the fee estimate the screen shows is the one prepare() signs bounds from (no re-estimate after
    // approval), and the screen shows the most those bounds allow.
    let maxFee: bigint | null = null;
    try {
      const est = await p.rpc.call<FeeEstimate[]>("starknet_estimateFee", [queryTxs(p), ["SKIP_VALIDATE"], "pre_confirmed"]);
      fee ??= est.reduce((a, e) => a + big(e.overall_fee), 0n);
      maxFee = est.reduce((a, e) => a + boundsCost(bounds(e, margin)), 0n);
      for (const [k, v] of shownFees) if (Date.now() - v.at > SHOWN_FEE_TTL_MS) shownFees.delete(k);
      shownFees.set(request.id, { est, at: Date.now() });
    } catch {
      /* fee unknown; prepare() will refuse with a plain error if it really can't be paid */
    }
    if (fee !== null) {
      lines.push({ label: "Network fee", value: `${formatUnits(fee, 18)} STRK` });
      if (maxFee !== null) lines.push({ label: "Network fee at most", value: `${formatUnits(maxFee, 18)} STRK` });
      const strkOut = balanceChanges.filter((c) => c.asset.key === "strk").reduce((a, c) => a + BigInt(c.delta), 0n);
      try {
        if ((await strkBalance(p.rpc, address)) + strkOut < fee) {
          warnings.push({ level: "danger", code: "high-fee", message: "You don't have enough STRK to pay the network fee." });
        }
      } catch {
        /* balance unknown */
      }
    }
    const out: DecodedRequest = { ...base, title: d.title, lines, balanceChanges, simulated, blind: d.blind, warnings };
    if (fee !== null) out.fee = { asset: strkAsset(ctx.network.id), amount: fee.toString() };
    return out;
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const { address } = me(ctx);
    const n = normalize(request, address);
    const chainId = walletChainId(ctx.network.id);
    if (n.kind === "typed") {
      checkTypedDataChain(n.data, ctx.network.id);
      const h = typedDataHash(n.data, address);
      prepared.set(request.id, { kind: "typed", hash: h });
      return [{ accountId: ctx.account.id, scheme: "stark-ecdsa", bytes: feltToBytes32(h), approvalId }];
    }

    const p = await plan(ctx, n.calls);
    let est: FeeEstimate[];
    const shown = shownFees.get(request.id);
    try {
      est =
        shown && Date.now() - shown.at <= SHOWN_FEE_TTL_MS && shown.est.length === (p.deployed ? 1 : 2)
          ? shown.est
          : await p.rpc.call<FeeEstimate[]>("starknet_estimateFee", [queryTxs(p), ["SKIP_VALIDATE"], "pre_confirmed"]);
    } catch (e) {
      if (e instanceof ClipError) throw e;
      throw new ClipError(plainStarknetError(e), "starknet/estimate-failed", e);
    }
    const txs: PreparedTx[] = [];
    let i = 0;
    if (!p.deployed) {
      const b = bounds(est[i++]!, margin);
      const h = BigInt(
        hash.calculateDeployAccountTransactionHash({
          contractAddress: p.m.address,
          classHash: p.m.deploy.class_hash,
          compiledConstructorCalldata: p.m.deploy.calldata,
          salt: p.m.deploy.salt,
          version: "0x3",
          chainId: chainId as never,
          nonce: 0,
          nonceDataAvailabilityMode: 0,
          feeDataAvailabilityMode: 0,
          resourceBounds: b,
          tip: 0,
          paymasterData: [],
        }),
      );
      txs.push({ kind: "deploy", hash: h, body: deployBody(p.m.deploy, b, false) });
    }
    const b = bounds(est[i]!, margin);
    const h = BigInt(
      hash.calculateInvokeTransactionHash({
        senderAddress: p.m.address,
        version: "0x3",
        compiledCalldata: p.calldata,
        chainId: chainId as never,
        nonce: p.nonce,
        accountDeploymentData: [],
        nonceDataAvailabilityMode: 0,
        feeDataAvailabilityMode: 0,
        resourceBounds: b,
        tip: 0,
        paymasterData: [],
      }),
    );
    txs.push({ kind: "invoke", hash: h, body: invokeBody(p.m.address, p.calldata, p.nonce, b, false) });
    prepared.set(request.id, { kind: "tx", txs });
    return txs.map((t) => ({ accountId: ctx.account.id, scheme: "stark-ecdsa" as const, bytes: feltToBytes32(t.hash), approvalId }));
  }

  function rs(sig: Signature, msgHash: bigint, pub: Uint8Array): [string, string] {
    if (sig.scheme !== "stark-ecdsa" || sig.bytes.length !== 64) throw new ClipError("The signature didn't match. Nothing was sent.", "starknet/bad-signature");
    const r = bytesToBigInt(sig.bytes.subarray(0, 32));
    const s = bytesToBigInt(sig.bytes.subarray(32));
    if (!verifyStark(r, s, msgHash, pub)) throw new ClipError("The signature didn't match. Nothing was sent.", "starknet/bad-signature");
    return [toHexFelt(r), toHexFelt(s)];
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const { address, pub } = me(ctx);
    const n = normalize(request, address);
    const prep = prepared.get(request.id);
    if (!prep || prep.kind !== (n.kind === "typed" ? "typed" : "tx")) {
      throw new ClipError("This approval expired. Try again from the app.", "starknet/not-prepared");
    }
    if (prep.kind === "typed") {
      if (signatures.length !== 1) throw new ClipError("Some signatures are missing. Nothing was sent.", "starknet/bad-signature");
      const sig = rs(signatures[0]!, prep.hash, pub);
      prepared.delete(request.id);
      shownFees.delete(request.id);
      return n.wc ? { signature: sig } : sig;
    }
    if (signatures.length !== prep.txs.length) throw new ClipError("Some signatures are missing. Nothing was sent.", "starknet/bad-signature");
    const signed = prep.txs.map((t, i) => ({ ...t, body: { ...t.body, signature: rs(signatures[i]!, t.hash, pub) } }));
    prepared.delete(request.id);
    shownFees.delete(request.id);
    const rpc = rpcFor(ctx);
    let txHash = "";
    for (const t of signed) {
      try {
        if (t.kind === "deploy") {
          const r = await rpc.call<{ transaction_hash: string }>("starknet_addDeployAccountTransaction", [t.body]);
          await waitReceived(rpc, r.transaction_hash);
        } else {
          txHash = (await rpc.call<{ transaction_hash: string }>("starknet_addInvokeTransaction", [t.body])).transaction_hash;
        }
      } catch (e) {
        if (e instanceof ClipError) throw e;
        throw new ClipError(plainStarknetError(e), "starknet/send-failed", e);
      }
    }
    return { transaction_hash: padAddress(txHash) };
  }

  /** The first-use invoke (nonce 1) is only accepted once the node has the DEPLOY_ACCOUNT. */
  async function waitReceived(rpc: StarknetRpc, txHash: string): Promise<void> {
    const deadline = Date.now() + (options.deployWaitMs ?? 30_000);
    for (;;) {
      try {
        const s = await rpc.call<{ finality_status: string; execution_status?: string }>("starknet_getTransactionStatus", [txHash]);
        if (s.execution_status === "REVERTED") throw new ClipError("Activating your account failed. Nothing else was sent.", "starknet/deploy-reverted");
        if (s.finality_status && s.finality_status !== "RECEIVED") return;
        if (s.finality_status === "RECEIVED" && Date.now() >= deadline) return;
      } catch (e) {
        if (e instanceof ClipError) throw e;
      }
      if (Date.now() >= deadline) return;
      await sleep(options.pollMs ?? 1500);
    }
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const rpc = rpcFor(ctx);
    const { address } = me(ctx);
    const out: TokenBalance[] = [];
    for (const t of curatedTokens(ctx.network.id)) {
      let amount = 0n;
      try {
        const r = await rpc.call<string[]>("starknet_call", [
          { contract_address: t.address, entry_point_selector: hash.getSelectorFromName("balanceOf"), calldata: [address] },
          "latest",
        ]);
        amount = big(r[0]) + big(r[1]) * 2n ** 128n;
      } catch (e) {
        if (e instanceof ClipError) throw e;
        continue;
      }
      if (amount === 0n && t.key !== "strk") continue;
      out.push({ asset: curatedAsset(ctx.network.id, t), amount: amount.toString() });
    }
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    if (!options.nfts) return [];
    return options.nfts(me(ctx).address, ctx.network, ctx.fetch).catch(() => []);
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const rpc = rpcFor(ctx);
    const { address } = me(ctx);
    const to = p.to.trim();
    if (!isStarknetAddress(to)) throw new ClipError("That doesn't look like a Starknet address.", "starknet/bad-address");
    if (BigInt(to) === BigInt(address)) throw new ClipError("That's your own address.", "starknet/self-transfer");
    if (curatedToken(ctx.network.id, to)) {
      throw new ClipError("That's a token contract, not a wallet. Ask the recipient for their own address.", "starknet/token-recipient");
    }
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "starknet/bad-amount");
    const amount = BigInt(p.amount);
    const token = p.asset.address ?? STRK_ADDRESS;
    const asset = await tokenAsset(rpc, ctx.network.id, token);
    if (!asset) throw new ClipError("That token couldn't be found on Starknet.", "starknet/unknown-token");
    const r = await rpc.call<string[]>("starknet_call", [
      { contract_address: padAddress(token), entry_point_selector: hash.getSelectorFromName("balanceOf"), calldata: [address] },
      "latest",
    ]);
    if (big(r[0]) + big(r[1]) * 2n ** 128n < amount) throw new ClipError(`You don't have enough ${asset.symbol}.`, "starknet/insufficient-token");
    const low = amount % 2n ** 128n;
    const high = amount / 2n ** 128n;
    return {
      id: randomId(),
      origin: "clip-wallet",
      via: "injected",
      family: "starknet",
      networkId: ctx.network.id,
      method: STARKNET_METHODS.addInvokeTransaction,
      params: { calls: [{ contract_address: padAddress(token), entry_point: "transfer", calldata: [padAddress(to), toHexFelt(low), toHexFelt(high)] }] },
    };
  }

  return {
    family: "starknet",
    curve: "stark",
    /**
     * Argent X / Braavos convention: BIP-44 coin type 9004 (SLIP-44 "Starknet") on a secp256k1 BIP-32 node, then
     * EIP-2645 grinding to a Stark key. The vault owns derivation; this is the path it records.
     */
    derivationPath: (index: number) => `m/44'/9004'/0'/0/${index}`,
    addressFromPublicKey(publicKey: Uint8Array): string {
      return deploymentData(starkKeyX(publicKey), accountClass).address;
    },
    isAddress: (value: string) => isStarknetAddress(value),
    /** Same address on every Starknet network. */
    networksForAddress: (value: string, candidates: Network[]) => (isStarknetAddress(value) ? candidates.filter((c) => c.family === "starknet") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    async accountStatus(ctx) {
      return (await isDeployed(rpcFor(ctx), me(ctx).address)) ? "active" : "not-deployed";
    },
    async deploymentDataFor(ctx) {
      const m = me(ctx);
      return (await isDeployed(rpcFor(ctx), m.address)) ? null : m.deploy;
    },
  };
}

