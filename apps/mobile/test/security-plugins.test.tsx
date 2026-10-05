/** Settings → Security (permissions, cleanup, scam protection) and Clip Plugins (settings, install prompt, "From <plugin>" card). */
import { act, fireEvent, screen } from "@testing-library/react-native";
import { gunzipSync } from "node:zlib";
import { PluginRegistry, PluginsService, type PluginInsight } from "@clip-wallet/plugins";
import type { EnginePlugins } from "@clip-wallet/engine";
import { Settings } from "../src/screens/Settings";
import { Cleanup, Permissions, Protection, SecurityHome } from "../src/screens/Security";
import { PluginSettings } from "../src/screens/Plugins";
import { ApprovalScreen } from "../src/screens/Approval";
import { eventually, renderWith, testWallet, type TestWalletOptions } from "./helpers";
import { fakeRegistry, pluginTarball } from "./plugin-fixtures";

const PW = "a long test password 42!";
const NOTE: PluginInsight = {
  pluginId: "clip-plugin-address-label",
  pluginName: "Address labels",
  from: "from Address labels",
  lines: [{ label: "Address", value: "Burn address" }],
  warnings: [{ level: "danger", message: "Anything sent to the burn address is gone for good." }],
};

async function ready(opts?: TestWalletOptions) {
  const wallet = testWallet({}, opts);
  await wallet.client.createWallet(PW);
  return wallet;
}

/** Real registry + PluginsService over the engine's KV, npm from a fake registry; insights canned (SES runs in vitest). */
function plugins(insights: PluginInsight[] = [], npmFetch?: typeof fetch): NonNullable<TestWalletOptions["plugins"]> {
  return (engine, kv): EnginePlugins => {
    const registry = new PluginRegistry({
      kv,
      advanced: async () => (await engine.prefs()).advanced,
      npm: { ...(npmFetch ? { fetch: npmFetch } : {}), gunzip: (b) => new Uint8Array(gunzipSync(b)) },
    });
    return { service: new PluginsService(registry), sync: async () => undefined, insights: async () => insights };
  };
}

