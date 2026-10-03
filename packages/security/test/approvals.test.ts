import { AccountAllowanceApproveTransaction, Transaction } from "@hiero-ledger/sdk";
import { refineDecoded } from "@clip-wallet/features";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, pad, parseAbi, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { EvmApprovals, PERMIT2, PERMIT2_ABI, TOPIC, pairsFromLogs, verifyLockdown, type RawLog } from "../src/approvals/evm.js";
import { HederaApprovals } from "../src/approvals/hedera.js";
import { ApprovalsService } from "../src/approvals/service.js";
import { SolanaApprovals } from "../src/approvals/solana.js";
import { risksFor } from "../src/approvals/types.js";
import { APTOS, DEVNET, HEDERA, ME_EVM, ME_HEDERA, ME_SOL, SEPOLIA, SEPOLIA_NO_INDEXER, accountFor, fakeHost, flush, mockFetch } from "./helpers.js";

const NOW = Date.parse("2026-10-03T00:00:00Z");
const DAY = 86_400_000;
const USDC = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const DAI = "0xdDdDddDdDdDDdDddDDdDDDDDDdDDDdDDdDDDDDDd";
const NFT = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
const UNISWAP = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
const CONDUIT = "0x1E0049783F008A0085193E00003D00cd54003c71";
const STRANGER = "0x5555555555555555555555555555555555555555";
const OTHER_OWNER = "0x6666666666666666666666666666666666666666";
const MAX = 2n ** 256n - 1n;

const t = (a: string) => pad(a.toLowerCase() as Hex);
const w = (v: bigint) => pad(`0x${v.toString(16)}` as Hex).slice(2);
const sec = (ms: number) => String(Math.floor(ms / 1000));

let li = 0;
function log(address: string, topics: string[], data: string, block: number, at: number): RawLog {
  return { address: address.toLowerCase(), topics, data: data.startsWith("0x") ? data : `0x${data}`, blockNumber: `0x${block.toString(16)}`, logIndex: `0x${(li++).toString(16)}`, timeStamp: `0x${Number(sec(at)).toString(16)}`, transactionHash: `0x${block.toString(16).padStart(64, "0")}` };
}

const LOGS: RawLog[] = [
  log(USDC, [TOPIC.approval, t(ME_EVM), t(STRANGER)], w(MAX), 100, NOW - 10 * DAY),
  log(USDC, [TOPIC.approval, t(ME_EVM), t(UNISWAP)], w(100_000_000n), 50, NOW - 400 * DAY),
  log(DAI, [TOPIC.approval, t(ME_EVM), t(UNISWAP)], w(10n ** 20n), 60, NOW - 300 * DAY),
  log(DAI, [TOPIC.approval, t(OTHER_OWNER), t(UNISWAP)], w(MAX), 61, NOW - 300 * DAY),
  log(NFT, [TOPIC.approvalForAll, t(ME_EVM), t(CONDUIT)], w(1n), 70, NOW - 20 * DAY),
  log(NFT, [TOPIC.approvalForAll, t(ME_EVM), t(STRANGER)], w(1n), 71, NOW - 20 * DAY),
  log(NFT, [TOPIC.approvalForAll, t(ME_EVM), t(STRANGER)], w(0n), 72, NOW - 19 * DAY),
  // ERC-721 single-token Approval (4 topics) is skipped.
  log(NFT, [TOPIC.approval, t(ME_EVM), t(STRANGER), pad("0x7")], "0x", 73, NOW - 19 * DAY),
  log(PERMIT2, [TOPIC.permit2Approval, t(ME_EVM), t(USDC), t(UNISWAP)], w(2n ** 160n - 1n) + w(BigInt(sec(NOW + 30 * DAY))), 80, NOW - 5 * DAY),
  log(PERMIT2, [TOPIC.permit2Permit, t(ME_EVM), t(DAI), t(UNISWAP)], w(5n) + w(BigInt(sec(NOW - DAY))) + w(0n), 81, NOW - 5 * DAY),
];

