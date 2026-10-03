/**
 * SaucerSwap router calls (ContractExecuteTransaction), decoded with amounts.
 *
 * Verified sources (fetched 2026-10-03):
 *  - Deployments: https://docs.saucerswap.finance/developerx/contract-deployments
 *      mainnet: V1 SaucerSwapV1RouterV3 0.0.3045981, V2 SaucerSwapV2SwapRouter 0.0.3949434, WHBAR token 0.0.1456986
 *      testnet: V1 router 0.0.19264, V2 SwapRouter 0.0.1414040, WHBAR token 0.0.15058
 *  - V1 router ABI: github.com/saucerswaplabs/saucerswap-periphery contracts/interfaces/IUniswapV2Router01.sol and
 *    IUniswapV2Router02.sol (Uniswap V2 names kept: "ETH" means HBAR, sent as the payable amount in tinybars;
 *    paths use WHBAR; https://docs.saucerswap.finance/developers/v1/swap/swap-hbar-for-tokens).
 *  - V2 router ABI: github.com/saucerswaplabs/saucerswaplabs-v2-periphery contracts/interfaces/ISwapRouter.sol —
 *    the original Uniswap V3 SwapRouter shape **with** `deadline` in every params struct:
 *      ExactInputParams(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)
 *      ExactInputSingleParams(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline,
 *                             uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)
 *      (exactOutput / exactOutputSingle mirror these with amountOut / amountInMaximum)
 *    plus IPeripheryPayments unwrapWHBAR(uint256,address), refundETH(), sweepToken(address,uint256,address) and
 *    multicall(bytes[]). Path = token(20) ‖ fee(3) ‖ token(20)…; for exactOutput it is reversed (output first).
 */
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { HederaLedger } from "./networks.js";
import { hex } from "./util.js";

export const SAUCERSWAP: Record<"mainnet" | "testnet", { v1Router: string; v2Router: string; whbarToken: string }> = {
  mainnet: { v1Router: "0.0.3045981", v2Router: "0.0.3949434", whbarToken: "0.0.1456986" },
  testnet: { v1Router: "0.0.19264", v2Router: "0.0.1414040", whbarToken: "0.0.15058" },
};

/** One leg of a swap, with tokens as Hedera ids ("0.0.x"); WHBAR is reported as "HBAR". */
export interface SaucerSwapIntent {
  version: 1 | 2;
  /** Input token id or "HBAR". */
  tokenIn: string;
  tokenOut: string;
  /** Hops (token ids / "HBAR"), input first. */
  path: string[];
  exactIn: boolean;
  /** Exact input, or maximum input for exact-out. HBAR-in V1 calls use the payable amount. */
  amountIn: bigint;
  /** Minimum output, or exact output. */
  amountOut: bigint;
  /** Final recipient as an EVM address (lower-case 0x…). */
  recipient: string;
  deadline: bigint;
}

const SIGS = {
  swapExactETHForTokens: "swapExactETHForTokens(uint256,address[],address,uint256)",
  swapExactETHForTokensFee: "swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)",
  swapETHForExactTokens: "swapETHForExactTokens(uint256,address[],address,uint256)",
  swapExactTokensForTokens: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  swapExactTokensForTokensFee: "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  swapTokensForExactTokens: "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
  swapExactTokensForETH: "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
  swapExactTokensForETHFee: "swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)",
  swapTokensForExactETH: "swapTokensForExactETH(uint256,uint256,address[],address,uint256)",
  exactInput: "exactInput((bytes,address,uint256,uint256,uint256))",
  exactInputSingle: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
  exactOutput: "exactOutput((bytes,address,uint256,uint256,uint256))",
  exactOutputSingle: "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))",
  multicall: "multicall(bytes[])",
  unwrapWHBAR: "unwrapWHBAR(uint256,address)",
  refundETH: "refundETH()",
  sweepToken: "sweepToken(address,uint256,address)",
} as const;

