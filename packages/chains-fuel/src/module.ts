import {
  type AssetRef,
  type ChainContext,
  type ChainModule,
  ClipError,
  type DappRequest,
  type DecodedRequest,
  type Msg,
  type Network,
  type Nft,
  type Signature,
  type SignablePayload,
  type TokenBalance,
  type Warning,
  WALLET_ORIGIN,
  isWalletOrigin,
  msg,
  say,
  titled,
} from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { fuelAddressFromPublicKey, isFuelAddress } from "./address.js";
import { amountText, analyze, describeFlows, readReceipts, sendLines, simulationFailed, transferTitle, type Analysis, type Simulated } from "./describe.js";
import { requiredMaxFee } from "./fee.js";
import { type ChainInfo, GqlError, type Spendable, gqlFor } from "./gql.js";
import { type FuelMessage, fuelMessageOf, hashMessage, messageBytes } from "./message.js";
import { FUEL_NETS, assetFor, ethAsset, fuelNetOf, specFor } from "./networks.js";
import {
  type Input,
  type Output,
  RETURN_ZERO_SCRIPT,
  type ScriptTx,
  TxParseError,
  ZERO32,
  encodeScriptTx,
  parseTransactionRequest,
  toTransactionRequestJson,
  transactionId,
} from "./tx.js";
import { fromHex, hex0x, hostOf, randomId, short, sleep, textOf } from "./util.js";

/**
 * Request methods (DappRequest.method). They mirror the Fuel connector standard's signing calls
 * (fuels-ts FuelConnector `sendTransaction(address, transaction, params)`, `signTransaction(…)`,
 * `signMessage(address, message)`), so 1Mask's Fuel connector hands them over unchanged:
 *
 *   fuel_sendTransaction  { address, transaction: TransactionRequest JSON (object or text), provider?: { url } } → tx id
 *   fuel_signTransaction  same params → the signed TransactionRequest JSON (as Fuel Wallet returns it)
 *   fuel_signMessage      { address, message: FuelMessage (message.ts) } → 0x signature (r ‖ s, recovery id in s's top bit)
 */
export const FUEL_METHODS = {
  sendTransaction: "fuel_sendTransaction",
  signTransaction: "fuel_signTransaction",
  signMessage: "fuel_signMessage",
} as const;

export interface FuelModuleOptions {
  /** Dry-run scripts that call contracts in decode() to show what they move (default true). */
  simulate?: boolean;
  /** Status polls after the status stream ends early (default 10) and the wait between them (default 1000 ms). */
  pollAttempts?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

type Normalized =
  | { kind: "tx"; tx: ScriptTx; send: boolean; chainId: number }
  | { kind: "other-tx"; type: number; send: boolean }
  | { kind: "message"; message: FuelMessage };

const MALFORMED = "This request from the app is malformed, so we stopped it.";
const WRONG_NETWORK = "This is for a different network, so Clip Wallet stopped it. Nothing was signed.";
const NOT_SIGNER = "This transaction doesn't need your signature.";
const BAD_SIG = "The signature didn't match. Nothing was sent.";
/** Above this the fee gets a caution, ten times it a danger (base units of ETH, 9 decimals: 0.001 ETH). */
const HIGH_FEE = 1_000_000n;
/** Script gas limit for the dry run that measures a transfer's gas (a "return 0" script uses about 64). */
const MEASURE_GAS = 100_000n;

const lower = (s: string) => s.trim().toLowerCase();

/** Validates and reads a request. Shared by decode, prepare and finalize, so all three see the same bytes. */
export function normalize(request: DappRequest, ctx: ChainContext): Normalized {
  const methods = Object.values(FUEL_METHODS) as string[];
  if (!methods.includes(request.method)) throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "fuel/unsupported-method");
  const spec = specFor(request.networkId);
  if (!spec || request.networkId !== ctx.network.id) throw new ClipError(WRONG_NETWORK, "fuel/network-mismatch");
  const p = request.params && typeof request.params === "object" && !Array.isArray(request.params) ? (request.params as Record<string, unknown>) : null;
  if (!p) throw new ClipError(MALFORMED, "fuel/malformed");
  if (p.address !== undefined) {
    if (typeof p.address !== "string" || !isFuelAddress(p.address)) throw new ClipError(MALFORMED, "fuel/malformed");
    if (lower(p.address) !== lower(ctx.account.address)) throw new ClipError("This request is for a different account than the one you connected.", "fuel/not-your-account");
  }
  // The dapp's provider URL (FuelConnectorSendTxParams.provider): refuse a known URL of another Fuel network.
  const url = p.provider && typeof p.provider === "object" ? (p.provider as { url?: unknown }).url : undefined;
  if (typeof url === "string") {
    const n = fuelNetOf(url);
    if (n && FUEL_NETS[n].id !== request.networkId) throw new ClipError(WRONG_NETWORK, "fuel/network-mismatch");
  }

