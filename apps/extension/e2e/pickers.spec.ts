/**
 * Picker matrix, part 1: each ecosystem's STOCK wallet-picker UI, unmodified and with its default configuration, in a
 * local page pointed at the public testnet (pickers/dapps/src/<id>.tsx), against the REAL build with the dapp matrix's
 * wallet. Per picker:
 *
 *   listed     the picker lists "Clip Wallet" (or, for pickers that only show registry-listed wallets, it doesn't:
 *              recorded as expected-no, and the same picker with the documented module/entry a dapp can add is tested)
 *   icon       the entry's icon has loaded and is the Clip icon the extension announces
 *   connects   clicking it connects (approved in the wallet) and the library reports the matrix account
 *   reconnect  the library's disconnect, then picking Clip again, connects again
 *   reload     after a page reload the library restores the connection (where it has autoconnect)
 *
 * A screenshot of each open picker with Clip in it: e2e/shots/pickers/<id>.png. Results: shots/pickers/results.json,
 * written up in docs/r1/picker-matrix.md. Needs public testnets and the matrix wallet, so like the matrix it only runs
 * with DAPP_MATRIX=1:  pnpm --filter @clip-wallet/extension pickers [-- -g <id>]
 *
 * The phrase is never logged or captured: trace/screenshot/video are off; onboarding happens before any screenshot.
 */
import path from "node:path";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { Address } from "@ton/core";
import { decodeAddress } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { matrixPhrase } from "./matrix/env";
import { answer } from "./matrix/wallet";
import { addressOf, type Target } from "./matrix/chain";
import { openPicker } from "./pickers/serve";
import { PHRASE_MISSING, PICKER_SHOTS, announcedIcon, checkIcon, launchWithMatrixWallet, saveRow, walletConnectSkip, type Row, type Walleted } from "./pickers/wallet-context";
import { walletConnectProjectId } from "./matrix/env";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "default", timeout: 240_000 });

interface PickerCase {
  id: string;
  ecosystem: string;
  picker: string;
  title: string;
  /** Account the library must report; default addressOf(target). */
  target: Target;
  expectAddress?: (a: string) => boolean;
  /** false: a stock picker that shows only registry-listed wallets; Clip must NOT be listed (documented). */
  expectListed?: boolean;
  /** Proves the picker is open (another wallet's entry), so "not listed" isn't just "didn't open". */
  opened?(page: Page): Locator;
  /** A known no-op: picking Clip must NOT connect (documented); if it starts to, the test says so. */
  expectConnect?: false;
  /** Bundle file and query (variants of one page, e.g. ?variant=clip); default: id. */
  file?: string;
  query?: string;
  open(page: Page): Promise<void>;
  /** Clip's entry in the open picker. */
  entry(page: Page): Locator;
  /** The entry's icon element (default: first img in the entry). */
  icon?(entry: Locator, page: Page): Locator;
  /** The element holding the wallet's name in the entry (default: the entry's first line of text). */
  nameOf?(entry: Locator): Locator;
  /** What to click to pick Clip (default: the entry itself). */
  pick?(entry: Locator): Locator;
  /** Clicks to make after picking Clip, before the wallet's approval (e.g. a "Connect" confirm in the picker). */
  afterPick?(page: Page): Promise<void>;
  /** Wallet approvals answered after picking (default ["Connect"]). */
  approvals?: string[];
  /** Restores the connection on reload; a string says why not. */
  autoconnect: true | string;
  /** Close the picker after connecting, if the library leaves it open. */
  close?(page: Page): Promise<void>;
  notes?: string[];
  /** Known limits of the library (not the wallet): recorded as a note, not a failure. */
  known?: { name?: string; icon?: string };
  skip?: () => string | null;
  extra?: Record<string, { type: string; body: string | Buffer }>;
}

const TON_MANIFEST = {
  "/tonconnect-manifest.json": { type: "application/json", body: JSON.stringify({ url: "https://ton.picker-dapp.example", name: "Clip picker matrix", iconUrl: "https://ton.picker-dapp.example/icon.png" }) },
};

/** Polkadot pickers may re-encode the account for another SS58 prefix: same account = same public key. */
const sameSubstrateAccount = (a: string) => {
  try {
    return u8aToHex(decodeAddress(a)) === u8aToHex(decodeAddress(addressOf("substrate")));
  } catch {
    return false;
  }
};