export const SAUCERSWAP_SIGNATURES: readonly string[] = Object.values(SIGS);

const sel = (s: string) => hex(keccak_256(new TextEncoder().encode(s)).subarray(0, 4));
const BY_SELECTOR = new Map(Object.entries(SIGS).map(([k, s]) => [sel(s), k as keyof typeof SIGS]));

/* ------------------------------------------------------------------ ABI reading (bounds-checked) */

class Abi {
  constructor(private readonly b: Uint8Array) {}
  word(at: number): Uint8Array {
    if (at < 0 || at + 32 > this.b.length) throw new Error("abi: out of range");
    return this.b.subarray(at, at + 32);
  }
  uint(at: number): bigint {
    return BigInt(`0x${hex(this.word(at)) || "0"}`);
  }
  int(at: number): number {
    const v = this.uint(at);
    if (v > BigInt(this.b.length)) throw new Error("abi: bad offset");
    return Number(v);
  }
  address(at: number): string {
    const w = this.word(at);
    if (w.subarray(0, 12).some((x) => x !== 0)) throw new Error("abi: dirty address");
    return `0x${hex(w.subarray(12))}`;
  }
  addressArray(at: number): string[] {
    const n = this.int(at);
    if (n > 8) throw new Error("abi: path too long");
    return Array.from({ length: n }, (_, i) => this.address(at + 32 + i * 32));
  }
  bytes(at: number): Uint8Array {
    const n = this.int(at);
    if (at + 32 + n > this.b.length) throw new Error("abi: bytes out of range");
    return this.b.subarray(at + 32, at + 32 + n);
  }
  bytesArray(at: number): Uint8Array[] {
    const n = this.int(at);
    if (n > 8) throw new Error("abi: too many calls");
    return Array.from({ length: n }, (_, i) => this.bytes(at + 32 + this.int(at + 32 + i * 32)));
  }
}

/** Long-zero EVM address → "0.0.x"; WHBAR → "HBAR"; anything else stays an EVM address. */
function tokenOf(evm: string, ledger: "mainnet" | "testnet"): string {
  const h = evm.toLowerCase().replace(/^0x/, "");
  if (!/^0{24}/.test(h)) return `0x${h}`;
  const id = `0.0.${BigInt(`0x${h.slice(24)}`).toString()}`;
  return id === SAUCERSWAP[ledger].whbarToken ? "HBAR" : id;
}

function v3Path(p: Uint8Array): string[] {
  if (p.length < 43 || (p.length - 20) % 23 !== 0) throw new Error("abi: bad path");
  const out: string[] = [];
  for (let o = 0; o <= p.length - 20; o += 23) out.push(`0x${hex(p.subarray(o, o + 20))}`);
  return out;
}

export function isSaucerSwapRouter(contractId: string, ledger: HederaLedger): 1 | 2 | null {
  if (ledger === "previewnet") return null;
  const d = SAUCERSWAP[ledger];
  return contractId === d.v1Router ? 1 : contractId === d.v2Router ? 2 : null;
}

/** Router's own address as long-zero EVM (V2 sends WHBAR to itself before unwrapWHBAR). */
function longZero(id: string): string {
  return `0x${BigInt(id.split(".")[2]!).toString(16).padStart(40, "0")}`;
}

/**
 * Decodes a SaucerSwap router call. Returns null if the call isn't a swap this decoder understands (callers
 * then fall back to the generic selector table / blind signing).
 */
