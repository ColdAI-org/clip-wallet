import { ClipError } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import {
  LIQUIDITY_BAKING,
  ProtocolsHash,
  TEZOS_MAINNET,
  TezosRpc,
  buildOperation,
  cpmmTokenToXtz,
  cpmmTokenToXtzOp,
  cpmmXtzToToken,
  cpmmXtzToTokenOp,
  createTezosModule,
  delegationOp,
  fa12ApproveOp,
  parseCpmmStorage,
  parseForged,
  parseUpdateOperators,
  readCpmm,
  spendPermissionOps,
  stakingOp,
  tezosSendRequest,
} from "../src/index.js";
import { BAKER, BRANCH, FA12, FA2, ME, RPC, chain, ctxFor } from "./helpers.js";
import { FIX } from "./signatures.js";

const CPMM = "KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5";
const TZBTC = "KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn";
/** Mainnet GET …/contracts/KT1TxqZ8…/storage on 2026-10-03. */
const STORAGE = {
  prim: "Pair",
  args: [{ int: "1194877609" }, { int: "3209092800671" }, { int: "22257176" }, { string: TZBTC }, { string: "KT1AafHA1C1vk959wvHWBispY9Y2f3fxBUUo" }],
};

async function forgeAndParse(ops: Parameters<typeof buildOperation>[1]) {
  const { fetch } = chain();
  const built = await buildOperation(new TezosRpc(RPC, fetch), ops, { me: ME, publicKey: FIX.edpk, chainId: "NetXsqzbfFenSTS", simulate: false, protocol: ProtocolsHash.PsUshuai9 });
  const parsed = await parseForged(built.forged);
  expect(parsed.branch).toBe(BRANCH);
  return parsed.contents;
}

describe("Liquidity Baking (Sirius) CPMM", () => {
  it("parses the storage and lists the protocol contract per network", () => {
    const s = parseCpmmStorage(CPMM, STORAGE);
    expect(s).toEqual({ address: CPMM, tokenPool: 1194877609n, xtzPool: 3209092800671n, lqtTotal: 22257176n, tokenAddress: TZBTC, lqtAddress: "KT1AafHA1C1vk959wvHWBispY9Y2f3fxBUUo" });
    expect(LIQUIDITY_BAKING[TEZOS_MAINNET.id]).toEqual({ cpmm: CPMM, token: TZBTC, tokenStandard: "fa1.2" });
    expect(() => parseCpmmStorage(CPMM, { prim: "Unit" })).toThrow(ClipError);
  });

  it("matches the contract's integer maths (burn + 0.1 % fee)", () => {
    const s = parseCpmmStorage(CPMM, STORAGE);
    expect(cpmmXtzToToken(10_000_000n, s)).toBe(3715n);
    expect(cpmmTokenToXtz(100_000n, s)).toBe(268011556n);
  });

  it("reads the cpmm address from the node", async () => {
    const f = (async (url: string) =>
      new Response(JSON.stringify(String(url).endsWith("/cpmm_address") ? CPMM : STORAGE), { status: 200 })) as unknown as typeof fetch;
    expect((await readCpmm(new TezosRpc(RPC, f))).xtzPool).toBe(3209092800671n);
  });

  it("swap and permission operations forge and parse back field by field", async () => {
    const perm = spendPermissionOps({ standard: "fa1.2", token: FA12, owner: ME, spender: CPMM, amount: 100_000n });
    expect(perm.after).toEqual([]);
    const ops = [
      ...perm.before,
      cpmmTokenToXtzOp({ cpmm: CPMM, to: ME, tokens: 100_000n, minMutez: 266_671_498n, deadline: 1_790_000_000 }),
      cpmmXtzToTokenOp({ cpmm: CPMM, to: ME, mutez: 10_000_000n, minTokens: 3696n, deadline: 1_790_000_000 }),
    ];
    const c = await forgeAndParse(ops);
    expect(c.map((o) => [o.kind, o.destination, o.amount, (o.parameters as { entrypoint: string }).entrypoint])).toEqual([
      ["transaction", FA12, "0", "approve"],
      ["transaction", FA12, "0", "approve"],
      ["transaction", CPMM, "0", "tokenToXtz"],
      ["transaction", CPMM, "10000000", "xtzToToken"],
    ]);
    const v = (i: number) => (c[i]!.parameters as { value: unknown }).value;
    expect(v(0)).toEqual({ prim: "Pair", args: [{ string: CPMM }, { int: "0" }] });
    expect(v(1)).toEqual({ prim: "Pair", args: [{ string: CPMM }, { int: "100000" }] });
    expect(v(2)).toEqual({ prim: "Pair", args: [{ string: ME }, { prim: "Pair", args: [{ int: "100000" }, { prim: "Pair", args: [{ int: "266671498" }, { int: "1790000000" }] }] }] });
    expect(v(3)).toEqual({ prim: "Pair", args: [{ string: ME }, { prim: "Pair", args: [{ int: "3696" }, { int: "1790000000" }] }] });
    expect(c.every((o) => o.source === ME)).toBe(true);
  });

  it("FA2 permission is add_operator before and remove_operator after", async () => {
    const perm = spendPermissionOps({ standard: "fa2", token: FA2, tokenId: "3", owner: ME, spender: CPMM, amount: 5n });
    const c = await forgeAndParse([...perm.before, ...perm.after]);
    expect(parseUpdateOperators((c[0]!.parameters as { value: unknown }).value)).toEqual([{ add: true, owner: ME, operator: CPMM, tokenId: "3" }]);
    expect(parseUpdateOperators((c[1]!.parameters as { value: unknown }).value)).toEqual([{ add: false, owner: ME, operator: CPMM, tokenId: "3" }]);
  });

  it("decodes approve 0 as removing permission", async () => {
    const { fetch } = chain();
    const m = createTezosModule({ simulate: false });
    const ctx = ctxFor(fetch);
    const d = await m.decode(tezosSendRequest(ctx, [fa12ApproveOp(FA12, CPMM, 0n)]), ctx);
    expect(d.title).toMatch(/^Remove .*permission to spend your/);
  });
});

