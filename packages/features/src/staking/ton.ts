import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN } from "@clip-wallet/core";
import {
  cellFromBase64,
  cellToB64,
  endpoints,
  friendlyTonAddress,
  jettonBurnBody,
  netOf,
  parseJettonBurn,
  parseTonstakersDeposit,
  rawTonAddress,
  sameTonAddress,
  tonConnectNetwork,
  tonstakersDepositBody,
  type TonNet,
} from "@clip-wallet/chains-ton";
import { fetchJson } from "../http.js";
import { formatUnits, percent, randomId } from "../util.js";
import type { StakeOptionView, StakePositionView } from "../views.js";
import type { StakeActionParams, StakeBuild, StakingProvider } from "./types.js";

/**
 * GRAM (formerly Toncoin) liquid staking with Tonstakers: you send GRAM to the pool and get tsTON back, a token
 * whose value in GRAM grows as validators earn. Unstaking burns tsTON; the pool pays GRAM back right away when it
 * has spare liquidity, otherwise at the end of the validation round (about 18 hours), automatically.
 *
 * Why Tonstakers: it's keyless and permissionless with a 1 GRAM minimum. Nominator pools (TON Whales: 50 GRAM
 * minimum and a queue; TON Foundation nominator pools: 10,000+ GRAM and validator cooperation; single-nominator is
 * for your own validator) don't fit a wallet's "stake an amount" flow.
 *
 * Sources (2026-10-03):
 *  - Pool addresses: tonstakers/tonstakers-sdk `src/constants.ts` (STAKING_CONTRACT_ADDRESS, …_TESTNET). Both
 *    show as implementation "liquidTF" on tonapi `GET /v2/staking/pool/{address}` (mainnet and testnet.tonapi.io,
 *    keyless), which also gives `apy`, `min_stake` and `liquid_jetton_master` (tsTON). tsTON masters below were read
 *    from there and are allow-listed.
 *  - Messages: ton-blockchain/liquid-staking-contract `contracts/op-codes.func` + `contracts/pool.func`:
 *    deposit = op 0x47d54391 + query_id with value = stake + 1 GRAM (DEPOSIT_FEE; what isn't spent on gas comes
 *    back with the tsTON); unstake = TEP-74 burn (0x595f07bc) to your own tsTON wallet with 1.05 GRAM attached and
 *    the SDK's custom payload (wait_till_round_end, fill_or_kill bits).
 *  - Exchange rate: tonapi `GET /v2/blockchain/accounts/{pool}/methods/get_pool_full_data` → decoded
 *    total_balance / supply (and projected_* for what a new deposit receives).
 */
export const TONSTAKERS: Record<TonNet, { pool: string; tsTON: string }> = {
  mainnet: { pool: "EQCkWxfyhAkim3g2DjKQQg8T5P4g-Q1-K_jErGcDJZ4i-vqR", tsTON: "0:bdf3fa8098d129b54b4f73b5bac5d1e1fd91eb054169c3916dfc8ccd536d1000" },
  testnet: { pool: "kQANFsYyYn-GSZ4oajUJmboDURZU-udMHf9JxzO4vYM_hFP3", tsTON: "0:224365caec15de3cbc1e99ea3ebb8c0dca383ec3119ec9299a14610fed1d8c85" },
};
/** Attached to a deposit on top of the stake (pool DEPOSIT_FEE). */
export const DEPOSIT_FEE = 1_000_000_000n;
/** Attached to an unstake burn (SDK UNSTAKE_FEE_RES). */
export const UNSTAKE_FEE = 1_050_000_000n;
export const MIN_STAKE = 1_000_000_000n;
const POSITION_ID = "tonstakers";

interface PoolInfo {
  pool: { address: string; name: string; apy: number; min_stake: number; liquid_jetton_master?: string; implementation: string };
}
interface PoolData {
  success?: boolean;
  stack?: { type: string; num?: string }[];
  decoded?: { total_balance?: number | string; supply?: number | string; projected_balance?: number | string; projected_supply?: number | string; deposits_open?: boolean; halted?: boolean };
}
interface JettonBalance {
  balance: string;
  wallet_address: { address: string };
  jetton: { address: string; symbol: string; decimals: number };
}

const big = (v: number | string | undefined) => (v === undefined ? 0n : BigInt(typeof v === "number" ? Math.round(v).toString() : v));

/** The parts of a built stake/unstake request the wallet re-checks (also used by tests). */
export function checkTonstakersRequest(
  request: DappRequest,
  e: { kind: "stake"; pool: string; amount: bigint } | { kind: "unstake"; tsTONWallet: string; me: string; tsTON: bigint },
): boolean {
  try {
    const p = request.params as { messages?: { address: string; amount: string; payload?: string }[]; items?: unknown };
    if (!p.messages || p.messages.length !== 1 || p.items) return false;
    const m = p.messages[0]!;
    if (!m.payload) return false;
    if (e.kind === "stake") {
      if (!sameTonAddress(m.address, e.pool) || BigInt(m.amount) !== e.amount + DEPOSIT_FEE) return false;
      parseTonstakersDeposit(cellFromBase64(m.payload));
      return true;
    }
    if (!sameTonAddress(m.address, e.tsTONWallet) || BigInt(m.amount) !== UNSTAKE_FEE) return false;
    const b = parseJettonBurn(cellFromBase64(m.payload));
    return b.amount === e.tsTON && b.amount > 0n && !!b.responseDestination && sameTonAddress(b.responseDestination, e.me);
  } catch {
    return false;
  }
}