export function decodeSaucerSwap(contractId: string, data: Uint8Array, payableTinybars: bigint, ledger: HederaLedger): SaucerSwapIntent | null {
  const version = isSaucerSwapRouter(contractId, ledger);
  if (!version || data.length < 4 || ledger === "previewnet") return null;
  const name = BY_SELECTOR.get(hex(data.subarray(0, 4)));
  if (!name) return null;
  const a = new Abi(data.subarray(4));
  const tok = (e: string) => tokenOf(e, ledger);
  try {
    if (version === 1) {
      const pathed = (p: string[], o: Omit<SaucerSwapIntent, "version" | "tokenIn" | "tokenOut" | "path">): SaucerSwapIntent | null => {
        if (p.length < 2) return null;
        const path = p.map(tok);
        return { version: 1, tokenIn: path[0]!, tokenOut: path[path.length - 1]!, path, ...o };
      };
      switch (name) {
        case "swapExactETHForTokens":
        case "swapExactETHForTokensFee":
          return pathed(a.addressArray(a.int(32)), { exactIn: true, amountIn: payableTinybars, amountOut: a.uint(0), recipient: a.address(64), deadline: a.uint(96) });
        case "swapETHForExactTokens":
          return pathed(a.addressArray(a.int(32)), { exactIn: false, amountIn: payableTinybars, amountOut: a.uint(0), recipient: a.address(64), deadline: a.uint(96) });
        case "swapExactTokensForTokens":
        case "swapExactTokensForTokensFee":
        case "swapExactTokensForETH":
        case "swapExactTokensForETHFee":
          return pathed(a.addressArray(a.int(64)), { exactIn: true, amountIn: a.uint(0), amountOut: a.uint(32), recipient: a.address(96), deadline: a.uint(128) });
        case "swapTokensForExactTokens":
        case "swapTokensForExactETH":
          return pathed(a.addressArray(a.int(64)), { exactIn: false, amountIn: a.uint(32), amountOut: a.uint(0), recipient: a.address(96), deadline: a.uint(128) });
        default:
          return null;
      }
    }

    // V2
    const single = (exactIn: boolean): SaucerSwapIntent => {
      const tokenIn = tok(a.address(0));
      const tokenOut = tok(a.address(32));
      return {
        version: 2,
        tokenIn,
        tokenOut,
        path: [tokenIn, tokenOut],
        exactIn,
        recipient: a.address(96),
        deadline: a.uint(128),
        amountIn: exactIn ? a.uint(160) : a.uint(192),
        amountOut: exactIn ? a.uint(192) : a.uint(160),
      };
    };
    const multi = (exactIn: boolean): SaucerSwapIntent => {
      const t = a.int(0); // tuple offset
      const raw = v3Path(a.bytes(t + a.int(t))).map(tok);
      const path = exactIn ? raw : [...raw].reverse();
      return {
        version: 2,
        tokenIn: path[0]!,
        tokenOut: path[path.length - 1]!,
        path,
        exactIn,
        recipient: a.address(t + 32),
        deadline: a.uint(t + 64),
        amountIn: exactIn ? a.uint(t + 96) : a.uint(t + 128),
        amountOut: exactIn ? a.uint(t + 128) : a.uint(t + 96),
      };
    };
    switch (name) {
      case "exactInputSingle":
        return single(true);
      case "exactOutputSingle":
        return single(false);
      case "exactInput":
        return multi(true);
      case "exactOutput":
        return multi(false);
      case "multicall": {
        // The SaucerSwap app sends multicall([swap, refundETH()]) for HBAR in, multicall([swap→router, unwrapWHBAR(min, me)]) for HBAR out.
        const calls = a.bytesArray(a.int(0));
        let swap: SaucerSwapIntent | null = null;
        let unwrapTo: string | null = null;
        for (const c of calls) {
          const n = BY_SELECTOR.get(hex(c.subarray(0, 4)));
          if (n === "refundETH") continue;
          if (n === "unwrapWHBAR") {
            unwrapTo = new Abi(c.subarray(4)).address(32);
            continue;
          }
          if (swap || !n || n === "multicall" || n === "sweepToken") return null; // one swap per multicall, nothing else
          swap = decodeSaucerSwap(contractId, c, payableTinybars, ledger);
          if (!swap) return null;
        }
        if (!swap) return null;
        if (unwrapTo) {
          if (swap.recipient !== longZero(contractId).toLowerCase() || swap.tokenOut !== "HBAR") return null;
          swap = { ...swap, recipient: unwrapTo };
        }
        return swap;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
