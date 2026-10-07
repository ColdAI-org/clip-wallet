/**
 * Phase 2 and networks87: every chain family the build ships (real wiring) and the new screens (fixture mode).
 * THORChain has no public testnet, so a testnet build has no THORChain account to list.
 */
import path from "node:path";
import type { Page } from "@playwright/test";
import { extensionTest, expect, openPage, onboard, SHOTS, REAL_BUILD, FIXTURE_BUILD } from "./fixtures";

const shotOf = (page: Page) => async (name: string) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/** Address shapes each family's account must have (testnet formats). */
const ADDRESS: Record<string, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  hedera: /^(0x[0-9a-fA-F]{40}|0\.0\.\d+)$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  bitcoin: /^tb1q[02-9ac-hj-np-z]{38}$/,
  sui: /^0x[0-9a-f]{64}$/,
  aptos: /^0x[0-9a-f]{64}$/,
  cardano: /^addr_test1[02-9ac-hj-np-z]+$/,
  substrate: /^5[1-9A-HJ-NP-Za-km-z]{47}$/,
  starknet: /^0x[0-9a-f]{1,64}$/,
  ton: /^0Q[A-Za-z0-9_-]{46}$/,
  near: /^[0-9a-f]{64}$/,
  stellar: /^G[A-Z2-7]{55}$/,
  tezos: /^tz1[1-9A-HJ-NP-Za-km-z]{33}$/,
  algorand: /^[A-Z2-7]{58}$/,
  // networks87: the vault's own (mainnet) spelling; Receive spells it per network (receiveAddress).
  cosmos: /^cosmos1[02-9ac-hj-np-z]{38}$/,
  provenance: /^pb1[02-9ac-hj-np-z]{38}$/,
  initia: /^init1[02-9ac-hj-np-z]{38}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  xrpl: /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,
  antelope: /^PUB_K1_[1-9A-HJ-NP-Za-km-z]{50}$/,
  multiversx: /^erd1[02-9ac-hj-np-z]{58}$/,
  icp: /^([a-z2-7]{5}-){10}[a-z2-7]{3}$/,
  stacks: /^SP[0-9A-HJKMNP-TV-Z]{38,39}$/,
  fuel: /^0x[0-9a-fA-F]{64}$/,
  bitcoincash: /^bitcoincash:q[02-9ac-hj-np-z]{41}$/,
};

/** One coin per family, as Receive lists them (Substrate testnets: Westend and Paseo). */
const RECEIVE_SYMBOLS = [
  "ETH", "HBAR", "SOL", "BTC", "SUI", "APT", "ADA", "WND", "PAS", "STRK", "GRAM", "NEAR", "XLM", "XTZ", "ALGO",
  // networks87 testnets (Chainflip Perseverance's FLIP, Jungle4's EOS, MultiversX devnet EGLD, ICP test ledger TESTICP)
  "OSMO", "ZIG", "HASH", "INIT", "TRX", "XRP", "EOS", "TLOS", "XPR", "EGLD", "TESTICP", "STX", "BCH", "FLIP",
];

extensionTest(REAL_BUILD)("real: accounts for every family derive after onboarding and show in Receive", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "popup.html");
  const shot = shotOf(page);
  await onboard(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toHaveText(/\$\d/, { timeout: 60_000 });

  // The background derived one account per family (public data only).
  const accounts = (await page.evaluate(async () => {
    const ext = (globalThis as unknown as { chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> } } }).chrome;
    const r = (await ext.runtime.sendMessage({ type: "listAccounts" })) as { ok: boolean; data: { family: string; address: string; index: number }[] };
    return r.ok ? r.data : [];
  })) as { family: string; address: string; index: number }[];
  expect(accounts.map((a) => a.family).sort()).toEqual(Object.keys(ADDRESS).sort());
  for (const a of accounts) {
    expect(a.index, a.family).toBe(0);
    expect(a.address, a.family).toMatch(ADDRESS[a.family]!);
  }

  // Receive lists every family's coin; networks stay invisible until an address is picked.
  await page.getByRole("button", { name: "Receive" }).click();
  const list = page.locator(".clip-asset-row__symbol");
  await expect(list.first()).toBeVisible();
  const symbols = (await list.allTextContents()).map((s) => s.trim());
  for (const s of RECEIVE_SYMBOLS) expect(symbols, s).toContain(s);
  await shot("receive-all-families");

  // A Phase 2 address end to end: SUI shows the vault's Sui address with a QR code.
  await page.locator(".clip-asset-row", { has: page.locator(".clip-asset-row__symbol", { hasText: /^SUI$/ }) }).first().click();
  const sui = accounts.find((a) => a.family === "sui")!.address;
  await expect(page.getByTestId("receive-address")).toHaveText(sui);
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  await shot("receive-sui");

  // networks87: an address spelled per network. OSMO on osmo-test-5 receives on the osmo1… form of the vault's key.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Receive" }).click();
  await page.locator(".clip-asset-row", { has: page.locator(".clip-asset-row__symbol", { hasText: /^OSMO$/ }) }).first().click();
  await expect(page.getByTestId("receive-address")).toHaveText(/^osmo1[02-9ac-hj-np-z]{38}$/);
  await shot("receive-osmo");
});

extensionTest(FIXTURE_BUILD)("fixtures: Stake, Swap, Explore, Backup and Accounts screens", async ({ context, extensionId }) => {
  const page = await openPage(context, extensionId, "popup.html");
  const shot = shotOf(page);
  await onboard(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("button", { name: "Open my wallet" }).click();
  await expect(page.getByTestId("total")).toHaveText(/\$/);
  // New-family balances sit in the same merged list, by asset, with no network names.
  for (const s of ["SUI", "ADA", "NEAR"]) await expect(page.locator(".clip-asset-row__symbol", { hasText: new RegExp(`^${s}$`) })).toHaveCount(1);
  await expect(page.getByText(/Testnet|Preprod|Sepolia/)).toHaveCount(0);

  await page.getByRole("button", { name: "Stake" }).click();
  await expect(page.getByText("Earning rewards").first()).toBeVisible();
  await shot("stake");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: /Swap/ }).first().click();
  await expect(page.getByRole("heading", { name: /Swap/ }).first()).toBeVisible();
  await page.getByLabel("Amount").fill("10");
  await page.getByRole("button", { name: "Get price" }).click();
  await expect(page.getByText(/You get ~/)).toBeVisible();
  await shot("swap");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Explore" }).click();
  await expect(page.getByRole("heading", { name: "Explore" })).toBeVisible();
  await expect(page.getByText("HBAR / USDC")).toBeVisible();
  await shot("explore");

  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Backup", exact: true })).toBeVisible();
  // No backup service in this build: passkey backup is hidden behind a plain note.
  await expect(page.getByTestId("passkey-backup-unavailable")).toBeVisible();
  await shot("backup");
  await page.getByRole("button", { name: "Back", exact: true }).click();

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sui", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Polkadot", exact: true })).toBeVisible();
  await shot("accounts");
});
