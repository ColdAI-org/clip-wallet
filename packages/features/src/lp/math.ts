/**
 * Uniswap v3 position maths in bigint (ports of v3-core TickMath.getSqrtRatioAtTick and v3-periphery
 * LiquidityAmounts.getAmountsForLiquidity). Shared by Uniswap and SaucerSwap V2 (a v3 fork).
 */
export const Q96 = 1n << 96n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
const MAX_UINT256 = (1n << 256n) - 1n;

const MULTIPLIERS: [number, bigint][] = [
  [0x2, 0xfff97272373d413259a46990580e213an],
  [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
];

export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new Error("tick out of range");
  const abs = Math.abs(tick);
  let ratio = abs & 0x1 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  for (const [bit, m] of MULTIPLIERS) if (abs & bit) ratio = (ratio * m) >> 128n;
  if (tick > 0) ratio = MAX_UINT256 / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}

function amount0(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return ((liquidity << 96n) * (sqrtB - sqrtA)) / sqrtB / sqrtA;
}

function amount1(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (liquidity * (sqrtB - sqrtA)) / Q96;
}

/** Token amounts a position holds at the pool's current price. */
export function amountsForLiquidity(sqrtPriceX96: bigint, tickLower: number, tickUpper: number, liquidity: bigint): { amount0: bigint; amount1: bigint; inRange: boolean } {
  const a = sqrtRatioAtTick(tickLower);
  const b = sqrtRatioAtTick(tickUpper);
  if (sqrtPriceX96 <= a) return { amount0: amount0(a, b, liquidity), amount1: 0n, inRange: false };
  if (sqrtPriceX96 < b) return { amount0: amount0(sqrtPriceX96, b, liquidity), amount1: amount1(a, sqrtPriceX96, liquidity), inRange: true };
  return { amount0: 0n, amount1: amount1(a, b, liquidity), inRange: false };
}
