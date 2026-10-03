import type { DappRequest } from "@clip-wallet/core";
import {
  type Instruction,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { beforeEach, describe, expect, it } from "vitest";
import { SOLANA_DEVNET, clearTokenCache, createSolanaModule, solAsset } from "../src/index.js";
import { DISCRIMINATORS, JUPITER_V6, ORCA_WHIRLPOOL, RAYDIUM_AMM_V4, RAYDIUM_CLMM, RAYDIUM_CPMM, WSOL_MINT, decodeSwap } from "../src/swaps.js";
import { b64encode } from "../src/util.js";
import { TOKEN, ctxFor, makeAccount, mintAccount, mockSolana, tokenAccount } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const BOB = FIX.bob;
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
/** Deterministic placeholder accounts (pools, vaults, etc.). */
const fake = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const MY_WSOL = fake(201);
const BOB_WSOL = fake(202);
const MY_BONK = fake(203);
const BONK = fake(204);

const accounts: Record<string, unknown> = {
  [USDC]: mintAccount(6, "1000000000000000"),
  [BONK]: mintAccount(5, "100000000000000"),
  [WSOL_MINT]: mintAccount(9, "0"),
  [FIX.myUsdcAta]: tokenAccount(USDC, ME, "10000000", 6),
  [MY_WSOL]: tokenAccount(WSOL_MINT, ME, "0", 9),
  [BOB_WSOL]: tokenAccount(WSOL_MINT, BOB, "0", 9),
  [MY_BONK]: tokenAccount(BONK, ME, "0", 5),
};
const rpc = (extra: Record<string, (p: unknown[]) => unknown> = {}) =>
  mockSolana({ getMultipleAccounts: (p: unknown[]) => ({ context: { slot: 1 }, value: (p[0] as string[]).map((a) => accounts[a] ?? null) }), ...extra });

const le = (v: bigint, n: number) => Array.from({ length: n }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
const disc = (h: string) => h.match(/../g)!.map((x) => parseInt(x, 16));
const ix = (program: string, accs: string[], data: number[], signerIdx: number[] = []): Instruction => ({
  programAddress: address(program),
  accounts: accs.map((a, i) => ({ address: address(a), role: signerIdx.includes(i) ? 3 : a === program ? 0 : 1 })),
  data: new Uint8Array(data),
});

function wire(ixs: Instruction[]): string {
  const m = pipe(
    createTransactionMessage({ version: 0 }),
    (x) => setTransactionMessageFeePayer(address(ME), x),
    (x) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: FIX.blockhash as never, lastValidBlockHeight: 100n }, x),
    (x) => appendTransactionMessageInstructions(ixs, x),
  );
  return b64encode(new Uint8Array(getTransactionEncoder().encode(compileTransaction(m))));
}
const req = (tx: string): DappRequest => ({
  id: "r",
  origin: "https://jup.ag",
  via: "injected",
  family: "solana",
  networkId: SOLANA_DEVNET.id,
  method: "solana:signAndSendTransaction",
  params: { inputs: [{ account: ME, transaction: tx, chain: "solana:devnet" }] },
});

async function decode(ixs: Instruction[], extra: Record<string, (p: unknown[]) => unknown> = {}, simulate = false) {
  const m = createSolanaModule({ simulate });
  return m.decode(req(wire(ixs)), ctxFor(makeAccount(ME), rpc(extra).fetch));
}

/** Jupiter route: USDC (my ATA) → wSOL, exact in 2.5 USDC, at least 0.01 SOL, 0.5% slippage. */
function jupRoute(opts: { dest?: string; authority?: string } = {}) {
  const routePlan = [1, 0, 0, 0, /* one step */ 7, 100, 0, 1];
  return ix(
    JUPITER_V6,
    [TOKEN, opts.authority ?? ME, FIX.myUsdcAta, MY_WSOL, opts.dest ?? JUPITER_V6, WSOL_MINT, JUPITER_V6, fake(9), JUPITER_V6],
    [...disc(DISCRIMINATORS.route), ...routePlan, ...le(2_500_000n, 8), ...le(10_000_000n, 8), ...le(50n, 2), 0],
    [1],
  );
}