describe("staking op builders", () => {
  it("stake / delegation / stop delegating forge and parse back", async () => {
    const c = await forgeAndParse([delegationOp(BAKER), stakingOp(ME, "stake", "50000000")]);
    expect(c[0]).toMatchObject({ kind: "delegation", source: ME, delegate: BAKER });
    expect(c[1]).toMatchObject({ kind: "transaction", destination: ME, amount: "50000000", parameters: { entrypoint: "stake", value: { prim: "Unit" } } });
    const stop = await forgeAndParse([delegationOp(null)]);
    expect(stop[0]!.kind).toBe("delegation");
    expect(stop[0]!.delegate).toBeUndefined();
  });

  it("buildStopDelegating: refused while staked, else a delegation without baker", async () => {
    const acct = (staked: number, delegate: unknown) => ({ match: new RegExp(`/v1/accounts/${ME}$`), reply: { address: ME, balance: 9_000_000 + staked, stakedBalance: staked, unstakedBalance: 0, delegate } });
    const m = createTezosModule({ simulate: false });
    const a = chain({ tzkt: [acct(0, { address: BAKER, alias: "Captain Stake" })] });
    const r = await m.staking.buildStopDelegating(ctxFor(a.fetch));
    expect((r.params as { operations: unknown[] }).operations).toEqual([{ kind: "delegation" }]);
    expect((await m.decode(r, ctxFor(a.fetch))).title).toBe("Stop delegating");
    const b = chain({ tzkt: [acct(5_000_000, { address: BAKER })] });
    await expect(m.staking.buildStopDelegating(ctxFor(b.fetch))).rejects.toMatchObject({ code: "tezos/still-staked" });
    const c = chain({ tzkt: [acct(0, null)] });
    await expect(m.staking.buildStopDelegating(ctxFor(c.fetch))).rejects.toMatchObject({ code: "tezos/not-delegating" });
  });
});