export class TonStaking implements StakingProvider {
  readonly family = "ton" as const;
  readonly assetKey = "gram";
  readonly wholeBalance = false;
  readonly howItWorks =
    "Your GRAM goes to Tonstakers, which lends it to TON validators. You get tsTON back: it stays in your wallet and is worth more GRAM over time as rewards come in. Unstaking turns tsTON back into GRAM, right away when the pool has enough on hand, otherwise automatically when the current round ends (about 18 hours). Each action attaches about 1 GRAM for fees; what isn't used comes back.";

  constructor(private readonly opts: { partnerCode?: bigint } = {}) {}

  supports(network: Network): boolean {
    return network.family === "ton" && netOf(network.id) !== null;
  }

  private cfg(ctx: ChainContext) {
    const n = netOf(ctx.network.id);
    if (!n) throw new ClipError("Staking isn't available here.", "stake/unsupported");
    return { ...TONSTAKERS[n], tonapi: endpoints(ctx.network).tonapi, testnet: n === "testnet" };
  }

  private async poolInfo(ctx: ChainContext): Promise<PoolInfo["pool"]> {
    const c = this.cfg(ctx);
    const r = await fetchJson<PoolInfo>(ctx.fetch, `${c.tonapi}/v2/staking/pool/${rawTonAddress(c.pool)}`, "Tonstakers");
    if (r.pool.implementation !== "liquidTF" || (r.pool.liquid_jetton_master && !sameTonAddress(r.pool.liquid_jetton_master, c.tsTON))) {
      throw new ClipError("Tonstakers looks different than expected, so Clip Wallet won't stake there right now.", "stake/unexpected-pool");
    }
    return r.pool;
  }

  /**
   * GRAM per tsTON now (total_balance / supply) and for a new deposit (projected_*). tonapi's `decoded` numbers
   * can exceed 2^53 on mainnet, so the exact values come from the raw stack (get_pool_full_data returns
   * total_balance at index 2 and supply at index 13, liquid-staking-contract `pool.func`); the projected ratio is
   * only used for the "you get about" estimate.
   */
  private async rates(ctx: ChainContext): Promise<{ balance: bigint; supply: bigint; projectedRatio: number; open: boolean }> {
    const c = this.cfg(ctx);
    const r = await fetchJson<PoolData>(ctx.fetch, `${c.tonapi}/v2/blockchain/accounts/${rawTonAddress(c.pool)}/methods/get_pool_full_data`, "Tonstakers");
    const d = r.decoded ?? {};
    const num = (i: number, fallback: number | string | undefined) => {
      const e = r.stack?.[i];
      return e?.type === "num" && typeof e.num === "string" ? BigInt(e.num) : big(fallback);
    };
    const balance = num(2, d.total_balance);
    const supply = num(13, d.supply);
    if (!r.success || balance <= 0n || supply <= 0n) throw new ClipError("Tonstakers couldn't answer that right now. Try again in a moment.", "stake/no-rate");
    const pb = Number(d.projected_balance ?? 0);
    const ps = Number(d.projected_supply ?? 0);
    const projectedRatio = pb > 0 && ps > 0 ? ps / pb : Number(supply) / Number(balance);
    return { balance, supply, projectedRatio, open: d.deposits_open !== false && d.halted !== true };
  }

  private async tsTON(ctx: ChainContext): Promise<JettonBalance | null> {
    const c = this.cfg(ctx);
    const me = rawTonAddress(ctx.account.address);
    try {
      const r = await fetchJson<JettonBalance>(ctx.fetch, `${c.tonapi}/v2/accounts/${me}/jettons/${c.tsTON}`, "TON");
      return BigInt(r.balance) > 0n ? r : null;
    } catch (e) {
      if (e instanceof ClipError && (e.code === "features/http-404" || e.code === "features/http-400")) return null;
      throw e;
    }
  }