/** TON Connect reports the raw form (0:<hex>); the matrix records the user-friendly testnet form. */
const sameTonAddress = (a: string) => {
  try {
    return Address.parse(a).equals(Address.parse(addressOf("ton")));
  } catch {
    return false;
  }
};

const CASES: PickerCase[] = [
  {
    id: "rainbowkit",
    ecosystem: "EVM",
    picker: "RainbowKit 2.2.11 ConnectButton",
    title: "RainbowKit",
    target: "evm",
    open: (p) => p.getByRole("button", { name: "Connect Wallet" }).click(),
    entry: (p) => p.locator('[role="dialog"] button', { hasText: "Clip Wallet" }).first(),
    autoconnect: true,
  },
  {
    id: "connectkit",
    ecosystem: "EVM",
    picker: "ConnectKit 1.9.2 ConnectKitButton",
    title: "ConnectKit",
    target: "evm",
    open: (p) => p.getByRole("button", { name: /Connect Wallet/i }).first().click(),
    entry: (p) => p.locator("button", { hasText: "Clip Wallet" }).first(),
    autoconnect: true,
  },
  {
    id: "appkit",
    ecosystem: "EVM",
    picker: "Reown AppKit 1.8.24 <appkit-button>",
    title: "Reown AppKit",
    target: "evm",
    open: (p) => p.locator("appkit-button").getByRole("button").first().click(),
    entry: (p) => p.locator("wui-list-wallet", { hasText: "Clip Wallet" }).first(),
    icon: (e) => e.locator("img").first(),
    // Lit components: the name is inside the entry's shadow root.
    nameOf: (e) => e.getByText("Clip Wallet", { exact: true }),
    autoconnect: true,
  },
  {
    id: "solana",
    ecosystem: "Solana",
    picker: "@solana/wallet-adapter-react-ui 0.9.40 WalletMultiButton / WalletModal",
    title: "Solana wallet-adapter",
    target: "solana",
    open: (p) => p.locator(".wallet-adapter-button-trigger").first().click(),
    entry: (p) => p.locator(".wallet-adapter-modal-list li button", { hasText: "Clip Wallet" }).first(),
    autoconnect: true,
  },
  {
    id: "sui",
    ecosystem: "Sui",
    picker: "@mysten/dapp-kit 1.1.17 ConnectButton / ConnectModal",
    title: "Sui dapp-kit",
    target: "sui",
    open: (p) => p.getByRole("button", { name: "Connect Wallet" }).click(),
    entry: (p) => p.getByRole("dialog").getByRole("button", { name: "Clip Wallet" }).first(),
    close: (p) => p.keyboard.press("Escape"),
    autoconnect: true,
  },
  {
    id: "aptos",
    ecosystem: "Aptos",
    picker: "@aptos-labs/wallet-adapter-ant-design 5.3.19 WalletSelector",
    title: "Aptos wallet adapter",
    target: "aptos",
    open: (p) => p.getByRole("button", { name: /Connect (a )?Wallet/i }).click(),
    entry: (p) => p.locator(".wallet-menu-wrapper", { hasText: "Clip Wallet" }).first(),
    pick: (e) => e.getByRole("button", { name: "Connect" }),
    autoconnect: true,
  },
  {
    id: "cardano-stock",
    file: "cardano",
    ecosystem: "Cardano",
    picker: "cardano-connect-with-wallet 0.2.22 ConnectWalletButton, stock",
    title: "Cardano Connect with Wallet (stock)",
    target: "cardano",
    expectListed: false,
    open: (p) => p.getByText("Connect Wallet", { exact: true }).first().click(),
    opened: (p) => p.getByText(/Eternl|Nami|Lace|Yoroi|P2P Wallet/).first(),
    entry: (p) => p.getByText(/clip ?wallet/i).first(),
    autoconnect: true,
    notes: ["supportedWallets defaults to the library's wallet registry (wallets.ts); window.cardano wallets outside it are not shown"],
  },
  {
    id: "cardano-clip",
    file: "cardano",
    query: "variant=clip",
    ecosystem: "Cardano",
    picker: 'cardano-connect-with-wallet 0.2.22 ConnectWalletButton, supportedWallets + "clipwallet"',
    title: "Cardano Connect with Wallet (supportedWallets variant)",
    target: "cardano",
    open: (p) => p.getByText("Connect Wallet", { exact: true }).first().click(),
    entry: (p) => p.getByRole("menuitem", { name: /clip ?wallet/i }).first(),
    autoconnect: true,
    known: { name: "wallets outside the library's registry are shown by their window.cardano key, capitalised (\"Clipwallet\"); window.cardano.clipwallet.name is not used" },
  },
  {
    id: "mesh",
    ecosystem: "Cardano",
    picker: "Mesh @meshsdk/react 2.0.0-beta.2 CardanoWallet",
    title: "Mesh CardanoWallet",
    target: "cardano",
    open: (p) => p.getByRole("button", { name: "Connect Wallet" }).first().click(),
    // Mesh shows icon tiles; the wallet's CIP-30 name is the icon's alt text (and its tooltip).
    entry: (p) => p.getByRole("dialog").getByRole("button").filter({ has: p.getByAltText("Clip Wallet") }).first(),
    close: (p) => p.keyboard.press("Escape"),
    autoconnect: true,
  },
  {
    id: "talisman-stock",
    file: "talisman",
    ecosystem: "Polkadot",
    picker: "Talisman Connect 1.1.9 WalletSelect, stock",
    title: "Talisman Connect (stock)",
    target: "substrate",
    expectAddress: sameSubstrateAccount,
    expectListed: false,
    open: (p) => p.getByRole("button", { name: "Connect wallet" }).click(),
    opened: (p) => p.getByText(/Talisman|SubWallet|Polkadot\.js/).first(),
    entry: (p) => p.getByText(/clip ?wallet/i).first(),
    autoconnect: "the page keeps the selected account in memory only (Talisman Connect has no session restore of its own)",
    notes: ["getWallets() is a fixed list of nine wallet classes in @talismn/connect-wallets"],
  },
  {
    id: "talisman-clip",
    file: "talisman",
    query: "variant=clip",
    ecosystem: "Polkadot",
    picker: "Talisman Connect 1.1.9 WalletSelect, walletList + Clip entry",
    title: "Talisman Connect (walletList variant)",
    target: "substrate",
    expectAddress: sameSubstrateAccount,
    open: (p) => p.getByRole("button", { name: "Connect wallet" }).click(),
    entry: (p) => p.locator("button", { hasText: "Clip Wallet" }).first(),
    afterPick: async (p) => {
      // showAccountsList: Talisman lists the wallet's accounts after enable(); pick the first.
      const acct = p.locator("button", { hasText: /5Gj6|Account/ }).first();
      await acct.waitFor({ state: "visible", timeout: 60_000 }).then(() => acct.click(), () => undefined);
    },
    autoconnect: "the page keeps the selected account in memory only (Talisman Connect has no session restore of its own)",
  },
  {
    id: "dotconnect",
    ecosystem: "Polkadot",
    picker: "DOT Connect 0.31.0 <dc-connection-button> (ReactiveDOT)",
    title: "DOT Connect",
    target: "substrate",
    expectAddress: sameSubstrateAccount,
    open: (p) => p.locator("dc-connection-button").getByRole("button").first().click(),
    entry: (p) => p.locator("dc-list-item", { hasText: "clip-wallet" }).first(),
    icon: (e) => e.locator(".icon img, .icon svg").first(),
    nameOf: (e) => e.locator('[slot="headline"]'),
    pick: (e) => e.getByRole("button", { name: "Connect" }),
    close: (p) => p.keyboard.press("Escape"),
    autoconnect: true,
    known: {
      name: "DOT Connect names an injectedWeb3 extension by its key unless the extension is in DOT Connect's own wallet list; the Polkadot{.js} extension interface has no name or icon field",
      icon: "generic wallet glyph, for the same reason",
    },
  },
  {
    id: "starknetkit-stock",
    file: "starknetkit",
    ecosystem: "Starknet",
    picker: "starknetkit 3.4.3 connect() modal, default connectors",
    title: "starknetkit (stock)",
    target: "starknet",
    expectListed: false,
    open: (p) => p.getByRole("button", { name: "Connect wallet" }).click(),
    opened: (p) => p.getByText(/Ready Wallet|Braavos|Cartridge/).first(),
    entry: (p) => p.getByText(/clip ?wallet/i).first(),
    autoconnect: true,
    notes: ["connect() without connectors uses a fixed list (Ready/Argent X, Braavos, Cartridge Controller, and MetaMask/Fordefi/Keplr/Xverse when injected); other window.starknet_* wallets are not shown"],
  },
  {
    id: "starknetkit-clip",
    file: "starknetkit",
    query: "variant=clip",
    ecosystem: "Starknet",
    picker: 'starknetkit 3.4.3 connect() modal + InjectedConnector({ id: "clipwallet" })',
    title: "starknetkit (InjectedConnector variant)",
    target: "starknet",
    expectAddress: (a) => /^0x[0-9a-f]+$/i.test(a) && BigInt(a) === BigInt(addressOf("starknet")),
    open: (p) => p.getByRole("button", { name: "Connect wallet" }).click(),
    entry: (p) => p.locator("button, li, [role=button]", { hasText: "Clip Wallet" }).last(),
    autoconnect: true,
  },
  {
    id: "satsconnect",
    ecosystem: "Bitcoin",
    picker: "sats-connect 4.2.1 wallet selector (@sats-connect/ui)",
    title: "sats-connect",
    target: "bitcoin",
    expectListed: false,
    open: (p) => p.getByRole("button", { name: "Connect wallet" }).click(),
    opened: (p) => p.getByText(/Xverse|Unisat|Leather|Fordefi|Magic Eden/).first(),
    entry: (p) => p.getByText(/clip ?wallet/i).first(),
    autoconnect: "n/a",
    notes: ["the selector lists only sats-connect's built-in adapters (DefaultAdaptersInfo); it reads neither the Wallet Standard nor WBIP-004 btc_providers"],
  },
  {
    id: "near-stock",
    file: "near",
    ecosystem: "NEAR",
    picker: "NEAR Wallet Selector 10.1.4 modal-ui, stock modules",
    title: "NEAR Wallet Selector (stock modules)",
    target: "near",
    expectListed: false,
    open: (p) => p.getByRole("button", { name: "Connect wallet" }).click(),
    opened: (p) => p.getByText(/MyNearWallet|Meteor/).first(),
    entry: (p) => p.getByText(/clip ?wallet/i).first(),
    autoconnect: true,
    notes: ["Wallet Selector lists only the modules the dapp passes; there is no injected-wallet discovery"],
  },
  {
    id: "near-clip",
    file: "near",
    query: "variant=clip",
    ecosystem: "NEAR",
    picker: "NEAR Wallet Selector 10.1.4 modal-ui + @clip-wallet/kit-modules/near",
    title: "NEAR Wallet Selector (with the wallet's module)",
    target: "near",
    open: (p) => p.getByRole("button", { name: "Connect wallet" }).click(),
    entry: (p) => p.locator(".nws-modal-wrapper li", { hasText: "Clip Wallet" }).first(),
    close: (p) => p.keyboard.press("Escape"),
    autoconnect: true,
  },
  {
    id: "stellar-stock",
    file: "stellar",
    ecosystem: "Stellar",
    picker: "Stellar Wallets Kit 2.7.0 button + auth modal, defaultModules()",
    title: "Stellar Wallets Kit (stock modules)",
    target: "stellar",
    expectListed: false,
    open: (p) => p.getByRole("button", { name: /connect/i }).first().click(),
    opened: (p) => p.getByText(/Freighter|xBull|Albedo|LOBSTR/i).first(),
    entry: (p) => p.getByText(/clip ?wallet/i).first(),
    autoconnect: true,
    notes: ["the kit lists only its modules; defaultModules() has no injected-wallet discovery"],
  },
  {
    id: "stellar-clip",
    file: "stellar",
    query: "variant=clip",
    ecosystem: "Stellar",
    picker: "Stellar Wallets Kit 2.7.0 + @clip-wallet/kit-modules/stellar ClipWalletModule",
    title: "Stellar Wallets Kit (with the wallet's module)",
    target: "stellar",
    open: (p) => p.getByRole("button", { name: /connect/i }).first().click(),
    entry: (p) => p.locator("li, button, [role=button]", { hasText: /^\s*Clip Wallet/ }).last(),
    close: (p) => p.keyboard.press("Escape"),
    autoconnect: true,
  },
  {
    id: "algorand-stock",
    file: "algorand",
    ecosystem: "Algorand",
    picker: "use-wallet-ui-react 1.2.1 WalletButton, Pera/Defly/Exodus",
    title: "use-wallet UI (stock adapters)",
    target: "algorand",
    expectListed: false,
    open: (p) => p.getByRole("button", { name: /Connect Wallet/i }).first().click(),
    opened: (p) => p.getByText(/Pera|Defly|Exodus/).first(),
    entry: (p) => p.getByText(/clip ?wallet/i).first(),
    autoconnect: true,
    notes: ["use-wallet v5 lists only the adapters the dapp passes; there is no injected-wallet discovery"],
  },
  {
    id: "algorand-clip",
    file: "algorand",
    query: "variant=clip",
    ecosystem: "Algorand",
    picker: "use-wallet-ui-react 1.2.1 WalletButton + @clip-wallet/kit-modules/algorand clipWallet()",
    title: "use-wallet UI (with the wallet's adapter)",
    target: "algorand",
    open: (p) => p.getByRole("button", { name: /Connect Wallet/i }).first().click(),
    entry: (p) => p.getByRole("dialog").locator("button, li", { hasText: "Clip Wallet" }).last(),
    close: (p) => p.keyboard.press("Escape"),
    autoconnect: true,
  },
  {
    id: "ton-stock",
    file: "ton",
    ecosystem: "TON",
    picker: "@tonconnect/ui 3.0.2 modal, official wallets list",
    title: "TON Connect UI (stock)",
    target: "ton",
    expectAddress: sameTonAddress,
    expectListed: false,
    extra: TON_MANIFEST,
    // The modal shows three wallets and "View all wallets": open the full list, so "not listed" means the whole list.
    open: async (p) => {
      await p.locator("#ton-connect button").first().click();
      await p.getByText(/View all/).first().click();
    },
    opened: (p) => p.getByText(/Tonkeeper|MyTonWallet|Tonhub/).first(),
    entry: (p) => p.getByText(/clip ?wallet/i).first(),
    autoconnect: true,
    notes: ["the modal shows wallets from the official wallets list (config.ton.org/wallets-v2.json); Clip isn't in it"],
  },
  {
    id: "ton-clip",
    file: "ton",
    query: "variant=clip",
    ecosystem: "TON",
    picker: "@tonconnect/ui 3.0.2 modal + walletsListConfiguration.includeWallets (Clip entry)",
    title: "TON Connect UI (includeWallets variant)",
    target: "ton",
    expectAddress: sameTonAddress,
    extra: TON_MANIFEST,
    open: (p) => p.locator("#ton-connect button").first().click(),
    entry: (p) => p.locator("li, button", { hasText: "Clip Wallet" }).last(),
    close: (p) => p.keyboard.press("Escape"),
    autoconnect: true,
  },
  {
    id: "tezos",
    ecosystem: "Tezos",
    picker: "Beacon 4.8.1 pairing modal (DAppClient.requestPermissions)",
    title: "Beacon",
    target: "tezos",
    expectConnect: false,
    // Beacon's first page shows four featured wallets; "Show more" opens the full list.
    open: async (p) => {
      await p.getByRole("button", { name: "Connect wallet" }).click();
      await p.getByText("Show more", { exact: true }).click();
    },
    entry: (p) => p.locator("[class*=wallet], button, div", { hasText: /^Clip Wallet$/ }).last(),
    autoconnect: "n/a: connecting through the stock modal doesn't work yet",
    notes: ["Beacon lists Clip (it answers Beacon's postMessage ping), but in beacon-ui 4.8 the tile of an unlisted Chromium extension does nothing: \"Use Extension\" is only offered for wallets in Beacon's extension list or on Firefox"],
  },
  {
    id: "hedera",
    ecosystem: "Hedera",
    picker: "@hashgraph/hedera-wallet-connect 2.1.3 DAppConnector extension discovery (HashConnect v3 path)",
    title: "Hedera DAppConnector",
    target: "hedera",
    // DAppConnector answers with the 0.0.x account id of the matrix's Hedera key (0.0.10872693, docs/r1/dapp-matrix-funding.md).
    expectAddress: (a) => a === "0.0.10872693" || a.toLowerCase() === addressOf("hedera").toLowerCase(),
    skip: walletConnectSkip,
    // The page lists dAppConnector.extensions (what HashConnect's and DAppConnector's pickers render) with a button each.
    open: async () => undefined,
    entry: (p) => p.locator("#extensions li", { hasText: "Clip Wallet" }).first(),
    pick: (e) => e.getByRole("button"),
    autoconnect: "DAppConnector restores WalletConnect sessions on init(); checked once a project id is set",
  },
];

