// @vitest-environment jsdom
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { STARKNET_ERRORS, StarknetWalletError, ClipStarknetWallet, injectStarknet, starknetWalletId, toStarknetError } from "../src/inpage/starknet.js";
import { starknetFeltChainId, starknetTonAllowlist } from "../src/background/starknet-ton.js";
import { DEFAULT_IDENTITY } from "../src/shared/config.js";
import { SN_ADDR, SN_NETS, makeBackground } from "./starknet-ton-harness.js";

const page = () => new JSDOM("", { url: "https://dapp.example/" }).window as unknown as Window;
const SEPOLIA = "0x534e5f5345504f4c4941";
const MAIN = "0x534e5f4d41494e";

/** get-starknet-core 4.0.8 discovery: window keys starting with "starknet" whose value has all of these. */
const FULL_WALLET_KEYS = ["id", "name", "version", "icon", "request", "on", "off"];
function discover(win: Window) {
  const w = win as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(win)
    .filter((k) => k.startsWith("starknet"))
    .map((k) => w[k] as Record<string, unknown>)
    .filter((o) => o !== null && typeof o === "object" && FULL_WALLET_KEYS.every((k) => k in o));
}

function setup(o: Parameters<typeof makeBackground>[0] = {}) {
  const bg = makeBackground(o);
  const win = page();
  const wallet = new ClipStarknetWallet(DEFAULT_IDENTITY, bg.transport);
  const inj = injectStarknet(win, wallet);
  return { bg, win, wallet, inj };
}