  async rewardRate(ctx: ChainContext): Promise<string | undefined> {
    const p = await this.poolInfo(ctx);
    return Number.isFinite(p.apy) && p.apy > 0 ? `About ${percent(p.apy, 1)} a year` : undefined;
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const p = await this.poolInfo(ctx);
    const min = BigInt(p.min_stake || 0) > MIN_STAKE ? BigInt(p.min_stake) : MIN_STAKE;
    const o: StakeOptionView = {
      id: POSITION_ID,
      title: "Tonstakers",
      detail: `${Number.isFinite(p.apy) ? `Earns about ${percent(p.apy, 1)} a year · ` : ""}you get tsTON · at least ${formatUnits(min, 9)} GRAM`,
      recommended: true,
    };
    if (Number.isFinite(p.apy)) o.apy = p.apy;
    return [o];
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const j = await this.tsTON(ctx);
    if (!j) return [];
    const r = await this.rates(ctx);
    const ts = BigInt(j.balance);
    const gram = (ts * r.balance) / r.supply;
    return [
      {
        id: POSITION_ID,
        assetKey: this.assetKey,
        symbol: "GRAM",
        decimals: 9,
        amount: gram.toString(),
        amountDisplay: `${formatUnits(gram, 9, 4)} GRAM`,
        with: "Tonstakers",
        status: "active",
        statusText: `Earning rewards · you hold ${formatUnits(ts, 9, 4)} tsTON`,
        actions: ["unstake"],
        partialUnstake: true,
        networkId: ctx.network.id,
      },
    ];
  }

  async buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    if (p.optionId && p.optionId !== POSITION_ID) throw new ClipError("That staking option isn't available.", "stake/unknown-option");
    if (!p.amount || !/^\d+$/.test(p.amount)) throw new ClipError("Enter how much GRAM to stake.", "stake/bad-amount");
    const amount = BigInt(p.amount);
    if (amount < MIN_STAKE) throw new ClipError("Stake at least 1 GRAM.", "stake/too-small");
    const c = this.cfg(ctx);
    const r = await this.rates(ctx);
    if (!r.open) throw new ClipError("Tonstakers isn't taking new stakes right now. Try again later.", "stake/closed");
    const expectTs = BigInt(Math.floor(Number(amount) * r.projectedRatio));
    const body = tonstakersDepositBody({ queryId: 1n, partnerCode: this.opts.partnerCode ?? 0n });
    const request: DappRequest = {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "ton",
      networkId: ctx.network.id,
      method: "sendTransaction",
      params: {
        network: tonConnectNetwork(ctx.network.id),
        from: rawTonAddress(ctx.account.address),
        messages: [{ address: friendlyTonAddress(c.pool, { bounceable: true, testOnly: c.testnet }), amount: (amount + DEPOSIT_FEE).toString(), payload: cellToB64(body) }],
      },
    };
    const pool = c.pool;
    return {
      steps: [
        {
          title: `Stake ${formatUnits(amount, 9)} GRAM`,
          lines: [
            { label: "With", value: "Tonstakers" },
            { label: "You get about", value: `${formatUnits(expectTs, 9, 4)} tsTON` },
            { label: "Fees", value: "1 GRAM attached (unused part comes back)" },
          ],
          request,
          verify: (rq) => checkTonstakersRequest(rq, { kind: "stake", pool, amount }),
        },
      ],
    };
  }

  /** `amount` is in GRAM base units (what the position shows); it's converted to tsTON at the current rate. */
  async buildUnstake(p: StakeActionParams, ctx: ChainContext): Promise<StakeBuild> {
    if (p.positionId !== POSITION_ID) throw new ClipError("That staked balance wasn't found.", "stake/unknown-position");
    const j = await this.tsTON(ctx);
    if (!j) throw new ClipError("You don't have anything staked with Tonstakers.", "stake/nothing-staked");
    const c = this.cfg(ctx);
    const r = await this.rates(ctx);
    const held = BigInt(j.balance);
    let ts = held;
    if (p.amount !== undefined) {
      if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "stake/bad-amount");
      ts = (BigInt(p.amount) * r.supply) / r.balance;
      if (ts > held) ts = held;
      if (ts <= 0n) throw new ClipError("That amount is too small to unstake.", "stake/too-small");
    }
    const me = rawTonAddress(ctx.account.address);
    const wallet = rawTonAddress(j.wallet_address.address);
    const gram = (ts * r.balance) / r.supply;
    const body = jettonBurnBody({ amount: ts, responseDestination: me });
    const request: DappRequest = {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "ton",
      networkId: ctx.network.id,
      method: "sendTransaction",
      params: {
        network: tonConnectNetwork(ctx.network.id),
        from: me,
        messages: [{ address: friendlyTonAddress(wallet, { bounceable: true, testOnly: c.testnet }), amount: UNSTAKE_FEE.toString(), payload: cellToB64(body) }],
      },
    };
    return {
      steps: [
        {
          title: `Unstake ${formatUnits(gram, 9, 4)} GRAM`,
          lines: [
            { label: "Gives back", value: `${formatUnits(ts, 9, 4)} tsTON` },
            { label: "When", value: "Right away if Tonstakers has enough on hand, otherwise when the current round ends (about 18 hours)" },
            { label: "Fees", value: "1.05 GRAM attached (unused part comes back)" },
          ],
          request,
          verify: (rq) => checkTonstakersRequest(rq, { kind: "unstake", tsTONWallet: wallet, me, tsTON: ts }),
        },
      ],
    };
  }
}