const NFT_ABI = parseAbi(["function isApprovedForAll(address owner, address operator) view returns (bool)", "function name() view returns (string)"]);

/** eth_call against the fixture chain state. */
function ethCall(params: unknown[]): Hex {
  const { to, data } = params[0] as { to: string; data: Hex };
  const target = to.toLowerCase();
  if (target === PERMIT2.toLowerCase()) {
    const d = decodeFunctionData({ abi: PERMIT2_ABI, data });
    const [, token] = d.args as [string, string, string];
    const live = token.toLowerCase() === USDC.toLowerCase();
    return encodeFunctionResult({ abi: PERMIT2_ABI, functionName: "allowance", result: live ? [2n ** 160n - 1n, Number(sec(NOW + 30 * DAY)), 0] : [5n, Number(sec(NOW - DAY)), 1] });
  }
  if (target === NFT.toLowerCase()) {
    const d = decodeFunctionData({ abi: NFT_ABI, data });
    if (d.functionName === "name") return encodeFunctionResult({ abi: NFT_ABI, functionName: "name", result: "Pudgy Pals" });
    const op = (d.args as [string, string])[1].toLowerCase();
    return encodeFunctionResult({ abi: NFT_ABI, functionName: "isApprovedForAll", result: op === CONDUIT.toLowerCase() });
  }
  const d = decodeFunctionData({ abi: erc20Abi, data });
  if (d.functionName === "allowance") {
    const spender = (d.args as [string, string])[1].toLowerCase();
    const v = target === USDC.toLowerCase() ? (spender === STRANGER.toLowerCase() ? MAX : 100_000_000n) : 0n;
    return encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: v });
  }
  if (d.functionName === "symbol") return encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: target === USDC.toLowerCase() ? "USDC" : "DAI" });
  if (d.functionName === "name") return encodeFunctionResult({ abi: erc20Abi, functionName: "name", result: "Token" });
  if (d.functionName === "decimals") return encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: target === USDC.toLowerCase() ? 6 : 18 });
  throw { code: 3, message: "execution reverted" };
}

function blockscout(url: string) {
  const q = new URL(url).searchParams;
  expect(q.get("topic1")).toBe(t(ME_EVM));
  expect(q.get("topic0_1_opr")).toBe("and");
  const addr = q.get("address");
  return { message: "OK", status: "1", result: LOGS.filter((l) => l.topics[0] === q.get("topic0") && (!addr || l.address === addr.toLowerCase())) };
}

const scanOpts = { now: NOW, oldAfterDays: 180, isFlagged: (a: string) => a.toLowerCase() === STRANGER.toLowerCase(), evm: { lookbackBlocks: 200_000, maxBlockRange: 10_000 } };