beforeEach(() => clearTokenCache());

describe("swap layouts", () => {
  it("Anchor discriminators are sha256('global:<name>')[0..8]", async () => {
    const names: [keyof typeof DISCRIMINATORS, string][] = [
      ["route", "route"],
      ["routeWithTokenLedger", "route_with_token_ledger"],
      ["sharedAccountsRoute", "shared_accounts_route"],
      ["sharedAccountsRouteWithTokenLedger", "shared_accounts_route_with_token_ledger"],
      ["exactOutRoute", "exact_out_route"],
      ["sharedAccountsExactOutRoute", "shared_accounts_exact_out_route"],
      ["swap", "swap"],
      ["swapV2", "swap_v2"],
      ["swapBaseInput", "swap_base_input"],
      ["swapBaseOutput", "swap_base_output"],
    ];
    for (const [k, n] of names) {
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`global:${n}`)));
      expect([...h.subarray(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")).toBe(DISCRIMINATORS[k]);
    }
  });

  it("Jupiter exact-out caps the input at quoted_in × (1 + slippage)", () => {
    const s = decodeSwap(
      ix(JUPITER_V6, [TOKEN, ME, FIX.myUsdcAta, MY_WSOL, JUPITER_V6, USDC, WSOL_MINT, JUPITER_V6, JUPITER_V6, fake(9), JUPITER_V6], [
        ...disc(DISCRIMINATORS.exactOutRoute), 0, 0, 0, 0, ...le(10_000_000n, 8), ...le(2_000_000n, 8), ...le(100n, 2), 0,
      ]),
    )!;
    expect(s).toMatchObject({ venue: "Jupiter", exactIn: false, amountOut: 10_000_000n, amountIn: 2_020_000n, sourceMint: USDC, destinationMint: WSOL_MINT, slippageBps: 100 });
  });

  it("unknown instructions of known programs aren't swaps", () => {
    expect(decodeSwap(ix(JUPITER_V6, [ME], [1, 2, 3]))).toBeNull();
    expect(decodeSwap(ix(RAYDIUM_AMM_V4[0]!, [ME], [9, ...le(1n, 8), ...le(1n, 8)]))).toBeNull(); // wrong account count
  });
});