describe("Settings → Security", () => {
  it("is in Settings and lists the three screens", async () => {
    const wallet = await ready();
    renderWith(wallet, <Settings />, { name: "settings" });
    expect(await eventually(() => screen.getByTestId("menu-security"))).toBeTruthy();
    renderWith(wallet, <SecurityHome />, { name: "security" });
    expect(screen.getByText("App permissions")).toBeTruthy();
    expect(screen.getByText("Clean up spam")).toBeTruthy();
    expect(screen.getByText("Scam protection")).toBeTruthy();
  });

  it("App permissions: risk flags, risky ones ticked, removal goes to the normal approval", async () => {
    const wallet = await ready();
    renderWith(wallet, <Permissions />, { name: "security-permissions" });
    expect(await eventually(() => screen.getByText("An unknown app can spend all your USDC"))).toBeTruthy();
    expect(screen.getByText("Uniswap can spend up to 100 USDC")).toBeTruthy();
    expect(screen.getByText("Can take all of it")).toBeTruthy();
    expect(screen.getByText("Unknown app")).toBeTruthy();
    expect(screen.getByText("High risk")).toBeTruthy();
    expect(screen.getByText("Looks fine")).toBeTruthy();
    expect(screen.getByText("On Sepolia only recent permissions could be checked. Older ones may still be there.")).toBeTruthy();
    const [risky, fine] = screen.getAllByTestId("grant");
    expect(risky!.props.accessibilityState).toMatchObject({ checked: true });
    expect(fine!.props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getByText("Remove 1 permission")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("revoke")));
    expect(wallet.securityCalls.find((c) => c.type === "secRevoke")).toEqual({ type: "secRevoke", ids: ["evm:base-sepolia:usdc:0xdead"] });
    // Queued on the engine's approval queue: the approval sheet confirms it and the vault signs there.
    const pending = await wallet.client.listApprovals();
    expect(pending).toHaveLength(1);
    expect(wallet.vault.signed).toHaveLength(0);
  });

  it("Clean up: says what one tap gives back, and queues the Solana part for approval", async () => {
    const wallet = await ready();
    renderWith(wallet, <Cleanup />, { name: "security-cleanup" });
    // Two preselected Solana accounts: 2 × 0.00203928 SOL.
    expect(await eventually(() => screen.getByTestId("cleanup-run"))).toBeTruthy();
    await eventually(() => screen.getAllByText("Get back ~0.0041 SOL"));
    expect(screen.getByText("• Close 1 empty account")).toBeTruthy();
    expect(screen.getByText("• Destroy and close 1 spam token")).toBeTruthy();
    expect(screen.getByText("You'll confirm 1 transaction.")).toBeTruthy();
    expect(screen.getByText(/On Ethereum and similar networks, spam tokens can only be hidden/)).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("cleanup-run")));
    expect(wallet.securityCalls.find((c) => c.type === "secCleanupRun")).toEqual({ type: "secCleanupRun", ids: ["sol:empty", "sol:spam"] });
    expect(await wallet.client.listApprovals()).toHaveLength(1);
  });

  it("Clean up: hiding only needs no approval", async () => {
    const wallet = await ready();
    renderWith(wallet, <Cleanup />, { name: "security-cleanup" });
    await eventually(() => screen.getAllByTestId("cleanup-item"));
    fireEvent.press(screen.getByText("Select none"));
    fireEvent.press(screen.getAllByTestId("cleanup-item")[2]!);
    await eventually(() => screen.getAllByText("Tidy up your wallet"));
    await act(async () => fireEvent.press(screen.getByTestId("cleanup-run")));
    expect(await eventually(() => screen.getByText("Hid 1 item."))).toBeTruthy();
    expect(await wallet.client.listApprovals()).toHaveLength(0);
  });

  it("Scam protection: each source, its status, what it sees, and Blockaid off without a key", async () => {
    const wallet = await ready();
    renderWith(wallet, <Protection />, { name: "security-protection" });
    expect(await eventually(() => screen.getByText("MetaMask phishing list"))).toBeTruthy();
    expect(screen.getByText(/102,345 entries/)).toBeTruthy();
    expect(screen.getByText("Downloads the public list to your device and checks it there. Nothing about you is sent.")).toBeTruthy();
    expect(screen.getByText("Blockaid scanning")).toBeTruthy();
    expect(screen.getByText("Sends the site, the transaction and your address to Blockaid for every request you review.")).toBeTruthy();
    expect(screen.getByText(/Add a Blockaid API key/)).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("threat-refresh")));
    expect(wallet.securityCalls.some((c) => c.type === "secThreatRefresh")).toBe(true);
  });

  it("speaks the user's language (German)", async () => {
    const wallet = await ready();
    await wallet.client.setPrefs({ locale: "de" });
    renderWith(wallet, <SecurityHome />, { name: "security" });
    expect(await eventually(() => screen.getByText("App-Berechtigungen"))).toBeTruthy();
    expect(screen.getByText("Betrugsschutz")).toBeTruthy();
  });
});

