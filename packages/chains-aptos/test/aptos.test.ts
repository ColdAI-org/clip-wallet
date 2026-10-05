import { sha3_256 } from "@noble/hashes/sha3.js";
import {
  AccountAddress,
  ChainId,
  Deserializer,
  MultiAgentTransaction,
  RawTransaction,
  SimpleTransaction,
  generateTransactionPayloadWithABI,
  parseTypeTag,
} from "@aptos-labs/ts-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
  APTOS_MAINNET,
  APTOS_NETWORKS,
  APTOS_TESTNET,
  USDC_METADATA,
  aptosAddressFromPublicKey,
  assetKey,
  clearAssetCache,
  createAptosModule,
  entryFunctionOf,
  fromChainId,
  functionId,
  primaryStoreAddress,
  toWalletStandardChain,
} from "../src/index.js";
import { b64decode, b64encode, fromHex } from "../src/util.js";
import { ACCOUNT, APT, USDC_META, type Route, ctxFor, fixtureSigner, mockAptos, req, simulation } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const BOB = FIX.bob;
const signer = fixtureSigner([FIX.transferSig, FIX.feePayerSig, FIX.messageSig]);
const aptos = createAptosModule({ now: () => 1_790_000_000_000 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const simRoute = (sim: unknown): Route => ({ method: "POST", path: /\/transactions\/simulate/, handler: () => sim });
const usdcMeta: Route = { method: "GET", path: new RegExp(`/accounts/${FIX.usdc}/resource/0x1::fungible_asset::Metadata$`), handler: () => USDC_META };

function payload(fn: string, args: unknown[], params: string[], types: string[] = [], tparams: unknown[] = []) {
  return generateTransactionPayloadWithABI({
    function: fn as `${string}::${string}::${string}`,
    typeArguments: types,
    functionArguments: args as never,
    abi: { typeParameters: tparams as never, parameters: params.map((p) => parseTypeTag(p, { allowGenerics: true })) },
  });
}
const raw = (sender: string, p: ReturnType<typeof payload>, chain = 2) =>
  new RawTransaction(AccountAddress.from(sender), 3n, p as never, 2000n, 100n, 1_800_000_000n, new ChainId(chain));

beforeEach(() => clearAssetCache());

describe("networks and addresses", () => {
  it("uses CAIP-2 ids and maps the AIP-62 chains", () => {
    expect(APTOS_NETWORKS.map((n) => n.id).sort()).toEqual(["aptos:1", "aptos:2", "aptos:devnet"]);
    expect(toWalletStandardChain("aptos:2")).toBe("aptos:testnet");
    expect(fromChainId("aptos:testnet")).toBe("aptos:2");
    expect(fromChainId("aptos:mainnet")).toBe("aptos:1");
    expect(fromChainId("aptos:localnet")).toBeNull();
    expect(APTOS_TESTNET.indexerUrl).toBe("https://api.testnet.aptoslabs.com/v1/graphql");
    expect(APTOS_MAINNET.testnet).toBe(false);
  });

  it("keys APT (coin or 0xa asset) and Circle USDC as shared assets", () => {
    expect(assetKey("aptos:2", "0x1::aptos_coin::AptosCoin")).toBe("apt");
    expect(assetKey("aptos:2", "0xa")).toBe("apt");
    expect(assetKey("aptos:2", USDC_METADATA.testnet!)).toBe("usdc");
    expect(assetKey("aptos:1", USDC_METADATA.testnet!)).toBe(`aptos:${USDC_METADATA.testnet}`);
    expect(assetKey("aptos:2", "0xbeef::moon::MOON")).toBe("aptos:0xbeef::moon::MOON");
  });

  it("derives sha3-256(pubkey || 0x00) addresses and primary stores", () => {
    expect(aptosAddressFromPublicKey(fromHex(FIX.publicKey))).toBe(ME);
    expect(aptos.addressFromPublicKey(fromHex(FIX.publicKey), APTOS_TESTNET)).toBe(ME);
    expect(aptos.derivationPath(2)).toBe("m/44'/637'/2'/0'/0'");
    expect(aptos.isAddress(ME)).toBe(true);
    expect(aptos.isAddress("0x1")).toBe(false);
    // Observed on testnet: the primary APT store of 0xc13b…6a7f.
    expect(primaryStoreAddress("0xc13bf4ca86e9c8774911978e9520a0475d06b2defce0ace7b8af190fded96a7f", "0xa")).toBe(
      "0x3b4d4ecf0ed26bb59152ea1c989c41c6be46ef877bc8f69ebb9e16863e503ce8",
    );
  });
});

describe("decode", () => {
  it("describes an APT transfer from the entry function and the simulation", async () => {
    const m = mockAptos([
      simRoute(
        simulation([
          { owner: ME, metadata: APT, delta: -150_000_000n },
          { owner: BOB, metadata: APT, delta: 150_000_000n },
        ]),
      ),
    ]);
    const d = await aptos.decode(req("aptos:signAndSubmitTransaction", { account: ME, chain: "aptos:testnet", transaction: FIX.transfer }), ctxFor(m.fetch));
    expect(d.title).toBe(`Send 1.5 APT to ${short(BOB)}`);
    expect(d.balanceChanges).toEqual([{ asset: { key: "apt", symbol: "APT", name: "Aptos", decimals: 8, networkId: "aptos:2" }, delta: "-150000000" }]);
    expect(d.fee).toEqual({ asset: expect.objectContaining({ key: "apt" }), amount: "6200" });
    expect(d.lines).toEqual([
      { label: "Sends to", value: BOB },
      { label: "Network fee", value: "0.000062 APT" },
    ]);
    expect(d).toMatchObject({ simulated: true, blind: false, warnings: [] });
    const sim = m.calls.find((c) => c.url.includes("/transactions/simulate"))!;
    expect(sim.body).toBeInstanceOf(Uint8Array); // BCS signed transaction with a zeroed signature
  });

  it("finds my primary store without its ObjectCore, and names fungible assets from their metadata", async () => {
    const m = mockAptos([
      usdcMeta,
      simRoute(
        simulation([
          { owner: ME, metadata: FIX.usdc, delta: -2_500_000n, withObjectCore: false },
          { owner: BOB, metadata: FIX.usdc, delta: 2_500_000n },
        ]),
      ),
    ]);
    const d = await aptos.decode(req("aptos:signTransaction", { account: ME, transaction: FIX.usdcTransfer }), ctxFor(m.fetch));
    expect(d.title).toBe(`Send 2.5 USDC to ${short(BOB)}`);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc", symbol: "USDC", decimals: 6, address: FIX.usdc }), delta: "-2500000" }]);
    expect(d.lines).toContainEqual({ label: "Sent by", value: "app.example (it gets your signature)" });
  });

  it("lists other entry functions by module::function", async () => {
    const m = mockAptos([simRoute(simulation([{ owner: ME, metadata: APT, delta: -10_000_000n }]))]);
    const d = await aptos.decode(req("aptos:signTransaction", { account: ME, transaction: FIX.swap }), ctxFor(m.fetch));
    expect(d.title).toBe("Swap exact input on app.example");
    expect(d.lines).toContainEqual({ label: "App action", value: "0xabab…abab::router::swap_exact_input" });
    // Audit UNK-01: an app's own function is never presented as fully understood.
    expect(d.warnings.map((w) => w.code)).toContain("unknown-call");
    expect(d.lines).toContainEqual({ label: "Types", value: "0x1::aptos_coin::AptosCoin" });
  });

  it("warns when the simulation fails or can't run", async () => {
    const failing = mockAptos([simRoute(simulation([], { success: false, vm_status: "Move abort in 0x1::coin: EINSUFFICIENT_BALANCE(0x10006)" }))]);
    const d = await aptos.decode(req("aptos:signTransaction", { account: ME, transaction: FIX.transfer }), ctxFor(failing.fetch));
    expect(d.warnings).toEqual([{ level: "danger", code: "simulation-failed", message: "This transaction would fail: You don't have enough of that asset for this." }]);

    const down = mockAptos([]);
    const d2 = await aptos.decode(req("aptos:signTransaction", { account: ME, transaction: FIX.transfer }), ctxFor(down.fetch));
    expect(d2.simulated).toBe(false);
    expect(d2.title).toBe(`Send 1.5 APT to ${short(BOB)}`); // from the entry function itself
    expect(d2.fee!.amount).toBe("200000"); // max gas × price, an upper bound
    expect(d2.warnings[0]).toMatchObject({ level: "caution", code: "simulation-failed" });
  });

  it("signs as fee payer for someone else's transaction", async () => {
    const m = mockAptos([simRoute(simulation([]))]);
    const r = req("aptos:signTransaction", { account: ME, transaction: FIX.sponsored, asFeePayer: true });
    const d = await aptos.decode(r, ctxFor(m.fetch));
    expect(d.title).toBe(`Pay the network fee: send 0.00000005 APT to ${short(ME)}`);
    expect(d.lines).toContainEqual({ label: "You pay the fee for", value: BOB });
    expect(d.fee!.sponsored).toBeUndefined();
    const [p] = await aptos.prepare(r, ctxFor(m.fetch), "a");
    const out = (await aptos.finalize(r, [signer.sign(p!)], ctxFor(m.fetch))) as { authenticator: string; feePayerAddress: string };
    expect(out.feePayerAddress).toBe(ME);
    expect(b64decode(out.authenticator)[0]).toBe(0); // AccountAuthenticator::Ed25519
  });

  it("shows a sponsor paying when I'm the sender, and a multi-agent role", async () => {
    const m = mockAptos([simRoute(simulation([]))]);
    const sponsoredByApp = new SimpleTransaction(raw(ME, payload("0x1::aptos_account::transfer", [BOB, 1n], ["address", "u64"])), AccountAddress.ZERO);
    const d = await aptos.decode(req("aptos:signTransaction", { account: ME, transaction: b64encode(sponsoredByApp.bcsToBytes()) }), ctxFor(m.fetch));
    expect(d.fee!.sponsored).toBe(true);
    expect(d.lines).toContainEqual({ label: "Network fee", value: "Paid by the app's sponsor" });

    const multi = new MultiAgentTransaction(raw(BOB, payload("0x1::aptos_account::transfer", [ME, 1n], ["address", "u64"])), [AccountAddress.from(ME)]);
    const d2 = await aptos.decode(req("aptos:signTransaction", { account: ME, transaction: b64encode(multi.bcsToBytes()), multiAgent: true }), ctxFor(m.fetch));
    expect(d2.lines).toContainEqual({ label: "Started by", value: BOB });
    expect(d2.fee!.sponsored).toBe(true);
  });

  it("refuses requests that aren't mine or are for another network", async () => {
    const m = mockAptos([]);
    await expect(aptos.decode(req("aptos:signTransaction", { account: BOB, transaction: FIX.transfer }), ctxFor(m.fetch))).rejects.toMatchObject({ code: "aptos/wrong-account" });
    await expect(aptos.decode(req("aptos:signTransaction", { account: ME, transaction: FIX.sponsored }), ctxFor(m.fetch))).rejects.toMatchObject({ code: "aptos/not-a-signer" });
    await expect(aptos.decode(req("aptos:signTransaction", { account: ME, chain: "aptos:mainnet", transaction: FIX.transfer }), ctxFor(m.fetch))).rejects.toMatchObject({
      code: "aptos/network-mismatch",
    });
    const onMainnet = { ...req("aptos:signTransaction", { account: ME, transaction: FIX.transfer }), networkId: "aptos:1" };
    await expect(aptos.decode(onMainnet, { ...ctxFor(m.fetch), network: APTOS_MAINNET })).rejects.toMatchObject({ code: "aptos/network-mismatch" });
    await expect(aptos.decode(req("aptos:signTransaction", { account: ME, transaction: "AAEC" }), ctxFor(m.fetch))).rejects.toMatchObject({ code: "aptos/bad-transaction" });
    await expect(aptos.decode(req("aptos:signAndSubmitTransaction", { account: ME, transaction: FIX.sponsored }), ctxFor(m.fetch))).rejects.toMatchObject({
      code: "aptos/not-a-signer",
    });
  });
});

describe("prepare and finalize", () => {
  it("signs sha3-256('APTOS::RawTransaction') || BCS and returns the SDK's exact authenticator", async () => {
    const m = mockAptos([]);
    const r = req("aptos:signTransaction", { account: ME, transaction: FIX.transfer });
    const [p] = await aptos.prepare(r, ctxFor(m.fetch), "approval-1");
    const tx = SimpleTransaction.deserialize(new Deserializer(b64decode(FIX.transfer)));
    const expected = new Uint8Array([...sha3_256(new TextEncoder().encode("APTOS::RawTransaction")), ...tx.rawTransaction.bcsToBytes()]);
    expect(p).toMatchObject({ accountId: "aptos:0", scheme: "ed25519", approvalId: "approval-1" });
    expect(p!.bytes).toEqual(expected);
    expect(await aptos.finalize(r, [signer.sign(p!)], ctxFor(m.fetch))).toEqual({ authenticator: FIX.transferAuthenticator });
  });

  it("submits the signed transaction as BCS", async () => {
    const m = mockAptos([
      {
        method: "POST",
        path: /\/v1\/transactions$/,
        handler: (body) => {
          expect(b64encode(body as Uint8Array)).toBe(FIX.transferSigned);
          return { hash: "0xfeed" };
        },
        status: 202,
      },
    ]);
    const r = req("aptos:signAndSubmitTransaction", { account: ME, transaction: FIX.transfer });
    const [p] = await aptos.prepare(r, ctxFor(m.fetch), "a");
    expect(await aptos.finalize(r, [signer.sign(p!)], ctxFor(m.fetch))).toEqual({ hash: "0xfeed" });
  });

  it("explains submit failures in plain words and rejects bad signatures", async () => {
    const m = mockAptos([
      { method: "POST", path: /\/v1\/transactions$/, handler: () => ({ message: "Invalid transaction: Type: Validation Code: SEQUENCE_NUMBER_TOO_OLD", error_code: "vm_error" }), status: 400 },
    ]);
    const r = req("aptos:signAndSubmitTransaction", { account: ME, transaction: FIX.transfer });
    const [p] = await aptos.prepare(r, ctxFor(m.fetch), "a");
    await expect(aptos.finalize(r, [signer.sign(p!)], ctxFor(m.fetch))).rejects.toMatchObject({
      code: "aptos/send-failed",
      userMessage: "Another transaction from this account went first. Ask the app to try again.",
    });
    const wrong = { scheme: "ed25519" as const, bytes: fromHex(FIX.messageSig), publicKey: FIX.publicKey };
    await expect(aptos.finalize(r, [wrong], ctxFor(m.fetch))).rejects.toMatchObject({ code: "aptos/bad-signature" });
  });

  it("builds the AIP-62 signMessage text and signs its UTF-8 bytes", async () => {
    const m = mockAptos([]);
    const r = req("aptos:signMessage", { account: ME, message: "Welcome to app.example", nonce: "8f2c", address: true, application: true, chainId: true });
    const d = await aptos.decode(r, ctxFor(m.fetch));
    expect(d).toMatchObject({ title: "Sign a message for app.example", blind: false, lines: [{ label: "Message", value: "Welcome to app.example" }, { label: "For", value: "https://app.example" }] });
    const [p] = await aptos.prepare(r, ctxFor(m.fetch), "a");
    expect(new TextDecoder().decode(p!.bytes)).toBe(FIX.fullMessage);
    expect(await aptos.finalize(r, [signer.sign(p!)], ctxFor(m.fetch))).toEqual({
      address: ME,
      application: "https://app.example",
      chainId: 2,
      fullMessage: FIX.fullMessage,
      message: "Welcome to app.example",
      nonce: "8f2c",
      prefix: "APTOS",
      signature: `0x${FIX.messageSig}`,
    });
  });
});

describe("balances and collectibles", () => {
  it("reads APT from the fullnode and other assets from the indexer", async () => {
    const m = mockAptos([
      { method: "GET", path: new RegExp(`/accounts/${ME}/balance/0x1::aptos_coin::AptosCoin$`), handler: () => "250000000" },
      {
        method: "POST",
        path: /\/v1\/graphql$/,
        handler: (body) => {
          expect((body as { variables: unknown }).variables).toEqual({ owner: ME });
          return {
            data: {
              current_fungible_asset_balances: [
                { asset_type: "0x1::aptos_coin::AptosCoin", amount: "250000000", metadata: { symbol: "APT", decimals: 8, name: "Aptos Coin" } },
                { asset_type: FIX.usdc, amount: "7000000", metadata: { symbol: "USDC", decimals: 6, name: "USDC", icon_uri: "https://circle.example/usdc.svg" } },
                { asset_type: "0xbeef::moon::MOON", amount: "42", metadata: null },
              ],
            },
          };
        },
      },
      { method: "GET", path: /\/accounts\/0xbeef\/resource\/0x1%3A%3Acoin%3A%3ACoinInfo/, handler: () => ({ data: { decimals: 2, symbol: "MOON", name: "Moon" } }) },
    ]);
    expect(await aptos.getBalances(ctxFor(m.fetch))).toEqual([
      { asset: { key: "apt", symbol: "APT", name: "Aptos", decimals: 8, networkId: "aptos:2" }, amount: "250000000" },
      { asset: { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: "aptos:2", address: FIX.usdc, logoUrl: "https://circle.example/usdc.svg" }, amount: "7000000" },
      { asset: { key: "aptos:0xbeef::moon::MOON", symbol: "MOON", name: "Moon", decimals: 2, networkId: "aptos:2", address: "0xbeef::moon::MOON" }, amount: "42" },
    ]);
  });

  it("shows a new account as 0 APT", async () => {
    const m = mockAptos([{ method: "POST", path: /\/v1\/graphql$/, handler: () => ({ data: { current_fungible_asset_balances: [] } }) }]);
    expect(await aptos.getBalances(ctxFor(m.fetch))).toEqual([{ asset: expect.objectContaining({ key: "apt" }), amount: "0" }]);
  });

  it("maps digital assets from the indexer", async () => {
    const m = mockAptos([
      {
        method: "POST",
        path: /\/v1\/graphql$/,
        handler: () => ({
          data: {
            current_token_ownerships_v2: [
              { token_data_id: "0x70", amount: 1, current_token_data: { token_name: "Bear #9", token_uri: "https://img.example/9.png", token_properties: { fur: "gold" }, current_collection: { collection_id: "0xc0", collection_name: "Bears" } } },
              { token_data_id: "0x71", amount: 1, current_token_data: { token_name: "Pass", token_uri: "https://meta.example/71.json", token_properties: {}, current_collection: null } },
            ],
          },
        }),
      },
    ]);
    expect(await aptos.getNfts(ctxFor(m.fetch))).toEqual([
      { networkId: "aptos:2", standard: "aptos-digital-asset", collection: { address: "0xc0", name: "Bears" }, tokenId: "0x70", name: "Bear #9", mediaUrl: "https://img.example/9.png", attributes: [{ trait: "fur", value: "gold" }] },
      { networkId: "aptos:2", standard: "aptos-digital-asset", collection: { address: "", name: "Collection" }, tokenId: "0x71", name: "Pass" },
    ]);
  });
});

describe("building transactions", () => {
  const chainRoutes = (seq = "7"): Route[] => [
    { method: "GET", path: new RegExp(`/accounts/${ME}$`), handler: () => ({ sequence_number: seq, authentication_key: ME }) },
    { method: "GET", path: /\/estimate_gas_price$/, handler: () => ({ gas_estimate: 100, prioritized_gas_estimate: 150 }) },
    simRoute(simulation([], { gas_used: "1800" })),
  ];

  function builtTx(r: { params: unknown }) {
    const t = (r.params as { inputs: { transaction: string }[] }).inputs[0]!.transaction;
    return SimpleTransaction.deserialize(new Deserializer(b64decode(t)));
  }

  it("builds APT, fungible-asset and coin sends sized by a simulation", async () => {
    const m = mockAptos(chainRoutes());
    const ctx = ctxFor(m.fetch);
    const apt = await aptos.buildTransfer({ asset: APTOS_TESTNET.nativeAsset, to: BOB, amount: "150000000" }, ctx);
    expect(apt).toMatchObject({ origin: "clip-wallet", family: "aptos", networkId: "aptos:2", method: "aptos:signAndSubmitTransaction" });
    const t = builtTx(apt);
    expect(functionId(entryFunctionOf(t)!)).toBe("0x1::aptos_account::transfer");
    expect(t.rawTransaction.sequence_number).toBe(7n);
    expect(t.rawTransaction.gas_unit_price).toBe(100n);
    expect(t.rawTransaction.max_gas_amount).toBe(2700n); // 1.5 × 1800
    expect(t.rawTransaction.chain_id.chainId).toBe(2);
    expect(t.rawTransaction.expiration_timestamp_secs).toBe(1_790_000_600n);
    expect(m.calls.find((c) => c.url.includes("simulate"))!.url).toMatch(/estimate_max_gas_amount=true/);

    const usdc = { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: "aptos:2", address: FIX.usdc };
    expect(functionId(entryFunctionOf(builtTx(await aptos.buildTransfer({ asset: usdc, to: BOB, amount: "1" }, ctx)))!)).toBe("0x1::primary_fungible_store::transfer");
    const moon = { key: "aptos:0xbeef::moon::MOON", symbol: "MOON", name: "Moon", decimals: 2, networkId: "aptos:2", address: "0xbeef::moon::MOON" };
    const coin = entryFunctionOf(builtTx(await aptos.buildTransfer({ asset: moon, to: BOB, amount: "1" }, ctx)))!;
    expect(functionId(coin)).toBe("0x1::aptos_account::transfer_coins");
    expect(coin.type_args[0]!.toString()).toBe(`0x${"0".repeat(60)}beef::moon::MOON`);
  });

  it("refuses bad recipients, amounts and transfers that would fail", async () => {
    const ctx = ctxFor(mockAptos(chainRoutes()).fetch);
    await expect(aptos.buildTransfer({ asset: APTOS_TESTNET.nativeAsset, to: "bob", amount: "1" }, ctx)).rejects.toMatchObject({ code: "aptos/bad-address" });
    await expect(aptos.buildTransfer({ asset: APTOS_TESTNET.nativeAsset, to: ME, amount: "1" }, ctx)).rejects.toMatchObject({ code: "aptos/self-transfer" });
    await expect(aptos.buildTransfer({ asset: APTOS_TESTNET.nativeAsset, to: BOB, amount: "-1" }, ctx)).rejects.toMatchObject({ code: "aptos/bad-amount" });
    const poor = mockAptos([...chainRoutes().slice(0, 2), simRoute(simulation([], { success: false, vm_status: "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE" }))]);
    await expect(aptos.buildTransfer({ asset: APTOS_TESTNET.nativeAsset, to: BOB, amount: "1" }, ctxFor(poor.fetch))).rejects.toMatchObject({
      userMessage: "You don't have enough APT to pay the network fee.",
    });
  });

  it("builds a dapp's entry-function payload from its on-chain ABI", async () => {
    const m = mockAptos([
      ...chainRoutes("0"),
      {
        method: "GET",
        path: /\/accounts\/0x0{60}cafe\/module\/game$/,
        handler: () => ({
          abi: { exposed_functions: [{ name: "play", is_entry: true, generic_type_params: [], params: ["&signer", "u64", "vector<u8>", "address"] }] },
        }),
      },
    ]);
    const r = req("aptos:signAndSubmitTransaction", {
      account: ME,
      chain: "aptos:testnet",
      payload: { function: "0xcafe::game::play", functionArguments: ["1000", { $bytes: "0x0102" }, BOB] },
    });
    const d = await createAptosModule({ simulate: false }).decode(r, ctxFor(m.fetch));
    expect(d.title).toBe("Play on app.example");
    expect(d.lines).toContainEqual({ label: "App action", value: "0x0000…cafe::game::play" });
    const mod = createAptosModule({ simulate: false });
    const [p1] = await mod.prepare(r, ctxFor(m.fetch), "a");
    const [p2] = await mod.prepare(r, ctxFor(m.fetch), "a");
    expect(p2!.bytes).toEqual(p1!.bytes); // cached per request: the same transaction is shown, signed and sent
    const missing = req("aptos:signAndSubmitTransaction", { account: ME, payload: { function: "0xcafe::game::cheat", functionArguments: [] } });
    await expect(mod.decode(missing, ctxFor(m.fetch))).rejects.toMatchObject({ code: "aptos/no-abi" });
    expect(ACCOUNT.address).toBe(ME);
  });
});