describe("get-starknet injection", () => {
  it("defines window.starknet_clipwallet that get-starknet's discovery accepts", () => {
    const { win, wallet, inj } = setup();
    expect(inj.key).toBe("starknet_clipwallet");
    expect((win as any).starknet_clipwallet).toBe(wallet);
    expect(discover(win)).toEqual([wallet]);
    expect(wallet).toMatchObject({ id: "clipwallet", name: "Clip Wallet", version: "1.0.0" });
    expect(wallet.icon).toMatch(/^data:image\//);
    expect((win as any).starknet).toBeUndefined();
    inj.stop();
    expect((win as any).starknet_clipwallet).toBeUndefined();
  });

  it("never overwrites another wallet and claims window.starknet only when asked and free", () => {
    const bg = makeBackground();
    const win = page();
    const other = { id: "argentX" };
    (win as any).starknet_clipwallet = other;
    (win as any).starknet = other;
    const wallet = new ClipStarknetWallet(DEFAULT_IDENTITY, bg.transport);
    injectStarknet(win, wallet, { claimWindowStarknet: true });
    expect((win as any).starknet_clipwallet).toBe(other);
    expect((win as any).starknet).toBe(other);
    const win2 = page();
    injectStarknet(win2, wallet, { claimWindowStarknet: true });
    expect((win2 as any).starknet).toBe(wallet);
  });

  it("uses a kit's own name for the id", () => {
    expect(starknetWalletId({ ...DEFAULT_IDENTITY, name: "Acme Wallet!" })).toBe("acmewallet");
  });
});

describe("Starknet wallet API", () => {
  it("answers spec/API versions, chain id and permissions without a prompt", async () => {
    const { wallet, bg } = setup();
    expect(await wallet.request({ type: "wallet_supportedSpecs" })).toEqual(["0.10"]);
    expect(await wallet.request({ type: "wallet_supportedWalletApi" })).toEqual(["0.10"]);
    expect(await wallet.request({ type: "wallet_requestChainId" })).toBe(SEPOLIA);
    expect(starknetFeltChainId(SN_NETS[1]!)).toBe(MAIN);
    expect(await wallet.request({ type: "wallet_getPermissions" })).toEqual([]);
    expect(bg.connects).toHaveLength(0);
  });

  it("wallet_requestAccounts connects once, emits accountsChanged, then answers silently", async () => {
    const { wallet, bg } = setup();
    const seen: unknown[] = [];
    wallet.on("accountsChanged", (a) => seen.push(a));
    expect(await wallet.request({ type: "wallet_requestAccounts", params: { silent_mode: true } })).toEqual([]);
    expect(bg.connects).toHaveLength(0);
    expect(await wallet.request({ type: "wallet_requestAccounts" })).toEqual([SN_ADDR]);
    expect(await wallet.request({ type: "wallet_requestAccounts" })).toEqual([SN_ADDR]);
    expect(bg.connects).toHaveLength(1);
    expect(seen).toEqual([[SN_ADDR]]);
    expect(wallet.selectedAddress).toBe(SN_ADDR);
    expect(await wallet.request({ type: "wallet_getPermissions" })).toEqual(["accounts"]);
  });

  it("maps a declined connect to USER_REFUSED_OP (113)", async () => {
    const { wallet } = setup({ connectOk: false });
    await expect(wallet.request({ type: "wallet_requestAccounts" })).rejects.toMatchObject({ code: STARKNET_ERRORS.USER_REFUSED_OP, message: "An error occurred (USER_REFUSED_OP)" });
  });

  it("switches between shipped networks without a prompt and fires networkChanged", async () => {
    const { wallet } = setup();
    await wallet.request({ type: "wallet_requestAccounts" });
    const changes: unknown[] = [];
    wallet.on("networkChanged", (c, a) => changes.push([c, a]));
    expect(await wallet.request({ type: "wallet_switchStarknetChain", params: { chainId: MAIN } })).toBe(true);
    expect(await wallet.request({ type: "wallet_requestChainId" })).toBe(MAIN);
    expect(await wallet.request({ type: "wallet_switchStarknetChain", params: { chainId: "SN_SEPOLIA" } })).toBe(true);
    expect(changes).toEqual([[MAIN, [SN_ADDR]], [SEPOLIA, [SN_ADDR]]]);
    await expect(wallet.request({ type: "wallet_switchStarknetChain", params: { chainId: "0x1234" } })).rejects.toMatchObject({ code: STARKNET_ERRORS.UNLISTED_NETWORK });
    await expect(wallet.request({ type: "wallet_addStarknetChain", params: { id: "x", chain_id: "0x1234", chain_name: "Evil", rpc_urls: ["https://evil"] } })).rejects.toMatchObject({ code: STARKNET_ERRORS.USER_REFUSED_OP });
    expect(await wallet.request({ type: "wallet_addStarknetChain", params: { id: "m", chain_id: MAIN, chain_name: "Starknet" } })).toBe(true);
  });

  it("signing needs a connection, then goes to the approval path with the selected network", async () => {
    const { wallet, bg } = setup({ approve: (r) => (r.method === "wallet_signTypedData" ? ["0x1", "0x2"] : { transaction_hash: "0xabc" }) });
    const calls = [{ contract_address: "0x1", entry_point: "transfer", calldata: ["0x2", "0x3", "0x0"] }];
    await expect(wallet.request({ type: "wallet_addInvokeTransaction", params: { calls } })).rejects.toMatchObject({ code: STARKNET_ERRORS.USER_REFUSED_OP });
    await wallet.request({ type: "wallet_requestAccounts" });
    expect(await wallet.request({ type: "wallet_addInvokeTransaction", params: { calls, api_version: "0.10" } })).toEqual({ transaction_hash: "0xabc" });
    expect(bg.approvals[0]).toMatchObject({ family: "starknet", networkId: "starknet:SN_SEPOLIA", method: "wallet_addInvokeTransaction", params: { calls } });
    expect((bg.approvals[0]!.params as Record<string, unknown>).api_version).toBeUndefined();
    expect(await wallet.request({ type: "wallet_signTypedData", params: { types: {}, primaryType: "M", domain: {}, message: {} } })).toEqual(["0x1", "0x2"]);
    await expect(wallet.request({ type: "wallet_addInvokeTransaction", params: { calls, api_version: "9.9" } })).rejects.toMatchObject({ code: STARKNET_ERRORS.API_VERSION_NOT_SUPPORTED });
  });

  it("wallet_deploymentData comes from the chain module until the account is deployed", async () => {
    let deployed = false;
    const data = { address: SN_ADDR, class_hash: "0x540d", salt: "0x5", calldata: ["0x5"], version: 1 };
    const { wallet } = setup({ starknetDeploymentData: async () => (deployed ? null : data) });
    await wallet.request({ type: "wallet_requestAccounts" });
    expect(await wallet.request({ type: "wallet_deploymentData" })).toEqual(data);
    deployed = true;
    await expect(wallet.request({ type: "wallet_deploymentData" })).rejects.toMatchObject({ code: STARKNET_ERRORS.ACCOUNT_ALREADY_DEPLOYED });
    expect(await wallet.request({ type: "wallet_watchAsset", params: { type: "ERC20", options: { address: "0x1" } } })).toBe(false);
  });

  it("disconnect from the wallet clears accounts for the site", async () => {
    const { wallet, bg } = setup();
    await wallet.request({ type: "wallet_requestAccounts" });
    const seen: unknown[] = [];
    const h = (a?: string[]) => seen.push(a);
    wallet.on("accountsChanged", h);
    await bg.revoke("starknet");
    expect(seen).toEqual([[]]);
    wallet.off("accountsChanged", h);
    await wallet.request({ type: "wallet_requestAccounts" });
    expect(seen).toEqual([[]]);
  });

  it("rejects malformed calls and unknown methods with spec codes", async () => {
    const { wallet } = setup();
    await expect(wallet.request(undefined as never)).rejects.toBeInstanceOf(StarknetWalletError);
    await expect(wallet.request({ type: "wallet_mystery" })).rejects.toMatchObject({ code: STARKNET_ERRORS.UNKNOWN_ERROR });
    expect(toStarknetError({ code: -32602, message: "bad" })).toMatchObject({ code: 114, data: "bad" });
    expect(starknetTonAllowlist("starknet").has("wallet_addInvokeTransaction")).toBe(true);
    expect(starknetTonAllowlist("evm").size).toBe(0);
  });
});