describe("EVM permissions", () => {
  it("folds grant logs per (token, spender), only for you", () => {
    const pairs = pairsFromLogs(LOGS, ME_EVM);
    expect(pairs.map((p) => `${p.kind}:${p.token.slice(0, 6)}:${p.spender.slice(0, 6)}`.toLowerCase()).sort()).toEqual(
      ["erc20:0xaaaa:0x5555", "erc20:0xaaaa:0x3fc9", "erc20:0xdddd:0x3fc9", "nft-all:0xbbbb:0x1e00", "nft-all:0xbbbb:0x5555", "permit2:0xaaaa:0x3fc9", "permit2:0xdddd:0x3fc9"].sort(),
    );
    expect(pairs.find((p) => p.kind === "nft-all" && p.spender === STRANGER)!.values).toEqual([1n, 0n]);
  });

  it("lists live grants from Blockscout logs + on-chain reads, with names and risks", async () => {
    const { fetch, calls } = mockFetch([[/blockscout\.test\/api\?/, blockscout]], { eth_call: ethCall });
    const r = await new EvmApprovals().scan({ network: SEPOLIA, account: accountFor(SEPOLIA), fetch }, scanOpts);
    expect(r.partial).toEqual([]);
    const byTitle = Object.fromEntries(r.grants.map((g) => [g.view.title, g.view]));
    expect(Object.keys(byTitle).sort()).toEqual(
      [
        "An unknown app can spend all your USDC",
        "Uniswap can spend up to 100 USDC",
        "OpenSea can move every NFT you hold in Pudgy Pals",
        "Uniswap can spend all your USDC through Permit2",
      ].sort(),
    );
    const stranger = byTitle["An unknown app can spend all your USDC"]!;
    expect(stranger.riskLevel).toBe("high");
    expect(stranger.risks.map((x) => x.code)).toEqual(["flagged-spender", "unlimited", "unknown-spender"]);
    const uni = byTitle["Uniswap can spend up to 100 USDC"]!;
    expect(uni.risks.map((x) => x.code)).toEqual(["old", "unused"]);
    expect(uni.risks[0]!.label).toBe("Set over a year ago");
    expect(uni.spender).toEqual({ address: UNISWAP, name: "Uniswap", known: true });
    expect(byTitle["Uniswap can spend all your USDC through Permit2"]!.expiresAt).toBe(Number(sec(NOW + 30 * DAY)) * 1000);
    expect(r.grants.every((g) => g.view.networkId === SEPOLIA.id)).toBe(true);
    // Four indexer queries (Approval, ApprovalForAll, Permit2 Approval, Permit2 Permit).
    expect(calls.filter((c) => c.url.includes("blockscout"))).toHaveLength(4);
  });

  it("falls back to eth_getLogs in chunks, halving on 'range too large', and says when only recent history was checked", async () => {
    const ranges: [number, number][] = [];
    const { fetch } = mockFetch([], {
      eth_blockNumber: () => "0x186a0", // 100 000
      eth_getLogs: (params) => {
        const f = params[0] as { fromBlock: string; toBlock: string; topics: unknown[] };
        const from = Number(f.fromBlock);
        const to = Number(f.toBlock);
        if (to - from + 1 > 5000) throw { code: -32005, message: "query returned more than 10000 results" };
        ranges.push([from, to]);
        expect((f.topics[0] as string[]).length).toBe(4);
        return LOGS.filter((l) => Number(l.blockNumber) + 90_000 >= from && Number(l.blockNumber) + 90_000 <= to).map((l) => ({ ...l, timeStamp: undefined }));
      },
      eth_call: ethCall,
    });
    const r = await new EvmApprovals().scan({ network: SEPOLIA_NO_INDEXER, account: accountFor(SEPOLIA), fetch }, { ...scanOpts, evm: { lookbackBlocks: 20_000, maxBlockRange: 10_000 } });
    expect(ranges[0]).toEqual([80_000, 84_999]);
    expect(ranges.at(-1)![1]).toBe(100_000);
    expect(r.partial[0]!.message).toBe("On Ethereum Sepolia only recent permissions could be checked. Older ones may still be there.");
    expect(r.grants).toHaveLength(4);
    expect(r.grants.every((g) => g.view.grantedAt === undefined)).toBe(true);
  });

  it("revokes: approve(spender, 0), setApprovalForAll(false), one Permit2 lockdown", async () => {
    const { fetch } = mockFetch([[/blockscout\.test\/api\?/, blockscout]], { eth_call: ethCall });
    const ctx = { network: SEPOLIA, account: accountFor(SEPOLIA), fetch };
    const s = new EvmApprovals();
    const { grants } = await s.scan(ctx, scanOpts);
    const steps = await s.revoke(grants, ctx);
    expect(steps.map((x) => x.title).sort()).toEqual(
      ["Stop 0x5555…5555 from spending your USDC", "Stop Uniswap from spending your USDC", "Stop OpenSea from moving your Pudgy Pals NFTs", "Remove 1 Permit2 permission"].sort(),
    );
    for (const step of steps) {
      const req = step.request as { method: string; origin: string; params: { from: string; to: string; data: Hex; value: string }[] };
      expect(req).toMatchObject({ method: "eth_sendTransaction", origin: "wallet" });
      expect(req.params[0]!.value).toBe("0x0");
      if (step.title.startsWith("Stop Uniswap")) {
        const d = decodeFunctionData({ abi: erc20Abi, data: req.params[0]!.data });
        expect(d).toMatchObject({ functionName: "approve", args: [UNISWAP, 0n] });
        expect(req.params[0]!.to).toBe(USDC);
      }
      if (step.title.startsWith("Stop OpenSea")) {
        const d = decodeFunctionData({ abi: parseAbi(["function setApprovalForAll(address operator, bool approved)"]), data: req.params[0]!.data });
        expect(d.args).toEqual([CONDUIT, false]);
      }
      if (step.title.startsWith("Remove")) {
        expect(req.params[0]!.to).toBe(PERMIT2);
        expect(step.verify!(step.request as never)).toBe(true);
      }
    }
  });

  it("the Permit2 step is checked against its bytes before its blind decode is lifted", async () => {
    const pairs = [{ token: USDC, spender: UNISWAP }];
    const { fetch } = mockFetch([[/blockscout\.test\/api\?/, blockscout]], { eth_call: ethCall });
    const ctx = { network: SEPOLIA, account: accountFor(SEPOLIA), fetch };
    const s = new EvmApprovals();
    const g = (await s.scan(ctx, scanOpts)).grants.filter((x) => x.view.kind === "permit2");
    const [step] = await s.revoke(g, ctx);
    const req = step!.request as never as { params: { data: Hex; to: string; from: string }[] };
    expect(verifyLockdown(req as never, ME_EVM, pairs)).toBe(true);
    expect(verifyLockdown({ ...(req as object), params: [{ ...req.params[0]!, to: STRANGER }] } as never, ME_EVM, pairs)).toBe(false);
    expect(verifyLockdown(req as never, ME_EVM, [{ token: DAI, spender: UNISWAP }])).toBe(false);
    expect(verifyLockdown({ ...(req as object), params: [{ ...req.params[0]!, value: "0x1" }] } as never, ME_EVM, pairs)).toBe(false);

    // Through the service: queued with its intent, and refineDecoded lifts the blind decode only with a clean dry run.
    const host = fakeHost({ networks: [SEPOLIA], fetch, now: () => NOW });
    const svc = new ApprovalsService(host);
    const view = await svc.scan();
    await svc.revoke(view.grants.filter((x) => x.kind === "permit2").map((x) => x.id));
    const queued = host.enqueued[0]!.request;
    const blind = { requestId: "x", title: "Unreadable", lines: [], balanceChanges: [], simulated: true, blind: true, warnings: [{ level: "danger" as const, code: "blind-signing" as const, message: "?" }], networkId: SEPOLIA.id };
    expect(refineDecoded(queued, blind)).toMatchObject({ blind: false, title: "Remove 1 Permit2 permission" });
    expect(refineDecoded(queued, { ...blind, simulated: false })).toMatchObject({ blind: true });
  });
});