describe("decoded swaps aren't blind", () => {
  it("Jupiter route: plain title from the instruction, input in balance changes", async () => {
    const d = await decode([jupRoute()]);
    expect(d.blind).toBe(false);
    // quoted 0.01 SOL, 0.5% slippage → at least 0.00995 SOL
    expect(d.title).toBe("Swap 2.5 USDC for at least 0.00995 SOL on Jupiter");
    expect(d.lines).toEqual(
      expect.arrayContaining([
        { label: "Swap on", value: "Jupiter" },
        { label: "You pay", value: "2.5 USDC" },
        { label: "You get", value: "at least 0.00995 SOL" },
        { label: "Price can move", value: "up to 0.5%" },
      ]),
    );
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc" }), delta: "-2500000" }]);
    expect(d.warnings.map((w) => w.code)).not.toContain("blind-signing");
  });

  it("simulation gives the real amounts in the title", async () => {
    const d = await decode(
      [jupRoute()],
      {
        simulateTransaction: () => ({
          context: { slot: 1 },
          value: {
            err: null,
            fee: 5000,
            preBalances: [1_000_000_000],
            postBalances: [1_000_000_000 - 5000 + 10_200_000],
            preTokenBalances: [{ accountIndex: 1, mint: USDC, owner: ME, uiTokenAmount: { amount: "10000000", decimals: 6 } }],
            postTokenBalances: [{ accountIndex: 1, mint: USDC, owner: ME, uiTokenAmount: { amount: "7500000", decimals: 6 } }],
            loadedAddresses: { writable: [], readonly: [] },
          },
        }),
      },
      true,
    );
    expect(d.simulated).toBe(true);
    expect(d.title).toBe("Swap 2.5 USDC for 0.0102 SOL on Jupiter");
    expect(d.balanceChanges).toEqual([
      { asset: solAsset(SOLANA_DEVNET.id), delta: "10200000" },
      { asset: expect.objectContaining({ key: "usdc" }), delta: "-2500000" },
    ]);
  });

  it("output going to someone else is a danger warning", async () => {
    const d = await decode([jupRoute({ dest: BOB_WSOL })]);
    expect(d.lines).toContainEqual({ label: "Sends what you get to", value: BOB });
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "new-recipient" }));
  });

  it("a swap paid from someone else's account stays blind", async () => {
    const d = await decode([jupRoute({ authority: BOB })]);
    expect(d.blind).toBe(true);
  });

  it("Jupiter sharedAccountsRoute", async () => {
    const d = await decode([
      ix(
        JUPITER_V6,
        [TOKEN, fake(10), ME, FIX.myUsdcAta, fake(11), fake(12), MY_BONK, USDC, BONK, JUPITER_V6, JUPITER_V6, fake(9), JUPITER_V6],
        [...disc(DISCRIMINATORS.sharedAccountsRoute), 3, 0, 0, 0, 0, ...le(1_000_000n, 8), ...le(123_45000n, 8), ...le(0n, 2), 0],
        [2],
      ),
    ]);
    expect(d.title).toBe(`Swap 1 USDC for at least 123.45 ${BONK.slice(0, 4)}…${BONK.slice(-4)} on Jupiter`);
    expect(d.blind).toBe(false);
  });

  it("Raydium AMM v4 SwapBaseIn (18 accounts)", async () => {
    const accs = [TOKEN, ...Array.from({ length: 14 }, (_, i) => fake(20 + i)), FIX.myUsdcAta, MY_WSOL, ME];
    const d = await decode([ix(RAYDIUM_AMM_V4[1]!, accs, [9, ...le(3_000_000n, 8), ...le(5_000_000n, 8)], [17])]);
    expect(d.title).toBe("Swap 3 USDC for at least 0.005 SOL on Raydium");
    expect(d.blind).toBe(false);
  });

  it("Raydium CPMM swap_base_output (exact out)", async () => {
    const accs = [ME, fake(40), fake(41), fake(42), FIX.myUsdcAta, MY_WSOL, fake(43), fake(44), TOKEN, TOKEN, USDC, WSOL_MINT, fake(45)];
    const d = await decode([ix(RAYDIUM_CPMM[1]!, accs, [...disc(DISCRIMINATORS.swapBaseOutput), ...le(4_000_000n, 8), ...le(20_000_000n, 8)], [0])]);
    expect(d.title).toBe("Swap up to 4 USDC for 0.02 SOL on Raydium");
  });

  it("Raydium CLMM swap_v2", async () => {
    const accs = [ME, fake(50), fake(51), FIX.myUsdcAta, MY_BONK, fake(52), fake(53), fake(54), TOKEN, fake(55), fake(56), USDC, BONK];
    const data = [...disc(DISCRIMINATORS.swapV2), ...le(500_000n, 8), ...le(1_000_000n, 8), ...new Array(16).fill(0), 1];
    const d = await decode([ix(RAYDIUM_CLMM[0]!, accs, data, [0])]);
    expect(d.title).toBe(`Swap 0.5 USDC for at least 10 ${BONK.slice(0, 4)}…${BONK.slice(-4)} on Raydium`);
  });

  it("Orca Whirlpool swap, b→a", async () => {
    // token_owner_account_a = my wSOL, token_owner_account_b = my USDC; a_to_b=false → pay USDC, get SOL
    const accs = [TOKEN, ME, fake(60), MY_WSOL, fake(61), FIX.myUsdcAta, fake(62), fake(63), fake(64), fake(65), fake(66)];
    const data = [...disc(DISCRIMINATORS.swap), ...le(1_500_000n, 8), ...le(7_000_000n, 8), ...new Array(16).fill(0), 1, 0];
    const d = await decode([ix(ORCA_WHIRLPOOL, accs, data, [1])]);
    expect(d.title).toBe("Swap 1.5 USDC for at least 0.007 SOL on Orca");
    expect(d.blind).toBe(false);
  });

  it("a known swap next to an unknown program is still blind", async () => {
    const d = await decode([jupRoute(), ix(fake(99), [ME], [1])]);
    expect(d.blind).toBe(true);
    expect(d.title).toBe("Approve an app transaction");
  });
});