describe("Clip Plugins", () => {
  it("is hidden without Advanced mode, and needs a build with plugins", async () => {
    const off = await ready();
    renderWith(off, <Settings />, { name: "settings" });
    await eventually(() => screen.getByTestId("advanced"));
    expect(screen.queryByTestId("menu-plugins")).toBeNull();
    const on = await ready({ plugins: plugins() });
    renderWith(on, <Settings />, { name: "settings" });
    await eventually(() => screen.getByTestId("advanced"));
    expect(screen.queryByTestId("menu-plugins")).toBeNull();
    await act(async () => void (await on.client.setPrefs({ advanced: true })));
    expect(await eventually(() => screen.getByTestId("menu-plugins"))).toBeTruthy();
    renderWith(off, <PluginSettings />, { name: "plugins" });
    expect(screen.getByText("Plugins aren't available in this version")).toBeTruthy();
  });

  it("switch off by default; install shows what it can do and stores nothing until Install", async () => {
    const tarball = pluginTarball("clip-plugin-address-label");
    const reg = fakeRegistry("clip-plugin-address-label", "1.0.0", tarball);
    const wallet = await ready({ plugins: plugins([], reg.f) });
    await wallet.client.setPrefs({ advanced: true });
    renderWith(wallet, <PluginSettings />, { name: "plugins" });
    const sw = await eventually(() => screen.getByTestId("plugins-switch"));
    expect(sw.props.value).toBe(false);
    expect(screen.getByText(/each plugin runs alone in a sealed web view/)).toBeTruthy();
    await act(async () => fireEvent(sw, "valueChange", true));
    fireEvent.changeText(await eventually(() => screen.getByTestId("plugin-package")), "clip-plugin-address-label");
    await act(async () => fireEvent.press(screen.getByTestId("plugin-lookup")));
    expect(await eventually(() => screen.getByTestId("plugin-permission-prompt"))).toBeTruthy();
    expect(screen.getByText("Install Address labels 1.0.0?")).toBeTruthy();
    expect(screen.getByText(/See the requests you're asked to approve and add notes to them/)).toBeTruthy();
    expect(screen.getByText(/It can never sign, move your funds, or see your recovery phrase or keys./)).toBeTruthy();
    expect(reg.urls).toEqual(["https://registry.npmjs.org/clip-plugin-address-label", "https://registry.npmjs.org/clip-plugin-address-label/-/clip-plugin-address-label-1.0.0.tgz"]);
    expect((await wallet.plugins!.pluginsStatus()).plugins).toHaveLength(0);
    await act(async () => fireEvent.press(screen.getByTestId("plugin-install")));
    expect(await eventually(() => screen.getByText("Address labels 1.0.0"))).toBeTruthy();
    expect((await wallet.plugins!.pluginsStatus()).plugins.map((p) => p.id)).toEqual(["clip-plugin-address-label"]);
  });

  it("refuses a download that doesn't match npm's checksum", async () => {
    const tarball = pluginTarball("clip-plugin-address-label");
    const reg = fakeRegistry("clip-plugin-address-label", "1.0.0", tarball, { integrity: `sha512-${"A".repeat(86)}==` });
    const wallet = await ready({ plugins: plugins([], reg.f) });
    await wallet.client.setPrefs({ advanced: true });
    await wallet.plugins!.pluginsSetEnabled({ enabled: true });
    renderWith(wallet, <PluginSettings />, { name: "plugins" });
    fireEvent.changeText(await eventually(() => screen.getByTestId("plugin-package")), "clip-plugin-address-label");
    await act(async () => fireEvent.press(screen.getByTestId("plugin-lookup")));
    expect(await eventually(() => screen.getByText("That plugin's download didn't match npm's checksum, so it wasn't installed."))).toBeTruthy();
    expect(screen.queryByTestId("plugin-permission-prompt")).toBeNull();
  });

  it('approval shows a plugin\'s notes in its own "From <plugin>" card, marked as not checked by the wallet', async () => {
    const wallet = await ready({ plugins: plugins([NOTE]) });
    const p = await wallet.client.getPortfolio();
    const eth = p.balances.find((b) => b.asset.symbol === "ETH" && BigInt(b.amount) > 0n)!;
    const id = await wallet.client.send({ assetKey: eth.asset.key, networkId: eth.asset.networkId, to: "0x000000000000000000000000000000000000dEaD", amount: "0.01" });
    const view = (await wallet.client.getApproval(id))!;
    renderWith(wallet, <ApprovalScreen approval={view} onDone={() => undefined} />);
    expect(await eventually(() => screen.getByTestId("plugin-insights"))).toBeTruthy();
    expect(screen.getByText("From Address labels")).toBeTruthy();
    expect(screen.getByText("Burn address")).toBeTruthy();
    expect(screen.getByText("Anything sent to the burn address is gone for good.")).toBeTruthy();
    expect(screen.getByText("Added by the Address labels plugin, not checked by Clip Wallet.")).toBeTruthy();
    // The wallet's own warnings don't contain the plugin's.
    expect(view.decoded!.warnings.some((w) => w.message.includes("burn address"))).toBe(false);
  });
});
