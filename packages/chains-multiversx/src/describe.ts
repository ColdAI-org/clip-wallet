import { type AssetRef, type BalanceChange, type Msg, type Warning, msg, say, titled } from "@clip-wallet/core";
import type { MultiversXClient, NetworkConfig } from "./api.js";
import { EGLD_DECIMALS, EGLD_MULTI_ID, type TokenInfo, egldAsset, esdtAsset, isEsdtIdentifier, specFor, tickerOf } from "./networks.js";
import { type Call, type Tx, parseCall } from "./tx.js";
import { bigFromBytes, decodeAddress, encodeAddress, formatUnits, isContractKey, isSystemContractKey, short, textOf } from "./util.js";

/**
 * Plain-language description of one MultiversX transaction. Built-in functions are parsed from the data field
 * ("ESDTTransfer@<token hex>@<amount hex>", …) as mx-chain-vm-common-go's builtInFunctions define them and
 * sdk-core's TokenTransfersDataBuilder writes them:
 * https://docs.multiversx.com/tokens/fungible-tokens#transfers and …/tokens/nft-tokens#transfers.
 */
export interface Described {
  title: string;
  titleMsg?: Msg;
  lines: { label: string; value: string; labelMsg?: Msg }[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
  /** Fee in base units (EGLD) if all the gas is used; refunds can make it lower. */
  fee: bigint;
}

export interface DescribeContext {
  networkId: string;
  me: string;
  host: string;
  config: NetworkConfig;
  client: MultiversXClient;
  token(identifier: string): Promise<TokenInfo | null>;
}

/** System smart contracts that aren't staking providers (mx-chain-go vm/address.go): staking, ESDT, governance, delegation manager, … */
const SYSTEM_NOT_PROVIDER = new Set([
  "000000000000000000010000000000000000000000000000000000000001ffff",
  "000000000000000000010000000000000000000000000000000000000002ffff",
  "000000000000000000010000000000000000000000000000000000000003ffff",
  "000000000000000000010000000000000000000000000000000000000004ffff",
  "000000000000000000010000000000000000000000000000000000000005ffff",
  "000000000000000000010000000000000000000000000000000000000006ffff",
  "000000000000000000010000000000000000000000000000000000000007ffff",
  "000000000000000000010000000000000000000000000000000000000008ffff",
  "000000000000000000010000000000000000000000000000000000000009ffff",
  "00000000000000000001000000000000000000000000000000000000000affff",
  "00000000000000000001000000000000000000000000000000000000000bffff",
]);

const DELEGATION_FNS = new Set(["delegate", "unDelegate", "claimRewards", "withdraw", "reDelegateRewards"]);

/** Moving the data costs minGasLimit + gasPerDataByte × bytes at the full price; gas beyond that at price × modifier (TransactionComputer.computeTransactionFee). */
export function maxFee(tx: Tx, c: NetworkConfig): bigint {
  const move = c.minGasLimit + BigInt(tx.data.length) * c.gasPerDataByte;
  if (tx.gasLimit <= move) return tx.gasLimit * tx.gasPrice;
  const scaled = BigInt(Math.round(c.gasPriceModifier * 1_000_000));
  return move * tx.gasPrice + ((tx.gasLimit - move) * tx.gasPrice * scaled) / 1_000_000n;
}

const keyHex = (k: Uint8Array) => Array.from(k, (b) => b.toString(16).padStart(2, "0")).join("");

interface Moved {
  asset: AssetRef;
  amount: bigint;
  /** NFT / SFT nonce (0 for fungible tokens and EGLD). */
  nonce: bigint;
  collection?: string;
}

export async function describeTransaction(tx: Tx, d: DescribeContext): Promise<Described> {
  const egld = egldAsset(d.networkId);
  const fee = maxFee(tx, d.config);
  const receiverKey = decodeAddress(tx.receiver)!;
  const toContract = isContractKey(receiverKey);
  const call = parseCall(tx.data);
  const out: Described = { title: "", lines: [], balanceChanges: [], warnings: [], blind: false, fee };
  const toSelf = tx.receiver === d.me;

  const tokenAsset = async (identifier: string): Promise<AssetRef> => {
    const info = (await d.token(identifier)) ?? { identifier };
    return esdtAsset(d.networkId, info);
  };
  const fmt = (m: Moved) => (m.nonce > 0n ? `${m.amount} × ${m.collection} #${m.nonce}` : `${formatUnits(m.amount, m.asset.decimals)} ${m.asset.symbol}`);
  const out_ = (m: Moved) => {
    if (m.amount > 0n && m.nonce === 0n) out.balanceChanges.push({ asset: m.asset, delta: (-m.amount).toString() });
  };
  const egldMoved = (amount: bigint): Moved => ({ asset: egld, amount, nonce: 0n });

  /** A token payment: the identifier must look like an ESDT and the asset must not be a look-alike. */
  const payment = async (id: Uint8Array, nonce: bigint, amount: bigint): Promise<Moved | null> => {
    const identifier = new TextDecoder().decode(id);
    if (identifier === EGLD_MULTI_ID && nonce === 0n) return egldMoved(amount);
    const collection = nonce > 0n ? identifier : undefined;
    if (!isEsdtIdentifier(identifier)) return null;
    const asset = await tokenAsset(identifier);
    if (asset.spam && /^(USDC|EGLD|USD)/i.test(asset.symbol)) {
      out.warnings.push({ level: "danger", code: "known-scam", message: `${asset.symbol} here isn't the real ${asset.symbol}: it's a look-alike token (${identifier}).` });
    }
    return { asset, amount, nonce, ...(collection ? { collection: tickerOf(collection) } : {}) };
  };

  const describeTransfers = async (moved: Moved[], dest: string, rest: Call | null) => {
    const amounts = moved.map(fmt).join(" + ");
    const destKey = decodeAddress(dest)!;
    if (rest) {
      contractCall(rest.fn, dest, amounts);
    } else if (moved.length === 1 && moved[0]!.nonce > 0n) {
      const m = moved[0]!;
      const values = { id: m.nonce.toString(), collection: m.collection!, to: short(dest) };
      Object.assign(out, m.amount === 1n ? titled(msg("bg.req.sendNftTo", values)) : titled(msg("bg.req.sendNftsTo", { count: m.amount.toString(), ...values })));
    } else {
      Object.assign(out, titled(msg(isContractKey(destKey) ? "bg.req.sendToContract" : "bg.req.sendTo", isContractKey(destKey) ? { amount: amounts, contract: short(dest) } : { amount: amounts, to: short(dest) })));
    }
    out.lines.push({ label: "To", value: dest });
    for (const m of moved) {
      if (m.asset.address) out.lines.push({ label: "Token", value: m.nonce > 0n ? `${m.asset.address} #${m.nonce}` : m.asset.address });
      out_(m);
    }
  };

  const contractCall = (fn: string, contract: string, sends: string | null) => {
    Object.assign(out, titled(msg("bg.req.approveFnOnContract", { fn, contract: short(contract) })));
    out.lines.push({ label: "Contract", value: contract }, { label: "Function", value: fn });
    if (sends) out.lines.push({ label: "Also sends", value: sends });
    out.warnings.push({ level: "caution", code: "unknown-call", message: "Clip Wallet can name this call but can't fully read it, so some of its effects may not be shown." });
  };

  if (!tx.data.length) {
    // Plain EGLD transfer.
    await describeTransfers([egldMoved(tx.value)], tx.receiver, null);
  } else if (call?.fn === "ESDTTransfer" && call.args.length >= 2 && tx.value === 0n) {
    const m = await payment(call.args[0]!, 0n, bigFromBytes(call.args[1]!));
    if (m) await describeTransfers([m], tx.receiver, rest(call, 2));
    else out.blind = true;
  } else if (call?.fn === "ESDTNFTTransfer" && call.args.length >= 4 && toSelf && tx.value === 0n && call.args[3]!.length === 32) {
    const m = await payment(call.args[0]!, bigFromBytes(call.args[1]!), bigFromBytes(call.args[2]!));
    if (m) await describeTransfers([m], encodeAddress(call.args[3]!), rest(call, 4));
    else out.blind = true;
  } else if (call?.fn === "MultiESDTNFTTransfer" && call.args.length >= 2 && toSelf && tx.value === 0n && call.args[0]!.length === 32) {
    const count = Number(bigFromBytes(call.args[1]!));
    const moved: Moved[] = [];
    if (count >= 1 && count <= 100 && call.args.length >= 2 + 3 * count) {
      for (let i = 0; i < count; i++) {
        const [id, nonce, amount] = call.args.slice(2 + 3 * i, 5 + 3 * i);
        const m = await payment(id!, bigFromBytes(nonce!), bigFromBytes(amount!));
        if (!m) break;
        moved.push(m);
      }
    }
    if (moved.length === count && count > 0) await describeTransfers(moved, encodeAddress(call.args[0]!), rest(call, 2 + 3 * count));
    else out.blind = true;
  } else if (call && DELEGATION_FNS.has(call.fn) && isSystemContractKey(receiverKey) && !SYSTEM_NOT_PROVIDER.has(keyHex(receiverKey))) {
    const validator = (await d.client.providerName(tx.receiver).catch(() => null)) ?? short(tx.receiver);
    out.lines.push({ label: "Validator", value: validator === short(tx.receiver) ? tx.receiver : `${validator} (${tx.receiver})` });
    const egldText = (v: bigint) => `${formatUnits(v, EGLD_DECIMALS)} EGLD`;
    if (call.fn === "delegate" && call.args.length === 0 && tx.value > 0n) {
      Object.assign(out, titled(msg("bg.req.stakeWith", { amount: egldText(tx.value), validator })));
    } else if (call.fn === "unDelegate" && call.args.length === 1 && tx.value === 0n) {
      Object.assign(out, titled(msg("bg.req.unstakeFrom", { amount: egldText(bigFromBytes(call.args[0]!)), validator })));
    } else if (call.fn === "claimRewards" && call.args.length === 0 && tx.value === 0n) {
      Object.assign(out, titled(msg("bg.multiversx.claimRewardsFrom", { validator })));
    } else if (call.fn === "withdraw" && call.args.length === 0 && tx.value === 0n) {
      Object.assign(out, titled(msg("bg.multiversx.withdrawFrom", { validator })));
    } else if (call.fn === "reDelegateRewards" && call.args.length === 0 && tx.value === 0n) {
      Object.assign(out, titled(msg("bg.multiversx.restakeRewardsWith", { validator })));
    } else {
      out.lines.length = 0;
      contractCall(call.fn, tx.receiver, tx.value > 0n ? egldText(tx.value) : null);
    }
    if (tx.value > 0n) out.balanceChanges.push({ asset: egld, delta: (-tx.value).toString() });
  } else if (call && toSelf && call.fn === "SetGuardian" && call.args.length >= 1 && call.args[0]!.length === 32) {
    const guardian = encodeAddress(call.args[0]!);
    Object.assign(out, titled(msg("bg.multiversx.setGuardianTitle", { guardian: short(guardian) })));
    out.lines.push({ label: say("bg.multiversx.labelGuardian"), value: guardian });
    const w = msg("bg.multiversx.setGuardianWarn", { guardian: short(guardian) });
    out.warnings.push({ level: "danger", code: "account-takeover", message: w.fallback, msg: w });
  } else if (call && toSelf && call.fn === "GuardAccount" && call.args.length === 0) {
    Object.assign(out, titled(msg("bg.multiversx.guardAccountTitle")));
    const w = msg("bg.multiversx.guardAccountWarn");
    out.warnings.push({ level: "danger", code: "account-takeover", message: w.fallback, msg: w });
  } else if (call && toSelf && call.fn === "UnGuardAccount" && call.args.length === 0) {
    Object.assign(out, titled(msg("bg.multiversx.unguardAccountTitle")));
  } else if (call && toContract && call.fn === "ChangeOwnerAddress" && call.args.length === 1 && call.args[0]!.length === 32) {
    const owner = encodeAddress(call.args[0]!);
    Object.assign(out, titled(msg("bg.multiversx.changeOwnerTitle", { contract: short(tx.receiver), owner: short(owner) })));
    out.lines.push({ label: "Contract", value: tx.receiver }, { label: "Owner", value: owner });
    const w = msg("bg.multiversx.changeOwnerWarn", { contract: short(tx.receiver), owner: short(owner) });
    out.warnings.push({ level: "danger", code: "account-takeover", message: w.fallback, msg: w });
  } else if (call && toContract) {
    contractCall(call.fn, tx.receiver, tx.value > 0n ? `${formatUnits(tx.value, EGLD_DECIMALS)} EGLD` : null);
    if (tx.value > 0n) out.balanceChanges.push({ asset: egld, delta: (-tx.value).toString() });
  } else if (!toContract && !toSelf && textOf(tx.data) !== null) {
    // EGLD to a person with a note (exchanges use the data field as a memo).
    await describeTransfers([egldMoved(tx.value)], tx.receiver, null);
    out.lines.push({ label: "Note", value: textOf(tx.data)! });
  } else {
    out.blind = true;
  }

  if (out.blind) {
    out.title = say("bg.req.unreadableFrom", { host: d.host });
    delete out.titleMsg;
    out.lines = [{ label: "To", value: tx.receiver }];
    out.balanceChanges = tx.value > 0n ? [{ asset: egld, delta: (-tx.value).toString() }] : [];
    out.warnings = [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." }];
  }
  if (tx.relayer) {
    out.lines.push({ label: "Fee paid by", value: tx.relayer });
    out.warnings.push({ level: "info", code: "network-matters", message: "Another account pays the network fee for this transaction." });
  }
  if (tx.guardian) out.lines.push({ label: say("bg.multiversx.labelGuardian"), value: tx.guardian });
  const spec = specFor(d.networkId);
  if (spec && tx.chainID !== spec.chainId) {
    out.warnings.push({ level: "danger", code: "network-matters", message: "This transaction is for a different MultiversX network. Nothing was sent." });
  }
  return out;
}

/** The smart contract call after a token payment's own arguments ("…@<fn hex>@<args>"), or null. */
function rest(call: Call, used: number): Call | null {
  if (call.args.length <= used) return null;
  const fn = textOf(call.args[used]!);
  if (!fn || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(fn)) return { fn: "unknown", args: call.args.slice(used + 1) };
  return { fn, args: call.args.slice(used + 1) };
}