describe("Solana delegates", () => {
  const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const DELEGATE = "Dele9atePubkey1111111111111111111111111111";
  const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const ACCT = "TokAcct111111111111111111111111111111111111";

  function rpc() {
    return mockFetch([], {
      getTokenAccountsByOwner: (params) => {
        const program = (params[1] as { programId: string }).programId;
        if (program !== TOKENKEG) return { value: [] };
        return {
          value: [
            { pubkey: ACCT, account: { lamports: 2039280, owner: TOKENKEG, data: { parsed: { type: "account", info: { mint: MINT, owner: ME_SOL, state: "initialized", tokenAmount: { amount: "5000000", decimals: 6 }, delegate: DELEGATE, delegatedAmount: { amount: "18446744073709551615" } } } } } },
            { pubkey: "TokAcct222222222222222222222222222222222222", account: { lamports: 2039280, owner: TOKENKEG, data: { parsed: { type: "account", info: { mint: MINT, owner: ME_SOL, state: "initialized", tokenAmount: { amount: "1", decimals: 6 } } } } } },
          ],
        };
      },
      getLatestBlockhash: () => ({ value: { blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", lastValidBlockHeight: 1000 } }),
    });
  }

  it("lists token accounts with a delegate and revokes with the token program's Revoke", async () => {
    const { fetch } = rpc();
    const ctx = { network: DEVNET, account: accountFor(DEVNET), fetch };
    const s = new SolanaApprovals(() => [{ key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: DEVNET.id, address: MINT }]);
    const { grants } = await s.scan(ctx, scanOpts);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.view).toMatchObject({ kind: "spl-delegate", title: "An unknown app can spend all your USDC", amount: "All your USDC", unlimited: true, riskLevel: "high" });
    const [step] = await s.revoke(grants, ctx);
    expect(step!.title).toBe("Remove 1 spending permission");
    const req = (await (step!.request as () => Promise<{ method: string; params: { inputs: { transaction: string }[] } }>)());
    expect(req.method).toBe("solana:signAndSendTransaction");
    const [tx] = getTransactionDecoder().read(Buffer.from(req.params.inputs[0]!.transaction, "base64"), 0);
    const [msg] = getCompiledTransactionMessageDecoder().read(tx.messageBytes, 0);
    const m = msg as unknown as { staticAccounts: string[]; instructions: { programAddressIndex: number; data?: Uint8Array }[]; header: { numSignerAccounts: number } };
    expect(m.header.numSignerAccounts).toBe(1);
    expect(m.staticAccounts[0]).toBe(ME_SOL);
    expect(m.instructions).toHaveLength(1);
    expect(m.staticAccounts[m.instructions[0]!.programAddressIndex]).toBe(TOKENKEG);
    expect([...m.instructions[0]!.data!]).toEqual([5]); // Revoke
  });
});

describe("Hedera allowances", () => {
  const MIRROR = /testnet\.mirrornode\.hedera\.com/;
  const ROUTER = "0.0.1414040"; // SaucerSwap V2 router (testnet)
  const routes = (): Parameters<typeof mockFetch>[0] => [
    [/\/accounts\/0\.0\.1001\/allowances\/crypto/, { allowances: [{ owner: ME_HEDERA, spender: "0.0.7777", amount: 500_000_000, amount_granted: 500_000_000, timestamp: { from: sec(NOW - 400 * DAY) } }, { owner: ME_HEDERA, spender: "0.0.8888", amount: 0, amount_granted: 10 }], links: { next: null } }],
    [/\/accounts\/0\.0\.1001\/allowances\/tokens/, { allowances: [{ owner: ME_HEDERA, spender: ROUTER, token_id: "0.0.1183558", amount: 9_000_000_000_000_000_000, amount_granted: 9_000_000_000_000_000_000, timestamp: { from: sec(NOW - DAY) } }], links: { next: null } }],
    [/\/accounts\/0\.0\.1001\/allowances\/nfts/, { allowances: [{ owner: ME_HEDERA, spender: "0.0.9999", token_id: "0.0.5555", approved_for_all: true, timestamp: { from: sec(NOW - DAY) } }, { owner: ME_HEDERA, spender: "0.0.9998", token_id: "0.0.5555", approved_for_all: false }], links: { next: null } }],
    [/\/tokens\/0\.0\.1183558$/, { token_id: "0.0.1183558", name: "SAUCE", symbol: "SAUCE", decimals: "6", type: "FUNGIBLE_COMMON", total_supply: "1000000000000000" }],
    [/\/tokens\/0\.0\.5555$/, { token_id: "0.0.5555", name: "Hbar Heads", symbol: "HH", decimals: "0", type: "NON_FUNGIBLE_UNIQUE" }],
  ];

  it("lists HBAR, token and approved-for-all NFT allowances from the mirror node", async () => {
    const { fetch, calls } = mockFetch(routes());
    const { grants } = await new HederaApprovals().scan({ network: HEDERA, account: accountFor(HEDERA), fetch }, scanOpts);
    expect(grants.map((g) => g.view.title)).toEqual(["An unknown app can spend up to 5 HBAR", "SaucerSwap can spend all your SAUCE", "An unknown app can move every NFT you hold in Hbar Heads"]);
    expect(grants[0]!.view.risks.map((r) => r.code)).toEqual(["unknown-spender", "old", "unused"]);
    expect(grants[1]!.view.riskLevel).toBe("medium");
    expect(calls.every((c) => MIRROR.test(c.url))).toBe(true);
  });

  it("revokes all three in one AccountAllowanceApprove (amounts 0, delete-all-serials)", async () => {
    const { fetch } = mockFetch(routes());
    const ctx = { network: HEDERA, account: accountFor(HEDERA), fetch };
    const s = new HederaApprovals();
    const { grants } = await s.scan(ctx, scanOpts);
    const steps = await s.revoke(grants, ctx);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.title).toBe("Remove 3 spending permissions");
    const req = await (steps[0]!.request as () => Promise<{ method: string; params: { transactionList: string } }>)();
    expect(req.method).toBe("hedera_signAndExecuteTransaction");
    const tx = Transaction.fromBytes(Buffer.from(req.params.transactionList, "base64")) as AccountAllowanceApproveTransaction;
    expect(tx).toBeInstanceOf(AccountAllowanceApproveTransaction);
    expect(tx.hbarApprovals[0]!.spenderAccountId!.toString()).toBe("0.0.7777");
    expect(tx.hbarApprovals[0]!.amount!.toTinybars().toString()).toBe("0");
    expect(tx.tokenApprovals[0]!.amount!.toString()).toBe("0");
    expect(tx.tokenNftApprovals[0]!.allSerials).toBe(false);
    expect(tx.tokenNftApprovals[0]!.spenderAccountId!.toString()).toBe("0.0.9999");
  });
});

describe("ApprovalsService", () => {
  it("scans every network, notes families without permissions, sorts by risk, and queues revokes in order", async () => {
    const m = mockFetch([[/blockscout\.test\/api\?/, blockscout]], { eth_call: ethCall });
    const host = fakeHost({ networks: [SEPOLIA, APTOS], fetch: m.fetch, now: () => NOW });
    const svc = new ApprovalsService(host, { testnet: true }, (a) => a.toLowerCase() === STRANGER.toLowerCase());
    const view = await svc.scan();
    expect(view.notes).toEqual(["Aptos tokens can't be spent by an app unless you sign each time, so there's nothing to remove there."]);
    expect(view.grants[0]!.riskLevel).toBe("high");
    expect(view.scannedAt).toBe(NOW);

    const q = await svc.revoke(view.grants.map((g) => g.id));
    expect(q.steps).toHaveLength(4);
    expect(host.enqueued).toHaveLength(1); // one at a time on the approval path
    host.enqueued[0]!.resolve("0xhash");
    await flush();
    expect(host.enqueued).toHaveLength(2);
    expect(host.enqueued.every((e) => e.appName === "Clip Wallet")).toBe(true);
  });

  it("a network that can't be reached is reported plainly, others still show", async () => {
    const m = mockFetch([[/blockscout\.test\/api\?/, { error: "down" }, 503]], { eth_call: ethCall });
    const host = fakeHost({ networks: [SEPOLIA], fetch: m.fetch, now: () => NOW });
    const view = await new ApprovalsService(host).scan();
    expect(view.partial).toEqual([{ code: "approvals/unreachable", network: "Ethereum Sepolia", message: "Couldn't check Ethereum Sepolia right now. Try again in a moment." }]);
    await expect(new ApprovalsService(host).revoke(["nope"])).rejects.toMatchObject({ code: "approvals/none" });
  });

  it("risk rules", () => {
    expect(risksFor({ unlimited: false, spenderKnown: true, flagged: false, now: NOW, oldAfterDays: 180 })).toEqual({ risks: [], riskLevel: "low" });
    expect(risksFor({ unlimited: true, spenderKnown: true, flagged: false, now: NOW, oldAfterDays: 180 }).riskLevel).toBe("medium");
    expect(risksFor({ unlimited: false, spenderKnown: true, flagged: false, grantedAt: NOW - 800 * DAY, now: NOW, oldAfterDays: 180 }).risks[0]!.label).toBe("Set 2 years ago");
  });
});
