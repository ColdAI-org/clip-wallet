import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN } from "@clip-wallet/core";
import {
  addressFromCellHex,
  cellFromBase64,
  cellToB64,
  endpoints,
  friendlyTonAddress,
  netOf,
  parsePtonTransfer,
  parseStonfiSwapPayload,
  ptonTransferBody,
  rawTonAddress,
  sameTonAddress,
  stonfiSwapPayload,
  tonConnectNetwork,
  type TonCell,
} from "@clip-wallet/chains-ton";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { formatUnits, randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import type { SwapProvider, SwapQuote, SwapQuoteRequest } from "./types.js";

/**
 * STON.fi DEX v2 on TON.
 *
 * Quote: POST https://api.ston.fi/v1/swap/simulate?offer_address&ask_address&units&slippage_tolerance&dex_version=2
 * (keyless; parameters from the API's own OpenAPI at api.ston.fi/api-doc/openapi.json) → router, pool, ask_units,
 * offer/ask_jetton_wallet (the ROUTER's jetton wallets), price_impact.
 *
 * The API serves mainnet only ("the API only serves mainnet data", docs.ston.fi/developer-section/dex/sdk/v2/swap),
 * so testnet swaps are unavailable in plain words.
 *
 * The wallet builds the messages itself with @ton/core (helpers in @clip-wallet/chains-ton `defi.ts`), following
 * the official SDK's layout (ston-fi/sdk BaseRouterV2_1 / PtonV2_1):
 *  - GRAM in: one message to the router's pTON v2.1 wallet: pTON ton_transfer(offer, refund = you, swap payload);
 *    value = offer + 0.3 GRAM forward gas + 0.01 GRAM pTON gas.
 *  - Token in: a TEP-74 jetton transfer (TON Connect `items` entry, the chain module finds your token wallet)
 *    of the offer to the router, 0.3 GRAM attached, 0.24 GRAM forwarded with the swap payload.
 *  - Swap payload: ask = router's jetton wallet for the token you get, receiver/refund/excesses = you,
 *    min_out = quote × (1 − slippage) (enforced by the pool: below it the offer is refunded), deadline 20 min.
 * Allow-list: the router must be one of STON.fi's v2 routers on pTON v2.1 (snapshot of GET /v1/routers on
 * 2026-10-03, pTON master EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S), with its own pTON wallet. The router's
 * ask-side jetton wallet is checked on-chain (tonapi get_wallet_data: owner = router, master = the token you get).
 */
export const STONFI_API = "https://api.ston.fi";
/** What STON.fi's API calls native GRAM. */
export const STONFI_NATIVE = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
export const STONFI_PTON_V2_1_MASTER = "EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S";

/** Mainnet v2 routers (v2.1 and v2.2, pTON v2.1) → that router's pTON wallet. From GET api.ston.fi/v1/routers, 2026-10-03. */
export const STONFI_V2_ROUTERS: [router: string, ptonWallet: string][] = [
  ["EQDBYUj5KEPUQrbj7da742UYJIeT9QU5C2dKsi12SdQ3yh9a", "EQDARm-e3yRFmxAabT5OfXKjFp23PS6p7hXBwwrgmvkdbXCr"],
  ["EQBjM7B2PKa82IPKrUFbMFaKeQDFGTMRnrvY1TmptC7Kxz7B", "EQBicl-T79f0FwI_nygtAm_ISq15BVusRKEbZnC2_2QFjH34"],
  ["EQDwyjgjnTXJVPjXji3OPtUilcCjceGVQOLGwr9_sRLjImfG", "EQDwVbvZWrXEWQ_lL_69WehyNkNKm4pkswOSeJQtzx1gcHMF"],
  ["EQBQ_UBQvR9ryUjKDwijtoiyyga2Wl-yJm6Y8gl0k-HDh_5x", "EQBTYCx7TGgVgaIr3tuJ3r_91E6FUBBWLtT73lTYYmrIc5gb"],
  ["EQDQ6j53q21HuZtw6oclm7z4LU2cG6S2OKvpSSMH548d7kJT", "EQDTx6o7gmGo8cuJt_3EHEgO1RmGnLtGTzgTOsG5pAYs0uYd"],
  ["EQDgebEMA6yriI7SMffE65DIVA9rzSRmfGV_gy3ylIhLicY8", "EQDgXEo6f94Bq90eHGFTVK0LyhGaePDhXEgiv1JK6LHFEYRP"],
  ["EQCDT9dCT52pdfsLNW0e6qP5T3cgq7M4Ug72zkGYgP17tsWD", "EQCCgTcJEugMCmQjJDJLTFlu56od9fJDfkTSNv4QEGpHihJx"],
  ["EQBCtlN7Zy96qx-3yH0Yi4V0SNtQ-8RbhYaNs65MC4Hwfq31", "EQBB_dTiG6u4IIbDT80yirqwmLpwRp7cDGkdrmvQ3Xs_39xM"],
  ["EQCxkYVQcfXKw9uJ-MMtutvR2Cu0DVCZFfLNBp6NwXgO8vQY", "EQCyfHYh17xx-KwZvcc1t61tLVVCxSk0jYxwRznbpHqQ-R0k"],
  ["EQChoROpuUM4cpN6IRzqNTrkP9iVZHYoHgxMABDVU28vlUiG", "EQChdJmlvKnQVkiOwUYnUKJU_zgoyLT81XIyYxVH6RO8OtlH"],
  ["EQBigMnbY4NU1uwdvzertV5mv_yI7282R-ffW7XZFWPEVRDG", "EQBiLHuQjDj4fNyCD7Ch5HwpNGldlb5g-LMwQ1kStQ4NM5kv"],
  ["EQCiz74FCV2lYlvFPEYhL3Jql8WwIO7QvbvYT-LQH0SmtCgI", "EQCh82fvi6mY0FdoKprvfDLE2q-nE9FIU3SWTVLgNqMJliOO"],
  ["EQACn16m9OrZ-mw186M4NlIpVP8Tb3q6SV9aX8NjSgVfJTo9", "EQAD2AcAb4blnbeGPPugZoxSpeibAMTB5kyDMIpUgKrsqk-z"],
  ["EQBSNX_5mSikBVttWhIaIb0f8jJU7fL6kvyyFVppd7dWRO6M", "EQAKz7pQ4mi88Br4WKWcRozQbuRP3xi3eNnwlKa12ECcPfZG"],
  ["EQDh5oHPvfRwPu2bORBGCoLEO4WQZKL4fk5DD1gydeNG9oEH", "EQDix2qMOc-QO05Nn9X7oKFnYTb3bvtxN7ySmzoGljrFv2bX"],
  ["EQCRgwuFbPRR7TGodkJwbjiBtNtb0hfzJIliV-5kY6lKr_18", "EQCSQy327bW5cik1IycFmY4Qvsmgt-o4F6Ze54-lv2AOPBSk"],
  ["EQAJG5pyZPWEiQiMVJdf7bDRgRLzg6QR57qKeRsOrMO-ncZN", "EQAIuYlddISZbBf7iymZ-WPP9zHaVj9Kg45OH-PgntVz9QbQ"],
  ["EQABT9GCyDI60CbC4c6uS33HFDwaqd6MddiwIIw7CXTgNR3A", "EQADMtjROtxVRcr1PZ8Zoq6Uxv-5O6uRw7v2XktW0WRtZDnK"],
  ["EQDx--jUU9PUtHltPYZX7wdzIi0SPY3KZ8nvOs0iZvQJd6Ql", "EQDwOyDlewGw8MkeXgZ_oOmPTIhJIlaJwhJmf4ffIPKv-294"],
  ["EQDAPye7HAPAAl4WXpz5jOCdhf2H9h9QkkzRQ-6K5usiuQeC", "EQDBXpJBctAKlbAMWqH2iTPyBPfdBPeQZ6CGRp1oKBqQkEDL"],
  ["EQAiv3IuxYA6ZGEunOgZSTuMBzbpjwRbWw09-WsE-iqKKMrK", "EQAgXtyQlqVF2V3F4mKlbvYzUijlGjUmJbPWkWuiFNdpzWL_"],
  ["EQBzkqAN4ViYdS24lD2fFPe8odHn2rUkfMYbEJ88EBKBAS1b", "EQBwU5CgFHiNsGKIBetAsMqnoDCtEQIcC3m8HW12GGDz6KfN"],
  ["EQAz1D0ZUiG_9XCyjrJ1-xTx-CnmnQ3J3LMKQ7sZTr-XlNZP", "EQA2O81nzig4IUsCp_8dpzglywsCx-1ESPFzl0ygs1hFYUa2"],
  ["EQBjK_kjY5R_DoyTRff109VzFrSlKFCC_gOOWIMtyEvCcv2J", "EQBiy9ltu3lkML1i_MAVW2yaXOsPeJ3NXCXQLlcAx-6lKrN1"],
  ["EQDi1eWU3HWWst8owY8OMq2Dz9nJJEHUROza8R-_wEGb8yu6", "EQDiolbUI-wbmncBen7bYEG1pK_F27RKlqoRWCzSSA8mpqfe"],
  ["EQByADL5Ra2dldrMSBctgfSm2X2W1P61NVW2RYDb8eJNJGx6", "EQBzIe_KYGrezmSS3ua9buM0P8vzEnMFDrsv1prFnwP43hFk"],
  ["EQD11suHkrO_1Mb5IIdYFx5ZPy38MuHoeHx6dA-QRaD8w0UJ", "EQD-zKpOa1GjFQDOMnP4A-tX3ntmgV7vs127m0tS_SrJY3kG"],
  ["EQAiLV677BgHNXEUuDJ3Cw8K5WOiJSO86xh8YQq2LthJEoED", "EQAmV2BzRi6c-S1263Ar9HhyCLrvtMEae_qfEzhxnK7qSpr0"],
  ["EQAyY2lBQ6RsVe88CKTmeH3BWWsUCWu7ugQNaf5kwLDYAoKt", "EQAyEwoQcmDv0385t9szG-XIUcWMpYlUAOpA5I4HAViY-FnW"],
  ["EQAQYbnb1EGK0Wb8mk3vEW4vbHTyv7cOcfJlPWQ87_6_qfzR", "EQARZ1hF4v95ELsH7pCPMN79_UeqKOOgOjt8xrkW9HhIM-u1"],
  ["EQCiypoBWNIEPlarBp04UePyEj5zH0ZDHxuRNqJ1WQx3FCY-", "EQCjEo7QNUH5S2tVjYgFFdEh1pherydH9K-nrHx0aScsq7U5"],
  ["EQBwpBGEAb-NgjUxpmARAgVl8C4F_5GsXxZ3dpsA1qzQerNl", "EQByjaOja6-prxDrniGIzs-lBmNnP-nsvGxH1X2y4M3M5sjm"],
  ["EQAGV9vw11tKW2QOCYCXEmIdyufM3p5CfcgHcY9NiiBLfZGH", "EQAGM0cbPP-HmOONE_RBFnPtHJDkY5qZ_crocAns0QW25e8p"],
  ["EQDkncuJ267Py3EmL2XAN7YsSNQMUu8u-GHsW9jVljcH8fr5", "EQCcM8n2_K5D9Gu-YkyxM2W35WFs7ekYSbV9lgjXUDYofYt4"],
  ["EQBqgCTdrtSod76UrcOeALSiLCp3WuNIFQBQvyjjlQMvwLkc", "EQBvwdaM2LT9JPZGYdqYMCtIuLzjjAqHDSdaJW8fErAU7JUM"],
  ["EQAsa5p_UWxUDaU9n9bo3CAv2xRNrNFjadhm70JQAesdVt_5", "EQAv-TBd0IlTuUWoM_KNJ0uOgXkQlXqdZVmfNMc7eBIqKxi3"],
  ["EQDTb1w1TCohFqnNcyPrrbbBJQdAwwPn8DbCoaSUd0S5T4fB", "EQDTN22aBi-Pa_GyDWi8wBuVUxLhOwfAklgN5-bbTk87-uBh"],
  ["EQBCl1JANkTpMpJ9N3lZktPMpp2btRe2vVwHon0la8ibRied", "EQBDOw08nLEwr9TTXyXDiPuBogHZM_1Rk42Ks8h-FQkP330_"],
  ["EQATvO_BXfkFocOXhlve01EZfsiyFjoV-0k9CLmpgwtzVtcN", "EQARs8oCeUBx5sWfazL6gZzTFAA9-RgnicsGhHBA8tDLIXgS"],
  ["EQBQErJi0DHgKYseIHtrQk4N5CQLCr3XYwkQIEw0HNs470OG", "EQBS0OA18gacX-knOwi7kYuZms3JFwSs4A6j3DvowxfCX9aC"],
  ["EQAgERF5tvrNn0AM2Rrrvk-MutGP60ZL70bJPuqvCTGY-17_", "EQAg3Rfrs5JAy31xPIv0hVsAkjDmF8yTxxxkygNvpzNBcJAB"],
  ["EQC67o2-2UzR1cJFrUGL5M7OAnLgG8oY_tHaTgGmR63LQNV-", "EQC4V6MEH2RGiHw5a9g74AXEjyPR1qA-N9mzMEIs9hOSZzVP"],
  ["EQCCdNmj4QbNjrg_PM-JJE-B9f_czXLkYmrO7P9UkA6tt95m", "EQCCcuEVMGOSBQwv8Wmak1zbB8WpIuQbfavZYc3cL3QPNlK7"],
  ["EQCx0HDJ_DxLxDSQyfsEqHI8Rs65nygvdmeD9Ra7rY15OWN8", "EQCzUiz7TFS7p7ByYXt-c3lJDmyGvmHTQIm0vhwSiiiaLpVj"],
  ["EQADEFMTMnC-gu5v2U0ZY8AYaGhAOk9TcECg1TOquAW3r-IE", "EQACuz151snlY46PKdUOkyiCf0zzcxMsN6XmKQkSKZjkvyFH"],
  ["EQBZj7nhXNhB4O9rRCn4qGS82DZaPUPlyM2k6ZrbvQ1j3Ge7", "EQBSDTCjmP35i5CnqT0IiankTmJeOBnUzq7eJ19oO6JgOPgs"],
  ["EQCS4UEa5UaJLzOyyKieqQOQ2P9M-7kXpkO5HnP3Bv250cN3", "EQCSIMGBps_qzRG3uPYhON8bucyCtu0mYdL1-u4gSz77IBa3"],
  ["EQCpuYtq55nhkwYDmL4OWjsrdYy83gj5_49nNRQ5CrPOze49", "EQClcxRtn7nhZ3zzwsLk_itGaSe0r1r0Dj8fBLAxonkKNsZh"],
  ["EQBd9vfWfn6MOqBYEEYFeyFqliOYln1znFklfp8B02zlS_Lq", "EQBeGsTkQbK4blB38PLbYlhqG2Xt3BH9IcX4FAS_Dpr6xPJK"],
  ["EQAyD7O8CvVdR8AEJcr96fHI1ifFq21S8QMt1czi5IfJPyfA", "EQAyvcnP0RexLvnsQMXfKYnk18Bzl3Y-iGt6bXqFB75ugXmE"],
];

/** Gas the official SDK attaches (BaseRouterV2_1.gasConstants, PtonV2_1.gasConstants), in nanograms. */
export const STONFI_GAS = {
  jettonIn: { attach: 300_000_000n, forward: 240_000_000n },
  gramIn: { forward: 300_000_000n, ptonTransfer: 10_000_000n },
} as const;
/** Seconds the router accepts the swap for (SDK default is 15 min; a little slack for the approval screen). */
export const STONFI_DEADLINE_S = 20 * 60;

interface SimulateResponse {
  offer_address: string;
  ask_address: string;
  offer_jetton_wallet: string;
  ask_jetton_wallet: string;
  router_address: string;
  router?: { address: string; major_version: number; minor_version: number; pton_master_address?: string; pton_wallet_address?: string; pton_version?: string; router_type?: string };
  pool_address: string;
  offer_units: string;
  ask_units: string;
  min_ask_units?: string;
  price_impact?: string;
  fee_units?: string;
}

interface StonfiData {
  kind: "gram-in" | "jetton-in";
  router: string;
  ptonWallet: string;
  askJettonWallet: string;
}

function ptonWalletOf(router: string): string | null {
  const hit = STONFI_V2_ROUTERS.find(([r]) => sameTonAddress(r, router));
  return hit ? hit[1] : null;
}

const apiAddress = (assetAddress: string | undefined) => (assetAddress ? friendlyTonAddress(assetAddress, { bounceable: true, testOnly: false }) : STONFI_NATIVE);

const stopped = () => new ClipError("This swap quote looks wrong, so Clip Wallet stopped it.", "swap/unexpected-target");

/** The parts of a built swap request the wallet re-checks (also used by tests). */
export interface StonfiExpect {
  me: string;
  kind: StonfiData["kind"];
  router: string;
  ptonWallet: string;
  askJettonWallet: string;
  sellMaster?: string;
  sellAmount: bigint;
  minOut: bigint;
}

/**
 * Re-reads a wallet-built STON.fi request and checks every field that moves money: where it goes (allow-listed
 * router / its pTON wallet), how much, who gets the output and the refund, and the minimum output.
 */
export function checkStonfiRequest(request: DappRequest, e: StonfiExpect): boolean {
  try {
    const p = request.params as { messages?: { address: string; amount: string; payload?: string }[]; items?: Record<string, string>[] };
    const swapOk = (payload: TonCell | null) => {
      if (!payload) return false;
      const s = parseStonfiSwapPayload(payload);
      return (
        sameTonAddress(s.receiver, e.me) &&
        sameTonAddress(s.refund, e.me) &&
        sameTonAddress(s.excesses, e.me) &&
        sameTonAddress(s.askJettonWallet, e.askJettonWallet) &&
        s.minOut >= e.minOut &&
        s.minOut > 0n &&
        s.referral === null &&
        !s.hasCustomPayloads
      );
    };
    if (e.kind === "gram-in") {
      if (!p.messages || p.messages.length !== 1 || p.items) return false;
      const m = p.messages[0]!;
      if (!sameTonAddress(m.address, e.ptonWallet) || ptonWalletOf(e.router) === null || !sameTonAddress(ptonWalletOf(e.router)!, e.ptonWallet)) return false;
      if (BigInt(m.amount) !== e.sellAmount + STONFI_GAS.gramIn.forward + STONFI_GAS.gramIn.ptonTransfer || !m.payload) return false;
      const t = parsePtonTransfer(cellFromBase64(m.payload));
      return t.tonAmount === e.sellAmount && sameTonAddress(t.refund, e.me) && swapOk(t.forwardPayload);
    }
    if (!p.items || p.items.length !== 1 || p.messages) return false;
    const it = p.items[0]!;
    if (it.type !== "jetton" || !e.sellMaster || !sameTonAddress(it.master!, e.sellMaster)) return false;
    if (!ptonWalletOf(it.destination!) || !sameTonAddress(it.destination!, e.router)) return false;
    if (BigInt(it.amount!) !== e.sellAmount || it.customPayload) return false;
    if (BigInt(it.attachAmount!) !== STONFI_GAS.jettonIn.attach || BigInt(it.forwardAmount!) !== STONFI_GAS.jettonIn.forward) return false;
    if (it.responseDestination && !sameTonAddress(it.responseDestination, e.me)) return false;
    return swapOk(it.forwardPayload ? cellFromBase64(it.forwardPayload) : null);
  } catch {
    return false;
  }
}

export class StonfiSwap implements SwapProvider {
  readonly id = "stonfi";
  readonly name = "STON.fi";
  readonly family = "ton" as const;

  constructor(private readonly opts: { base?: string; now?: () => number } = {}) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  availability(network: Network): Unavailable | null {
    if (network.family !== "ton") return { code: "swap/wrong-family", message: "STON.fi only swaps TON tokens." };
    if (netOf(network.id) !== "mainnet") return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    return null;
  }

  /** Router's jetton wallet for `master`, checked on-chain: owner = router and master = the token. */
  private async checkRouterWallet(ctx: ChainContext, wallet: string, router: string, master: string): Promise<void> {
    const { tonapi } = endpoints(ctx.network);
    const r = await fetchJson<{ success: boolean; stack: { type: string; cell?: string }[] }>(
      ctx.fetch,
      `${tonapi}/v2/blockchain/accounts/${rawTonAddress(wallet)}/methods/get_wallet_data`,
      "TON",
    );
    const owner = r.success && r.stack[1]?.cell ? addressFromCellHex(r.stack[1].cell) : null;
    const m = r.success && r.stack[2]?.cell ? addressFromCellHex(r.stack[2].cell) : null;
    if (!owner || !m || !sameTonAddress(owner, router) || !sameTonAddress(m, master)) throw stopped();
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const why = this.availability(ctx.network);
    if (why) throw new ClipError(why.message, why.code);
    if (!/^\d+$/.test(req.amount) || BigInt(req.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "swap/bad-amount");
    if (!req.sell.address && !req.buy.address) throw new ClipError("Pick two different tokens to swap.", "swap/same-token");
    const u = new URL(`${this.opts.base ?? STONFI_API}/v1/swap/simulate`);
    u.searchParams.set("offer_address", apiAddress(req.sell.address));
    u.searchParams.set("ask_address", apiAddress(req.buy.address));
    u.searchParams.set("units", req.amount);
    u.searchParams.set("slippage_tolerance", String(req.slippageBps / 10_000));
    u.searchParams.set("dex_version", "2");
    let s: SimulateResponse;
    try {
      s = await fetchJson<SimulateResponse>(ctx.fetch, u.toString(), "STON.fi", { method: "POST" });
    } catch (e) {
      if (e instanceof ClipError && /^features\/http-4/.test(e.code)) {
        throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");
      }
      throw e;
    }
    if (!s.ask_units || BigInt(s.ask_units) <= 0n) throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");
    if (BigInt(s.offer_units) !== BigInt(req.amount)) throw stopped();

    // Allow-list: a known v2 router, with its own pTON wallet.
    const router = s.router_address;
    const ptonWallet = ptonWalletOf(router);
    if (!ptonWallet || (s.router && s.router.major_version !== 2)) throw stopped();
    if (s.router?.pton_master_address && !sameTonAddress(s.router.pton_master_address, STONFI_PTON_V2_1_MASTER)) throw stopped();

    const kind: StonfiData["kind"] = req.sell.address ? "jetton-in" : "gram-in";
    if (kind === "gram-in" && !sameTonAddress(s.offer_jetton_wallet, ptonWallet)) throw stopped();
    if (req.buy.address) await this.checkRouterWallet(ctx, s.ask_jetton_wallet, router, req.buy.address);
    else if (!sameTonAddress(s.ask_jetton_wallet, ptonWallet)) throw stopped();

    const buyAmount = BigInt(s.ask_units);
    const minBuy = (buyAmount * BigInt(10_000 - req.slippageBps)) / 10_000n;
    const q: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: req.amount,
      buyAmount: buyAmount.toString(),
      minBuyAmount: minBuy.toString(),
      slippageBps: req.slippageBps,
      route: ["STON.fi"],
      expiresAt: this.now() + 30_000,
      data: { kind, router: rawTonAddress(router), ptonWallet: rawTonAddress(ptonWallet), askJettonWallet: rawTonAddress(s.ask_jetton_wallet) } satisfies StonfiData,
    };
    const impact = Number(s.price_impact);
    if (s.price_impact !== undefined && Number.isFinite(impact)) q.priceImpactPct = Math.abs(impact) * 100;
    return q;
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const d = quote.data as StonfiData;
    const me = rawTonAddress(ctx.account.address);
    const sellAmount = BigInt(quote.sellAmount);
    const minOut = BigInt(quote.minBuyAmount);
    const payload = stonfiSwapPayload({
      askJettonWallet: d.askJettonWallet,
      receiver: me,
      refund: me,
      minOut,
      deadline: Math.floor(this.now() / 1000) + STONFI_DEADLINE_S,
    });
    const base = {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected" as const,
      family: "ton" as const,
      networkId: ctx.network.id,
      method: "sendTransaction",
    };
    let request: DappRequest;
    let fees: bigint;
    if (d.kind === "gram-in") {
      fees = STONFI_GAS.gramIn.forward + STONFI_GAS.gramIn.ptonTransfer;
      const body = ptonTransferBody({ tonAmount: sellAmount, refund: me, forwardPayload: payload });
      request = {
        ...base,
        params: {
          network: tonConnectNetwork(ctx.network.id),
          from: me,
          messages: [{ address: friendlyTonAddress(d.ptonWallet, { bounceable: true, testOnly: false }), amount: (sellAmount + fees).toString(), payload: cellToB64(body) }],
        },
      };
    } else {
      fees = STONFI_GAS.jettonIn.attach;
      request = {
        ...base,
        params: {
          network: tonConnectNetwork(ctx.network.id),
          from: me,
          items: [
            {
              type: "jetton",
              master: rawTonAddress(quote.sell.address!),
              destination: d.router,
              amount: sellAmount.toString(),
              attachAmount: STONFI_GAS.jettonIn.attach.toString(),
              forwardAmount: STONFI_GAS.jettonIn.forward.toString(),
              forwardPayload: cellToB64(payload),
              responseDestination: me,
            },
          ],
        },
      };
    }
    const expect: StonfiExpect = { me, kind: d.kind, router: d.router, ptonWallet: d.ptonWallet, askJettonWallet: d.askJettonWallet, sellMaster: quote.sell.address, sellAmount, minOut };
    return [
      {
        title: `Swap ${formatUnits(quote.sellAmount, quote.sell.decimals)} ${quote.sell.symbol} for ~${formatUnits(quote.buyAmount, quote.buy.decimals)} ${quote.buy.symbol}`,
        lines: [
          { label: "You get at least", value: `${formatUnits(quote.minBuyAmount, quote.buy.decimals)} ${quote.buy.symbol}` },
          { label: "Through", value: "STON.fi" },
          { label: "Swap fees", value: `Up to ${formatUnits(fees, 9)} GRAM (unused part comes back)` },
          { label: "If the price moves too much", value: `Nothing is swapped and your ${quote.sell.symbol} comes back` },
        ],
        request,
        verify: (r) => checkStonfiRequest(r, expect),
      },
    ];
  }
}