  if (request.method === FUEL_METHODS.signMessage) {
    const m = fuelMessageOf(p.message);
    if (!m) throw new ClipError(MALFORMED, "fuel/malformed");
    return { kind: "message", message: m };
  }
  let parsed: ReturnType<typeof parseTransactionRequest>;
  try {
    parsed = parseTransactionRequest(p.transaction);
  } catch (e) {
    if (e instanceof TxParseError || e instanceof RangeError) throw new ClipError(MALFORMED, "fuel/malformed", e);
    throw e;
  }
  const send = request.method === FUEL_METHODS.sendTransaction;
  if (parsed.kind === "other") return { kind: "other-tx", type: parsed.type, send };
  try {
    encodeScriptTx(parsed.tx); // every field in range
  } catch (e) {
    throw new ClipError(MALFORMED, "fuel/malformed", e);
  }
  return { kind: "tx", tx: parsed.tx, send, chainId: spec.chainId };
}

function mine(tx: ScriptTx, ctx: ChainContext): Analysis {
  const a = analyze(tx, lower(ctx.account.address));
  if (!a.myWitnesses.size) throw new ClipError(NOT_SIGNER, "fuel/not-a-signer");
  for (const w of a.myWitnesses) if (w >= tx.witnesses.length) throw new ClipError(MALFORMED, "fuel/malformed");
  return a;
}