describe("Jupiter Swap API v2 transactions (route_v2 family + helper instructions)", () => {
  const v2 = (exactIn: boolean, a: bigint, b: bigint, slip: bigint) => [
    ...disc(exactIn ? DISCRIMINATORS.routeV2 : DISCRIMINATORS.exactOutRouteV2),
    ...le(a, 8), ...le(b, 8), ...le(slip, 2), ...le(0n, 2), ...le(0n, 2),
    1, 0, 0, 0, /* one RoutePlanStepV2 (opaque here) */ 7, 0, 0, 1, 0x10, 0x27,
  ];

  it("a typical order: create wSOL ATA (Jupiter helper), route_v2 USDC→SOL, close wSOL → described, not blind", async () => {
    const createAta = ix(JUPITER_V6, [ME, MY_WSOL, ME, WSOL_MINT, "11111111111111111111111111111111", TOKEN, JUPITER_V6], [...disc(DISCRIMINATORS.jupCreateIdempotentAta)], [0]);
    const route = ix(
      JUPITER_V6,
      [ME, FIX.myUsdcAta, MY_WSOL, USDC, WSOL_MINT, TOKEN, TOKEN, JUPITER_V6, fake(9), JUPITER_V6],
      v2(true, 2_500_000n, 10_000_000n, 100n),
      [0],
    );
    const close = ix(JUPITER_V6, [MY_WSOL, ME, TOKEN, "11111111111111111111111111111111"], [...disc(DISCRIMINATORS.jupCloseWsolAccount)], [1]);
    const d = await decode([createAta, route, close]);
    expect(d.blind).toBe(false);
    expect(d.title).toBe("Swap 2.5 USDC for at least 0.0099 SOL on Jupiter");
    expect(d.lines).toContainEqual({ label: "Unwraps", value: "Your wrapped SOL back to SOL" });
    expect(d.lines).toContainEqual({ label: "Price can move", value: "up to 1%" });
  });

  it("exact_out_route_v2 caps the input", () => {
    const s = decodeSwap(ix(JUPITER_V6, [ME, FIX.myUsdcAta, MY_WSOL, USDC, WSOL_MINT, TOKEN, TOKEN, JUPITER_V6, fake(9), JUPITER_V6], v2(false, 10_000_000n, 2_000_000n, 50n)))!;
    expect(s).toMatchObject({ exactIn: false, amountOut: 10_000_000n, amountIn: 2_010_000n, sourceMint: USDC, destinationMint: WSOL_MINT, destinationAccount: MY_WSOL });
  });

  it("shared_accounts_route_v2 reads id + fixed args first", () => {
    const data = [...disc(DISCRIMINATORS.sharedAccountsRouteV2), 4, ...le(1_000_000n, 8), ...le(5_000_000n, 8), ...le(0n, 2), ...le(0n, 2), ...le(0n, 2), 0, 0, 0, 0];
    const s = decodeSwap(ix(JUPITER_V6, [fake(10), ME, FIX.myUsdcAta, fake(11), fake(12), MY_BONK, USDC, BONK, TOKEN, TOKEN, fake(9), JUPITER_V6], data))!;
    expect(s).toMatchObject({ authority: ME, amountIn: 1_000_000n, amountOut: 5_000_000n, sourceMint: USDC, destinationMint: BONK, destinationAccount: MY_BONK });
  });

  it("other Jupiter instructions (claim etc.) stay blind", async () => {
    const d = await decode([ix(JUPITER_V6, [ME, fake(5), "11111111111111111111111111111111"], [0x3e, 0xc6, 0xd6, 0xc1, 0xd5, 0x9f, 0x6c, 0xd2, 0], [0])]);
    expect(d.blind).toBe(true);
  });
});