const RESULTS = "results.json";
let w: Walleted | undefined;

test.beforeAll(async () => {
  if (!matrixPhrase()) return;
  w = await launchWithMatrixWallet();
});
test.afterAll(async () => {
  await w?.context.close();
  w = undefined;
});

const account = (page: Page) => page.evaluate(() => (window as unknown as { __account?: string }).__account ?? "");

async function waitAccount(page: Page, ok: (a: string) => boolean, ms = 30_000): Promise<string> {
  const end = Date.now() + ms;
  let last = "";
  while (Date.now() < end) {
    last = await account(page).catch(() => "");
    if (last && ok(last)) return last;
    await page.waitForTimeout(250);
  }
  return last;
}

/** Answers the wallet's approvals, if any appear (a site the wallet already trusts reconnects without one). */
async function approve(context: BrowserContext, buttons: string[], ms: number) {
  for (const b of buttons) await answer(context, b, ms).catch(() => undefined);
}

/** PICKER_DEBUG=<dir>: screenshots of the dapp page at each step (never of the wallet's onboarding). */
const debugShot = async (page: Page, name: string) => {
  if (process.env.PICKER_DEBUG) await page.screenshot({ path: path.join(process.env.PICKER_DEBUG, `${name}.png`) }).catch(() => undefined);
};

