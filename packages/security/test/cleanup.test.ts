import { TokenDissociateTransaction, Transaction } from "@hiero-ledger/sdk";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import type { Nft, TokenBalance } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { CleanupService, HIDE_NOTE } from "../src/cleanup/service.js";
import { SecurityService } from "../src/background.js";
import { SecurityRequest } from "../src/messages.js";
import { DEVNET, HEDERA, ME_HEDERA, ME_SOL, SEPOLIA, fakeHost, flush, mockFetch } from "./helpers.js";

const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const T22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SPAM_MINT = "SpamMint11111111111111111111111111111111111";
const SPAM_NFT = "SpamNft111111111111111111111111111111111111";
const PNFT = "LockedNft11111111111111111111111111111111111";
const EMPTY_MINT = "EmptyMint1111111111111111111111111111111111";

function acct(pubkey: string, mint: string, amount: string, decimals: number, lamports = 2039280, extra: Record<string, unknown> = {}, program = TOKENKEG) {
  return { pubkey, account: { lamports, owner: program, data: { parsed: { type: "account", info: { mint, owner: ME_SOL, state: "initialized", tokenAmount: { amount, decimals }, ...extra } } } } };
}

function solanaRpc() {
  return mockFetch([], {
    getTokenAccountsByOwner: (params) => {
      const program = (params[1] as { programId: string }).programId;
      if (program === T22) return { value: [acct("AcctTwentyTwoEmpty1111111111111111111111111", EMPTY_MINT, "0", 6, 2_074_080, {}, T22)] };
      return {
        value: [
          acct("AcctUsdc11111111111111111111111111111111111", USDC_MINT, "5000000", 6),
          acct("AcctEmpty1111111111111111111111111111111111", EMPTY_MINT, "0", 6),
          acct("AcctSpam11111111111111111111111111111111111", SPAM_MINT, "1000000000000", 6),
          acct("AcctSpamNft111111111111111111111111111111111", SPAM_NFT, "1", 0),
          acct("AcctPnft11111111111111111111111111111111111", PNFT, "1", 0, 2039280, { state: "frozen" }),
          acct("AcctWsol11111111111111111111111111111111111", "So11111111111111111111111111111111111111112", "0", 9, 2039280, { isNative: true }),
        ],
      };
    },
    getLatestBlockhash: () => ({ value: { blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", lastValidBlockHeight: 1000 } }),
  });
}

const BALANCES: TokenBalance[] = [
  { asset: { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: DEVNET.id, address: USDC_MINT }, amount: "5000000" },
  { asset: { key: "spam", symbol: "CLAIM-USDC.COM", name: "Visit claim-usdc.com", decimals: 6, networkId: DEVNET.id, address: SPAM_MINT }, amount: "1000000000000" },
];
const NFTS: Nft[] = [
  { networkId: DEVNET.id, standard: "metaplex", collection: { address: "Coll", name: "Free Mint" }, tokenId: SPAM_NFT, name: "You won!", spam: true },
  { networkId: DEVNET.id, standard: "metaplex", collection: { address: "Coll2", name: "Locked" }, tokenId: PNFT, name: "Airdrop", spam: true },
];

function decodeSolana(b64: string) {
  const [tx] = getTransactionDecoder().read(Buffer.from(b64, "base64"), 0);
  const [msg] = getCompiledTransactionMessageDecoder().read(tx.messageBytes, 0);
  const m = msg as unknown as { staticAccounts: string[]; instructions: { programAddressIndex: number; data?: Uint8Array }[]; header: { numSignerAccounts: number } };
  return m.instructions.map((ix) => ({ program: m.staticAccounts[ix.programAddressIndex], kind: ix.data?.[0] }));
}

describe("Solana cleanup", () => {
  it("lists empty accounts to close, spam to burn and close, locked spam to hide; leaves real tokens and wrapped SOL alone", async () => {
    const host = fakeHost({ networks: [DEVNET], fetch: solanaRpc().fetch, balances: BALANCES, nfts: NFTS });
    const view = await new CleanupService(host).scan();
    const byAction = (a: string) => view.items.filter((i) => i.action === a).map((i) => i.symbol);
    expect(byAction("close")).toEqual(["Empt…1111", "Empt…1111"]);
    expect(byAction("burn-close")).toEqual(["CLAIM-USDC.COM", "You won!"]);
    expect(byAction("hide")).toEqual(["Airdrop"]);
    expect(view.items.find((i) => i.symbol === "CLAIM-USDC.COM")).toMatchObject({ spam: true, preselected: true, balance: "1,000,000 CLAIM-USDC.COM", reclaim: { amount: "2039280", display: "≈0.002 SOL" } });
    expect(view.items.find((i) => i.symbol === "You won!")!.kind).toBe("nft");
    expect(view.items.some((i) => i.symbol === "USDC")).toBe(false);
  });

  it("audit SEC-04: a burn is never preselected from a name that merely looks unusual, or for anything with a price", async () => {
    const renamed: TokenBalance[] = [BALANCES[0]!, { ...BALANCES[1]!, asset: { ...BALANCES[1]!.asset, symbol: "報酬", name: "報酬パス" } }];
    const a = await new CleanupService(fakeHost({ networks: [DEVNET], fetch: solanaRpc().fetch, balances: renamed, nfts: NFTS })).scan();
    expect(a.items.find((i) => i.symbol === "報酬")).toMatchObject({ action: "burn-close", preselected: false });
    const priced: TokenBalance[] = [BALANCES[0]!, { ...BALANCES[1]!, fiatValue: 12 }];
    const b = await new CleanupService(fakeHost({ networks: [DEVNET], fetch: solanaRpc().fetch, balances: priced, nfts: NFTS })).scan();
    expect(b.items.find((i) => i.symbol === "CLAIM-USDC.COM")).toMatchObject({ action: "burn-close", preselected: false });
  });

  it("previews 'Get back ~… SOL' and queues close and burn+close transactions", async () => {
    const host = fakeHost({ networks: [DEVNET], fetch: solanaRpc().fetch, balances: BALANCES, nfts: NFTS });
    const svc = new CleanupService(host);
    const view = await svc.scan();
    const ids = view.items.filter((i) => i.preselected).map((i) => i.id);
    const sum = await svc.preview(ids);
    // 2039280 + 2074080 (Token-2022) + 2 × 2039280 = 8191920 lamports
    expect(sum).toEqual({
      headline: "Get back ~0.0082 SOL",
      lines: ["Close 2 empty accounts", "Destroy and close 2 spam tokens", "Hide 1 item (only on this device)"],
      approvals: 2,
      reclaimLamports: "8191920",
      counts: { close: 2, "burn-close": 2, dissociate: 0, hide: 1 },
    });
    const run = await svc.run(ids);
    expect(run.hidden).toBe(1);
    expect(run.queued!.steps).toEqual(["Close 2 empty token accounts", "Destroy 2 spam tokens and close their accounts"]);
    expect([...(await svc.hidden())]).toEqual([`${DEVNET.id}|${PNFT}`]);

    const close = host.enqueued[0]!.request as { params: { inputs: { transaction: string }[] } };
    const ixs = decodeSolana(close.params.inputs[0]!.transaction);
    expect(ixs).toEqual([
      { program: TOKENKEG, kind: 9 },
      { program: T22, kind: 9 },
    ]); // CloseAccount, each with its own program
    host.enqueued[0]!.resolve("sig");
    await flush();
    const burn = host.enqueued[1]!.request as { params: { inputs: { transaction: string }[] } };
    expect(decodeSolana(burn.params.inputs[0]!.transaction).map((i) => i.kind)).toEqual([15, 9, 15, 9]); // BurnChecked, CloseAccount ×2

    // Hidden items drop off the list next time.
    const again = await new CleanupService(host).scan();
    expect(again.items.some((i) => i.symbol === "Airdrop")).toBe(false);
  });
});

describe("Hedera cleanup", () => {
  const routes: Parameters<typeof mockFetch>[0] = [
    [
      /\/accounts\/0\.0\.1001\/tokens/,
      {
        tokens: [
          { token_id: "0.0.100", balance: 0, automatic_association: true, freeze_status: "NOT_APPLICABLE", kyc_status: "NOT_APPLICABLE" },
          { token_id: "0.0.200", balance: 0, automatic_association: true, freeze_status: "NOT_APPLICABLE", kyc_status: "NOT_APPLICABLE" },
          { token_id: "0.0.300", balance: 5000, automatic_association: true, freeze_status: "NOT_APPLICABLE", kyc_status: "NOT_APPLICABLE" },
          { token_id: "0.0.400", balance: 7, automatic_association: true, freeze_status: "NOT_APPLICABLE", kyc_status: "NOT_APPLICABLE" },
          { token_id: "0.0.500", balance: 0, automatic_association: false, freeze_status: "FROZEN", kyc_status: "NOT_APPLICABLE" },
          { token_id: "0.0.600", balance: 1000, automatic_association: false, freeze_status: "NOT_APPLICABLE", kyc_status: "NOT_APPLICABLE" },
        ],
        links: { next: null },
      },
    ],
    [/\/tokens\/0\.0\.100$/, { token_id: "0.0.100", name: "SAUCE", symbol: "SAUCE", decimals: "6", type: "FUNGIBLE_COMMON" }],
    [/\/tokens\/0\.0\.200$/, { token_id: "0.0.200", name: "Claim at hbar-gift.xyz", symbol: "GIFT", decimals: "0", type: "FUNGIBLE_COMMON" }],
    [/\/tokens\/0\.0\.300$/, { token_id: "0.0.300", name: "Visit free-hbar.com", symbol: "FREE", decimals: "2", type: "FUNGIBLE_COMMON" }],
    [/\/tokens\/0\.0\.400$/, { token_id: "0.0.400", name: "Airdrop voucher", symbol: "VOUCH", decimals: "0", type: "FUNGIBLE_COMMON", deleted: true }],
    [/\/tokens\/0\.0\.500$/, { token_id: "0.0.500", name: "Frozen", symbol: "FRZ", decimals: "0", type: "FUNGIBLE_COMMON" }],
    [/\/tokens\/0\.0\.600$/, { token_id: "0.0.600", name: "Real Token", symbol: "REAL", decimals: "2", type: "FUNGIBLE_COMMON" }],
  ];

  it("dissociates unused and deleted-spam tokens, hides spam you still hold, skips frozen and real ones", async () => {
    const host = fakeHost({ networks: [HEDERA], fetch: mockFetch(routes).fetch });
    const svc = new CleanupService(host);
    const view = await svc.scan();
    expect(view.items.map((i) => [i.symbol, i.action, i.preselected])).toEqual([
      ["SAUCE", "dissociate", false],
      ["GIFT", "dissociate", true],
      ["FREE", "hide", true],
      ["VOUCH", "dissociate", true],
    ]);
    expect(view.items[2]!.reason).toContain("sending it back can cost fees");
    const ids = view.items.filter((i) => i.preselected).map((i) => i.id);
    expect((await svc.preview(ids)).lines).toEqual(["Remove 2 tokens from your Hedera account", "Hide 1 item (only on this device)"]);
    const run = await svc.run(ids);
    expect(run.queued!.steps).toEqual(["Remove 2 tokens from your account"]);
    const req = host.enqueued[0]!.request as { params: { transactionList: string } };
    const tx = Transaction.fromBytes(Buffer.from(req.params.transactionList, "base64")) as TokenDissociateTransaction;
    expect(tx).toBeInstanceOf(TokenDissociateTransaction);
    expect(tx.accountId!.toString()).toBe(ME_HEDERA);
    expect(tx.tokenIds!.map(String)).toEqual(["0.0.200", "0.0.400"]);
  });
});

describe("EVM cleanup", () => {
  it("can only hide, and says why", async () => {
    const balances: TokenBalance[] = [
      { asset: { key: "x", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: SEPOLIA.id, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", spam: true }, amount: "1000000" },
      { asset: { key: "y", symbol: "DAI", name: "Dai", decimals: 18, networkId: SEPOLIA.id, address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" }, amount: "1" },
    ];
    const nfts: Nft[] = [{ networkId: SEPOLIA.id, standard: "erc721", collection: { address: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC", name: "Free Claim" }, tokenId: "7", spam: true }];
    const host = fakeHost({ networks: [SEPOLIA], fetch: mockFetch([]).fetch, balances, nfts });
    const svc = new CleanupService(host);
    const view = await svc.scan();
    expect(view.notes).toEqual([HIDE_NOTE]);
    expect(view.items.map((i) => [i.symbol, i.action])).toEqual([
      ["USDC", "hide"],
      ["Free Claim", "hide"],
    ]);
    const sum = await svc.preview(view.items.map((i) => i.id));
    expect(sum).toMatchObject({ headline: "Tidy up your wallet", approvals: 0, reclaimLamports: "0" });
    const run = await svc.run(view.items.map((i) => i.id));
    expect(run).toEqual({ hidden: 2 });
    expect(host.enqueued).toHaveLength(0);
    expect([...(await svc.hidden())]).toEqual([`${SEPOLIA.id}|0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, `${SEPOLIA.id}|0xcccccccccccccccccccccccccccccccccccccccc|7`]);
    await svc.unhide([`${SEPOLIA.id}|0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`]);
    expect((await new CleanupService(host).scan()).items.map((i) => i.symbol)).toEqual(["USDC"]);
    await expect(svc.preview(["nope"])).rejects.toMatchObject({ code: "cleanup/none" });
  });
});

describe("SecurityService bus", () => {
  it("validates messages and dispatches", async () => {
    expect(SecurityRequest.safeParse({ type: "secRevoke", ids: [] }).success).toBe(false);
    expect(SecurityRequest.safeParse({ type: "secCheckSite", origin: "https://a.example" }).success).toBe(true);
    const host = fakeHost({ networks: [SEPOLIA], fetch: mockFetch([]).fetch });
    const svc = new SecurityService(host, { testnet: true, threat: { openLists: false } });
    expect((await svc.handle({ type: "secThreatStatus" })).map((s) => s.id)).toEqual(["local", "blockaid"]);
    expect(await svc.handle({ type: "secCheckSite", origin: "https://a.example" })).toEqual({ origin: "https://a.example", warnings: [], safe: true });
    expect(await svc.handle({ type: "secCleanupScan" })).toEqual({ items: [], notes: [], noteCodes: [], partial: [] });
    expect(await svc.handle({ type: "secUnhide", ids: ["x"] })).toEqual({ ok: true });
  });
});

describe("RecipientLog", () => {
  it("records sends newest first, capped", async () => {
    const { RecipientLog } = await import("../src/history.js");
    const host = fakeHost({ networks: [], fetch: mockFetch([]).fetch });
    const log = new RecipientLog(host.kv);
    for (let i = 0; i < 502; i++) await log.record({ family: "evm", networkId: SEPOLIA.id, counterparty: `0x${String(i).padStart(40, "0")}`, amount: "1", timestamp: i });
    const all = await log.list();
    expect(all).toHaveLength(500);
    expect(all[0]).toMatchObject({ direction: "out", timestamp: 501 });
  });
});