/** Plain words for a fuel-core error (submit / dry run). Never the raw node text. */
export function plainFuelError(raw: string): { message: string | Msg; code: string } {
  const r = raw.toLowerCase();
  if (/signature/.test(r)) return { message: BAD_SIG, code: "fuel/bad-signature" };
  if (/utxo|not found|already spent|spent|doesn't exist|does not exist|inputcoin/.test(r)) return { message: msg("bg.fuel.coinsSpent"), code: "fuel/coins-spent" };
  if (/max ?fee|maxfee|insufficientfee|gas price|fee amount/.test(r)) return { message: msg("bg.fuel.feeRose"), code: "fuel/fee-too-low" };
  if (/insufficient|not enough|cannot be met/.test(r)) return { message: msg("bg.err.notEnough", { symbol: "ETH" }), code: "fuel/insufficient-funds" };
  if (/expir/.test(r)) return { message: "This request expired. Please try again from the app.", code: "fuel/expired" };
  return { message: "The network rejected this. Nothing was sent.", code: "fuel/rejected" };
}

function gqlFailure(e: unknown, fallback: string): ClipError {
  if (e instanceof ClipError) return e;
  if (e instanceof GqlError && e.kind === "graphql") {
    const p = plainFuelError(e.message);
    return new ClipError(p.message, p.code, e);
  }
  return new ClipError("We couldn't reach the network. Check your connection and try again.", fallback, e);
}

/** r ‖ s with the recovery id in the top bit of s (fuels-ts Signer.sign), after checking it recovers to `pub`. */
export function fuelCompactSignature(sig: Signature, digest: Uint8Array, pub: Uint8Array): Uint8Array {
  if (sig.scheme !== "ecdsa-secp256k1" || sig.bytes.length !== 64) throw new ClipError(BAD_SIG, "fuel/bad-signature");
  if (!secp256k1.verify(sig.bytes, digest, pub, { prehash: false })) throw new ClipError(BAD_SIG, "fuel/bad-signature");
  const want = secp256k1.Point.fromBytes(pub);
  const candidates = sig.recovery === undefined ? [0, 1] : [sig.recovery];
  for (const rec of candidates) {
    if (rec !== 0 && rec !== 1) continue;
    let point;
    try {
      point = secp256k1.Signature.fromBytes(sig.bytes, "compact").addRecoveryBit(rec).recoverPublicKey(digest);
    } catch {
      continue;
    }
    if (!point.equals(want)) continue;
    const out = sig.bytes.slice();
    if (out[32]! & 0x80) throw new ClipError(BAD_SIG, "fuel/bad-signature"); // high-S can't carry the recovery bit
    out[32] = out[32]! | (rec << 7);
    return out;
  }
  throw new ClipError(BAD_SIG, "fuel/bad-signature");
}

function publicKeyOf(ctx: ChainContext): Uint8Array {
  const pub = fromHex(ctx.account.publicKey);
  if (lower(fuelAddressFromPublicKey(pub)) !== lower(ctx.account.address)) throw new ClipError("This request is for a different account than the one you're using.", "fuel/not-your-account");
  return pub;
}

export function createFuelModule(options: FuelModuleOptions = {}): ChainModule & {
  normalize: typeof normalize;
  digestOf(request: DappRequest, ctx: ChainContext): Uint8Array;
} {
  const wait = options.sleep ?? sleep;

  function digestOf(request: DappRequest, ctx: ChainContext): Uint8Array {
    const n = normalize(request, ctx);
    if (n.kind === "message") return hashMessage(n.message);
    if (n.kind === "other-tx") throw new ClipError("This transaction can't be read.", "fuel/unsupported-tx");
    mine(n.tx, ctx);
    return transactionId(n.tx, n.chainId);
  }

  async function decode(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const n = normalize(req, ctx);
    const host = hostOf(req.origin);
    const base = { requestId: req.id, networkId: req.networkId };
    const eth = ethAsset(ctx.network.id);

    if (n.kind === "message") {
      const bytes = messageBytes(n.message);
      const text = textOf(bytes);
      const lines = text !== null ? [{ label: "Message", value: text }] : [{ label: "Message (not text)", value: hex0x(bytes) }];
      // A plain string is hashed with no prefix, so only readable text is signed blind-free: text can't be the
      // preimage of a transaction id (that starts with the 8-byte chain id, whose first byte is 0x00).
      const raw = "text" in n.message;
      const warnings: Warning[] = text === null ? [{ level: "danger", code: "blind-signing", message: say("bg.warn.messageNotTextTrust") }] : [];
      return { ...base, ...titled(msg("bg.req.signMessage", { host })), lines, balanceChanges: [], simulated: false, blind: text === null && raw, warnings };
    }

    if (n.kind === "other-tx") {
      return {
        ...base,
        ...titled(msg("bg.req.approveTxFor", { host })),
        lines: [],
        balanceChanges: [],
        simulated: false,
        blind: true,
        warnings: [{ level: "danger", code: "blind-signing", message: say("bg.warn.cantReadTxTrust") }],
      };
    }

    const tx = n.tx;
    const a = mine(tx, ctx);
    const me = lower(ctx.account.address);
    const spec = specFor(ctx.network.id)!;
    const maxFee = tx.policies.maxFee;
    const warnings: Warning[] = [];
    let blind = false;
    let sim: Simulated | null = null;
    let simulated = false;

    if (a.predicates) {
      blind = true;
      warnings.push({ level: "danger", code: "blind-signing", message: say("bg.warn.partsUnexplained") });
    } else if (!a.plainScript) {
      if (options.simulate === false) {
        blind = true;
        warnings.push(simulationFailed());
      } else {
        const gql = gqlFor(ctx);
        // Gas price 0: the preview shouldn't fail because the price moved since the app set its max fee.
        const run = await gql.dryRun(hex0x(encodeScriptTx(tx)), false, 0n).catch(() => null);
        if (!run || run.status.type !== "DryRunSuccessStatus") {
          blind = true;
          warnings.push(simulationFailed());
        } else {
          sim = readReceipts(run.receipts, me);
          simulated = true;
          warnings.push({ level: "caution", code: "unknown-call", message: say("bg.warn.unknownPrograms") });
        }
      }
    }

    const flows = describeFlows(tx, a, sim, { networkId: ctx.network.id, me, baseAssetId: spec.baseAssetId, maxFee });
    warnings.push(...flows.warnings);

    const lines: { label: string; value: string }[] = [...sendLines(a, ctx.network.id)];
    const contracts = [...new Set([...a.contracts, ...(sim?.calls ?? [])])];
    for (const c of contracts) lines.push({ label: "Contract", value: c });
    if (tx.policies.expiration !== undefined) lines.push({ label: "Valid until", value: `block ${tx.policies.expiration}` });
    lines.push({ label: "Network fee at most", value: amountText(eth, maxFee) });
    if (!n.send) lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });

    if (maxFee > HIGH_FEE) {
      warnings.push({ level: maxFee > HIGH_FEE * 10n ? "danger" : "caution", code: "high-fee", message: say("bg.warn.highFee") });
    }

    let title: { title: string; titleMsg?: Msg };
    const t = transferTitle(a, ctx.network.id);
    if (blind) title = titled(msg("bg.req.approveTxFor", { host }));
    else if (contracts.length) title = titled(msg("bg.req.contractActionFor", { host }));
    else if (t) title = t;
    else if (a.toMe.size) {
      // A transfer to yourself: nothing leaves but the fee.
      const [assetId, amount] = [...a.toMe][0]!;
      title = titled(msg("bg.req.sendTo", { amount: amountText(assetFor(ctx.network.id, assetId), amount), to: short(ctx.account.address) }));
    } else title = titled(msg("bg.req.approveTxFor", { host }));
    if (isWalletOrigin(req.origin) && title.title.includes(host)) title = titled(msg("bg.req.approveTx"));

    return {
      ...base,
      ...title,
      lines,
      balanceChanges: blind ? [] : flows.balanceChanges,
      fee: { asset: eth, amount: maxFee.toString() },
      simulated,
      blind,
      warnings,
    };
  }

  async function prepare(req: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    return [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: digestOf(req, ctx), approvalId }];
  }

  async function confirm(ctx: ChainContext, txHex: string, id: string): Promise<void> {
    const gql = gqlFor(ctx);
    let status;
    try {
      status = await gql.submitAndAwait(txHex);
    } catch (e) {
      throw gqlFailure(e, "fuel/offline");
    }
    if (status.type === "FailureStatus") throw new ClipError(msg("bg.fuel.failedOnChain"), "fuel/failed");
    if (status.type === "SqueezedOutStatus") {
      const p = plainFuelError(status.reason);
      throw new ClipError(p.message, p.code);
    }
    if (status.type === "SuccessStatus") return;
    // Accepted, no final status yet: poll a little, then hand back the id (Activity follows it).
    for (let k = 0; k < (options.pollAttempts ?? 10); k++) {
      await wait(options.pollMs ?? 1000);
      const s = await gql.transactionStatus(id).catch(() => null);
      if (s?.type === "SuccessStatus") return;
      if (s?.type === "FailureStatus") throw new ClipError(msg("bg.fuel.failedOnChain"), "fuel/failed");
      if (s?.type === "SqueezedOutStatus") {
        const p = plainFuelError(s.reason ?? "");
        throw new ClipError(p.message, p.code);
      }
    }
  }

  async function finalize(req: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const n = normalize(req, ctx);
    if (signatures.length !== 1) throw new ClipError("Some signatures are missing. Nothing was sent.", "fuel/bad-signature");
    const digest = digestOf(req, ctx);
    const compact = fuelCompactSignature(signatures[0]!, digest, publicKeyOf(ctx));
    if (n.kind === "message") return hex0x(compact);
    if (n.kind !== "tx") throw new ClipError("This transaction can't be read.", "fuel/unsupported-tx");
    const a = mine(n.tx, ctx);
    const witnesses = n.tx.witnesses.slice();
    for (const w of a.myWitnesses) witnesses[w] = compact;
    const signed: ScriptTx = { ...n.tx, witnesses };
    if (!n.send) return toTransactionRequestJson(signed);
    const id = hex0x(transactionId(signed, n.chainId));
    await confirm(ctx, hex0x(encodeScriptTx(signed)), id);
    return id;
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const spec = specFor(ctx.network.id);
    if (!spec) return [];
    let list: { assetId: string; amount: string }[];
    try {
      list = await gqlFor(ctx).balances(lower(ctx.account.address));
    } catch (e) {
      throw gqlFailure(e, "fuel/offline");
    }
    const amounts = new Map(list.map((b) => [b.assetId.toLowerCase(), b.amount]));
    const out: TokenBalance[] = [{ asset: ethAsset(ctx.network.id), amount: amounts.get(spec.baseAssetId) ?? "0" }];
    // Curated tokens only: anything else anyone can mint and send (spam stays out).
    for (const t of spec.tokens) {
      const amt = amounts.get(t.assetId);
      if (amt && amt !== "0") out.push({ asset: assetFor(ctx.network.id, t.assetId), amount: amt });
    }
    return out;
  }

  async function getNfts(_ctx: ChainContext): Promise<Nft[]> {
    return [];
  }

  function inputsFrom(coins: Spendable[], me: string, baseAssetId: string): Input[] {
    return coins.map((c): Input => {
      if (c.type === "Coin") {
        const id = fromHex(c.utxoId);
        if (id.length !== 34) throw new ClipError("The network sent something unexpected. Try again.", "fuel/bad-response");
        return {
          type: 0,
          txId: hex0x(id.slice(0, 32)),
          outputIndex: (id[32]! << 8) | id[33]!,
          owner: me,
          amount: BigInt(c.amount),
          assetId: lower(c.assetId),
          txPointer: { blockHeight: 0, txIndex: 0 },
          witnessIndex: 0,
          predicateGasUsed: 0n,
          predicate: new Uint8Array(0),
          predicateData: new Uint8Array(0),
        };
      }
      if (lower(c.assetId ?? baseAssetId) !== baseAssetId) throw new ClipError("The network sent something unexpected. Try again.", "fuel/bad-response");
      return {
        type: 2,
        sender: lower(c.sender),
        recipient: me,
        amount: BigInt(c.amount),
        nonce: lower(c.nonce),
        witnessIndex: 0,
        predicateGasUsed: 0n,
        data: new Uint8Array(0),
        predicate: new Uint8Array(0),
        predicateData: new Uint8Array(0),
      };
    });
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const spec = specFor(ctx.network.id);
    if (!spec) throw new ClipError("That network isn't available in this wallet.", "fuel/network-mismatch");
    const me = lower(ctx.account.address);
    const toRaw = p.to.trim();
    if (!isFuelAddress(toRaw)) throw new ClipError("That address isn't valid. Check it and try again.", "fuel/bad-address");
    const to = lower(toRaw);
    if (to === me) throw new ClipError("That's your own address.", "fuel/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "fuel/bad-amount");
    const amount = BigInt(p.amount);
    const assetId = p.asset.address ? lower(p.asset.address) : spec.baseAssetId;
    if (!/^0x[0-9a-f]{64}$/.test(assetId)) throw new ClipError("That token couldn't be found.", "fuel/bad-asset");
    const isBase = assetId === spec.baseAssetId;
    const symbol = assetFor(ctx.network.id, assetId).symbol;

    const gql = gqlFor(ctx);
    let chain: ChainInfo;
    let gasPrice: bigint;
    try {
      [chain, gasPrice] = await Promise.all([gql.chainInfo(), gql.estimateGasPrice(10)]);
    } catch (e) {
      throw gqlFailure(e, "fuel/offline");
    }
    if (chain.chainId !== spec.chainId) throw new ClipError(WRONG_NETWORK, "fuel/network-mismatch");

    const outputs: Output[] = [{ type: 0, to, amount, assetId }, { type: 2, to: me, amount: 0n, assetId }];
    if (!isBase) outputs.push({ type: 2, to: me, amount: 0n, assetId: spec.baseAssetId });
    const make = (inputs: Input[], gasLimit: bigint, maxFee: bigint): ScriptTx => ({
      type: 0,
      scriptGasLimit: gasLimit,
      receiptsRoot: ZERO32,
      script: fromHex(RETURN_ZERO_SCRIPT),
      scriptData: new Uint8Array(0),
      policies: { maxFee },
      inputs,
      outputs,
      witnesses: [new Uint8Array(64)], // placeholder of the signature's size, so size-based gas is right
    });

    let feeBudget = 0n;
    let gasLimit = 0n;
    for (let round = 0; round < 4; round++) {
      const want = isBase ? [{ assetId, amount: amount + feeBudget + 1n }] : [{ assetId, amount }, { assetId: spec.baseAssetId, amount: feeBudget + 1n }];
      let coins: Spendable[];
      try {
        coins = (await gql.coinsToSpend(me, want)).flat();
      } catch (e) {
        if (e instanceof GqlError && e.kind === "graphql" && /insufficient|cannot be met|not enough/i.test(e.message)) {
          // fuel-core names the asset it couldn't cover ("… insufficient coins available for <asset id>").
          const lacksToken = !isBase && e.message.toLowerCase().includes(assetId.slice(2));
          throw new ClipError(lacksToken ? msg("bg.err.notEnough", { symbol }) : msg("bg.err.notEnoughForFee", { symbol: "ETH" }), "fuel/insufficient-funds", e);
        }
        throw gqlFailure(e, "fuel/offline");
      }
      if (coins.length > chain.maxInputs) throw new ClipError(msg("bg.fuel.tooManyCoins"), "fuel/too-many-inputs");
      const inputs = inputsFrom(coins, me, spec.baseAssetId);
      if (gasLimit === 0n) {
        // Gas the script uses, measured with a dry run (fuels-ts assembleTx does the same).
        let run;
        try {
          run = await gql.dryRun(hex0x(encodeScriptTx(make(inputs, MEASURE_GAS, 0n))), false, 0n);
        } catch (e) {
          throw gqlFailure(e, "fuel/offline");
        }
        const used = run.receipts.find((r) => r.receiptType === "SCRIPT_RESULT")?.gasUsed;
        if (run.status.type !== "DryRunSuccessStatus" || !used) throw new ClipError("The network rejected this. Nothing was sent.", "fuel/rejected");
        gasLimit = BigInt(used);
      }
      const draft = make(inputs, gasLimit, 0n);
      const maxFee = requiredMaxFee(draft, chain, gasPrice) + 1n;
      const baseIn = inputs.reduce((t, i) => (i.type === 2 || (i.type === 0 && i.assetId === spec.baseAssetId) ? t + i.amount : t), 0n);
      const needBase = (isBase ? amount : 0n) + maxFee;
      if (baseIn >= needBase) {
        const tx = make(inputs, gasLimit, maxFee);
        return {
          id: randomId(),
          origin: WALLET_ORIGIN,
          via: "injected",
          family: "fuel",
          networkId: ctx.network.id,
          method: FUEL_METHODS.sendTransaction,
          params: { address: ctx.account.address, transaction: toTransactionRequestJson(tx) },
        };
      }
      feeBudget = maxFee * 2n;
    }
    throw new ClipError(msg("bg.err.notEnoughForFee", { symbol: "ETH" }), "fuel/insufficient-funds");
  }

  return {
    family: "fuel",
    curve: "secp256k1",
    /** Fuel Wallet / fuels-ts WalletManager path (SLIP-44 coin 1179993420). */
    derivationPath: (index: number) => {
      if (!Number.isInteger(index) || index < 0 || index >= 2 ** 31) throw new Error("account index out of range");
      return `m/44'/1179993420'/${index}'/0/0`;
    },
    addressFromPublicKey: (publicKey: Uint8Array, _network: Network) => fuelAddressFromPublicKey(publicKey),
    isAddress: (value: string) => isFuelAddress(value),
    /** The same address is valid on every Fuel network. */
    networksForAddress: (value: string, candidates: Network[]) => (isFuelAddress(value) ? candidates.filter((c) => c.family === "fuel") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
    digestOf,
  };
}