async function pickClip(c: PickerCase, page: Page, context: BrowserContext, ok: (a: string) => boolean, approvalMs: number) {
  await c.open(page);
  const entry = c.entry(page);
  await entry.waitFor({ state: "visible", timeout: 20_000 });
  await (c.pick ? c.pick(entry) : entry).click();
  await debugShot(page, `${c.id}-picked`);
  const pending = approve(context, c.approvals ?? ["Connect"], approvalMs);
  if (c.afterPick) {
    await pending;
    await debugShot(page, `${c.id}-approved`);
    await c.afterPick(page);
    await debugShot(page, `${c.id}-after-pick`);
  }
  const got = await waitAccount(page, ok, approvalMs + 20_000);
  await pending;
  await c.close?.(page);
  return got;
}

for (const c of CASES) {
  test(`picker: ${c.id}`, async () => {
    test.skip(!w, PHRASE_MISSING);
    const why = c.skip?.();
    const row: Row = { id: c.id, ecosystem: c.ecosystem, picker: c.picker, kind: "stock-ui", notes: [...(c.notes ?? [])], shots: [], at: new Date().toISOString() };
    if (why) {
      Object.assign(row, { listed: "skip", icon: "skip", connects: "skip", reconnect: "skip", reload: "skip" });
      row.notes.push(why);
      saveRow(RESULTS, row);
      test.skip(true, why);
    }
    const { context } = w!;
    const expected = addressOf(c.target);
    const ok = c.expectAddress ?? ((a: string) => a.toLowerCase() === expected.toLowerCase());
    const failures: string[] = [];
    const wcProjectId = walletConnectProjectId();
    const page = await openPicker(context, c.id, c.title, { ...(c.file ? { file: c.file } : {}), ...(c.query ? { query: c.query } : {}), ...(c.extra ? { extra: c.extra } : {}), ...(wcProjectId ? { wcProjectId } : {}) });
    const info = await page.evaluate(() => (window as unknown as { __picker: { info: { library: string; config: string } } }).__picker.info);
    row.detail = { library: info.library, config: info.config };
    const announced = await announcedIcon(page);

    // listed + icon + screenshot
    await c.open(page);
    const entry = c.entry(page);
    const listed = await entry.waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    const shot = `${c.id}.png`;
    if (listed) await entry.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(800); // let open animations and icons settle
    await page.screenshot({ path: path.join(PICKER_SHOTS, shot) });
    row.shots.push(shot);
    if (c.expectListed === false) {
      const open = c.opened ? await c.opened(page).waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false) : true;
      if (!open) failures.push("the picker didn't open (no other wallet shown), so 'not listed' proves nothing");
      row.listed = listed ? "fail" : "expected-no";
      if (listed) failures.push("listed, but this picker shows only registry wallets: update the expectation and docs");
      Object.assign(row, { icon: "n/a", connects: "n/a", reconnect: "n/a", reload: "n/a" });
      saveRow(RESULTS, row);
      expect(failures, failures.join("\n")).toEqual([]);
      return;
    }
    row.listed = listed ? "pass" : "fail";
    if (!listed) {
      failures.push("Clip Wallet is not listed");
      saveRow(RESULTS, row);
      expect(failures, failures.join("\n")).toEqual([]);
      return;
    }
    // The visible name, or for icon-only tiles the accessible name (aria-label, the icon's alt, title).
    const label = await (c.nameOf ? c.nameOf(entry) : entry)
      .evaluate((el) => (el as HTMLElement).innerText?.trim() || el.getAttribute("aria-label") || el.querySelector("img")?.getAttribute("alt") || el.getAttribute("title") || "")
      .catch(() => "");
    const name = label.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    row.detail.name = name;
    if (!/^Clip Wallet\b/.test(name)) {
      if (c.known?.name) row.notes.push(`listed as "${name}": ${c.known.name}`);
      else failures.push(`listed as "${name}", not "Clip Wallet"`);
    }
    const icon = await checkIcon(context, c.icon ? c.icon(entry, page) : entry.locator("img").first(), announced);
    row.icon = icon.ok ? "pass" : "fail";
    row.detail.icon = icon;
    if (!icon.ok) {
      if (c.known?.icon) row.notes.push(`icon: ${c.known.icon}`);
      else failures.push(`icon: ${JSON.stringify(icon)}`);
    } else if (c.known?.icon) failures.push("the icon is right now: drop known.icon and update docs/r1/picker-matrix.md");

    // connects
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __picker?: unknown }).__picker);
    if (c.expectConnect === false) {
      const got = await pickClip(c, page, context, ok, 15_000).catch((e: Error) => `error: ${e.message.split("\n")[0]}`);
      row.connects = ok(got) ? "pass" : "fail";
      Object.assign(row, { reconnect: "n/a", reload: "n/a" });
      row.detail.account = got;
      if (ok(got)) failures.push("picking Clip connected: the known no-op is fixed, update this case and docs/r1/picker-matrix.md");
      else row.notes.push("clicking Clip in the stock modal did nothing (no wallet approval, no account), as documented");
      saveRow(RESULTS, row);
      expect(failures, failures.join("\n")).toEqual([]);
      return;
    }
    const got = await pickClip(c, page, context, ok, 60_000).catch((e: Error) => `error: ${e.message.split("\n")[0]}`);
    row.connects = ok(got) ? "pass" : "fail";
    row.detail.account = got;
    if (!ok(got)) {
      failures.push(`connect: library reports "${got}", expected ${expected}`);
      saveRow(RESULTS, row);
      expect(failures, failures.join("\n")).toEqual([]);
      return;
    }

    // disconnect, then reconnect through the picker
    await page.evaluate(() => (window as unknown as { __picker: { disconnect(): Promise<void> } }).__picker.disconnect());
    const cleared = await waitAccount(page, (a) => a === "", 10_000).then(() => account(page));
    if (cleared) row.notes.push(`after disconnect the library still reports ${cleared}`);
    const again = await pickClip(c, page, context, ok, 15_000).catch((e: Error) => `error: ${e.message.split("\n")[0]}`);
    row.reconnect = !cleared && ok(again) ? "pass" : "fail";
    if (row.reconnect === "fail") failures.push(`reconnect: "${again}"${cleared ? " (disconnect didn't clear)" : ""}`);

    // reload restores the session
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { __picker?: unknown }).__picker);
    const restored = await waitAccount(page, ok, 20_000);
    if (c.autoconnect === true) {
      row.reload = ok(restored) ? "pass" : "fail";
      if (!ok(restored)) failures.push(`reload: library reports "${restored}"`);
    } else {
      row.reload = "n/a";
      row.notes.push(`reload: ${c.autoconnect}${ok(restored) ? " (it did restore)" : ""}`);
    }
    saveRow(RESULTS, row);
    await page.close();
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
