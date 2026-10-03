import { describe, expect, it } from "vitest";
import { MAX_TICK, MIN_TICK, Q96, amountsForLiquidity, sqrtRatioAtTick } from "../src/lp/math.js";
import { decodeSlot0 } from "../src/lp/readers.js";

describe("v3 tick maths", () => {
  it("matches TickMath's known values (MIN_SQRT_RATIO, MAX_SQRT_RATIO, tick 0)", () => {
    expect(sqrtRatioAtTick(0)).toBe(Q96);
    expect(sqrtRatioAtTick(MIN_TICK)).toBe(4295128739n);
    expect(sqrtRatioAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n);
  });

  it("is monotonic and symmetric around 0", () => {
    const up = sqrtRatioAtTick(100);
    const down = sqrtRatioAtTick(-100);
    expect(up > Q96 && down < Q96).toBe(true);
    // sqrt(1.0001^100) * sqrt(1.0001^-100) = 1
    expect(Number((up * down) / Q96) / Number(Q96)).toBeCloseTo(1, 9);
  });

  it("splits liquidity into token amounts in and out of range", () => {
    const L = 10n ** 18n;
    const inRange = amountsForLiquidity(Q96, -600, 600, L);
    expect(inRange.inRange).toBe(true);
    expect(inRange.amount0 > 0n && inRange.amount1 > 0n).toBe(true);
    // Symmetric range at price 1: roughly equal amounts.
    expect(Number(inRange.amount0) / Number(inRange.amount1)).toBeCloseTo(1, 2);
    const below = amountsForLiquidity(sqrtRatioAtTick(-1000), -600, 600, L);
    expect(below).toMatchObject({ amount1: 0n, inRange: false });
    expect(below.amount0 > 0n).toBe(true);
    const above = amountsForLiquidity(sqrtRatioAtTick(1000), -600, 600, L);
    expect(above).toMatchObject({ amount0: 0n, inRange: false });
  });

  it("reads slot0's first two words (negative ticks too)", () => {
    const word = (v: bigint) => (v < 0n ? (1n << 256n) + v : v).toString(16).padStart(64, "0");
    const raw = `0x${word(Q96)}${word(-123n)}${word(0n)}` as const;
    expect(decodeSlot0(raw)).toEqual({ sqrtPriceX96: Q96, tick: -123 });
  });
});
