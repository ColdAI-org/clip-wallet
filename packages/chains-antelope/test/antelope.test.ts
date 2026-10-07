import { type DappRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import { Checksum256, PublicKey, Signature as WkSignature } from "@wharfkit/antelope";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTELOPE_METHODS,
  ANTELOPE_NETWORKS,
  JUNGLE4,
  TELOS_MAINNET,
  VAULTA_MAINNET,
  XPR_MAINNET,
  assetFor,
  clearAbiCache,
  createAntelopeModule,
  netOf,
  packTransaction,
  signingDigest,
  transactionId,
  unpackTransaction,
} from "../src/index.js";
import { fromHex, hex } from "../src/bytes.js";
import { BOB, EOS_SEND, INFO, LEGACY, ME, PUB_HEX, PUB_K1, TAKEOVER, TAKEOVER_DATA } from "./fixtures.js";
import { ctxFor, err, mockChain, signer } from "./helpers.js";
import { SIGS } from "./signatures.js";

const mod = createAntelopeModule({ accountsTtlMs: 0 });
const eos = JUNGLE4.nativeAsset;

function req(method: string, params: unknown, over: Partial<DappRequest> = {}): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin: "https://dapp.example", via: "injected", family: "antelope", networkId: JUNGLE4.id, method, params, ...over };
}

beforeEach(() => clearAbiCache());

describe("networks", () => {
  it("uses ChainAgnostic antelope: ids (first 32 hex of the chain id)", () => {
    expect(VAULTA_MAINNET.id).toBe("antelope:aca376f206b8fc25a6ed44dbdc66547c");
    expect(TELOS_MAINNET.id).toBe("antelope:4667b205c6838ef70ff7988f6e8257e8");
    expect(JUNGLE4.id).toBe("antelope:73e4385a2708e6d7048834fbc1079f2f");
    expect(XPR_MAINNET.id).toBe("antelope:384da888112027f0321850a169f737c3");
    expect(ANTELOPE_NETWORKS.filter((n) => n.testnet).map((n) => n.name)).toEqual(["Jungle4 (Vaulta testnet)", "Telos Testnet", "XPR Network Testnet"]);
    expect(netOf(INFO.chain_id)).toBe("jungle4");
    expect(netOf("antelope:1064487b3cd1a897ce03ae5b6a865651")).toBeNull(); // WAX isn't one of ours
    expect(VAULTA_MAINNET.nativeAsset).toMatchObject({ key: "eos", symbol: "EOS", decimals: 4 });
  });

  it("known tokens keep their key; look-alikes from other contracts are spam", () => {
    expect(assetFor(VAULTA_MAINNET.id, "tethertether", "USDT", 4)).toMatchObject({ key: "usdt", address: "tethertether:USDT" });
    expect(assetFor(VAULTA_MAINNET.id, "core.vaulta", "A", 4)).toMatchObject({ key: "vaulta" });
    expect(assetFor(VAULTA_MAINNET.id, "fakeusdt1111", "USDT", 4).spam).toBe(true);
    expect(assetFor(XPR_MAINNET.id, "ternary", "XPR", 1).spam).toBe(true); // seen on XPR mainnet
    expect(assetFor(VAULTA_MAINNET.id, "eosiopowcoin", "POW", 8).spam).toBeUndefined();
  });
});

describe("keys and accounts", () => {
  it("the address is the PUB_K1 key (matches WharfKit); account names are what you send to", () => {
    expect(mod.addressFromPublicKey(fromHex(PUB_HEX), JUNGLE4)).toBe(PUB_K1);
    expect(PublicKey.from(PUB_K1).toLegacyString()).toBe(LEGACY);
    expect(mod.derivationPath(3)).toBe("m/44'/194'/0'/0/3");
    expect(mod.isAddress("bobbobbob123")).toBe(true);
    expect(mod.isAddress(PUB_K1)).toBe(false);
    expect(mod.isAddress("Bob")).toBe(false);
    expect(mod.networksForAddress("eosio.token", ANTELOPE_NETWORKS)).toHaveLength(6);
  });

  it("receiveAddress: the account name on that network, discovered by key (chain API, then Hyperion)", async () => {
    expect(await mod.receiveAddress(ctxFor(mockChain().fetch))).toBe(ME);
    const hyperionOnly = mockChain({ "/v1/chain/get_accounts_by_authorizers": () => err("exception", 0, "Unknown Endpoint", 404), "/v2/state/get_key_accounts": () => ({ account_names: ["fromhyperion"] }) });
    expect(await mod.receiveAddress(ctxFor(hyperionOnly.fetch))).toBe("fromhyperion");
    expect(hyperionOnly.calls.some((c) => c.url.startsWith("https://jungle4.cryptolions.io/v2/state/get_key_accounts?public_key=PUB_K1_"))).toBe(true);
    const none = ctxFor(mockChain({ "/v1/chain/get_accounts_by_authorizers": () => ({ accounts: [] }) }).fetch);
    await expect(mod.receiveAddress(none)).rejects.toMatchObject({ code: "antelope/no-account", userMessage: expect.stringContaining("No Jungle4 (Vaulta testnet) account uses this key yet") });
    // A permission this key only partly controls (weight below the threshold) doesn't count.
    const multi = ctxFor(mockChain({ "/v1/chain/get_accounts_by_authorizers": () => ({ accounts: [{ account_name: "shared", permission_name: "active", authorizing_key: PUB_K1, weight: 1, threshold: 2 }] }) }).fetch);
    await expect(mod.receiveAddress(multi)).rejects.toMatchObject({ code: "antelope/no-account" });
  });
});

describe("balances", () => {
  it("core and known tokens from get_currency_balance, others from Hyperion with the spam check", async () => {
    const b = await mod.getBalances(ctxFor(mockChain().fetch));
    expect(b.map((x) => [x.asset.key, x.amount, x.asset.spam ?? false])).toEqual([
      ["eos", "100000", false],
      ["vaulta", "25000", false],
      ["antelope:eosfakecoin1:EOS", "500000", true],
      ["antelope:eosio.token:JUNGLE", "1000000", false],
    ]);
    const none = ctxFor(mockChain({ "/v1/chain/get_accounts_by_authorizers": () => ({ accounts: [] }) }).fetch);
    expect(await mod.getBalances(none)).toEqual([{ asset: eos, amount: "0" }]);
  });
});

describe("buildTransfer → decode → prepare → finalize", () => {
  it("sends EOS with eosio.token::transfer (no ABI round trip), signature cross-checked with WharfKit", async () => {
    const { fetch, calls } = mockChain();
    const ctx = ctxFor(fetch);
    const r = await mod.buildTransfer({ asset: eos, to: BOB, amount: "15000" }, ctx);
    expect(r).toMatchObject({ origin: WALLET_ORIGIN, method: ANTELOPE_METHODS.signAndPushTransaction, family: "antelope", networkId: JUNGLE4.id });
    expect((r.params as { transaction: unknown }).transaction).toEqual(EOS_SEND);
    const d = await mod.decode(r, ctx);
    expect(d.title).toBe(`Send 1.5000 EOS to ${BOB}`);
    expect(d.balanceChanges).toEqual([{ asset: eos, delta: "-15000" }]);
    expect(d.lines).toContainEqual({ label: "Network fee", value: "None in tokens: it uses your account's CPU and NET" });
    expect(d.warnings).toEqual([]);
    expect(d.blind).toBe(false);
    const [p] = await mod.prepare(r, ctx, "a");
    const packed = packTransaction(EOS_SEND);
    expect(hex(p!.bytes)).toBe(hex(signingDigest(INFO.chain_id, packed)));
    const out = (await mod.finalize(r, [signer.sign(p!)], ctx)) as { transaction_id: string };
    const sent = calls.find((c) => c.path === "/v1/chain/send_transaction2")!.body as { transaction: { signatures: string[]; packed_trx: string } };
    expect(sent.transaction.packed_trx).toBe(hex(packed));
    const sig = WkSignature.from(sent.transaction.signatures[0]!);
    expect(sig.verifyDigest(Checksum256.from(p!.bytes), PublicKey.from(PUB_K1))).toBe(true);
    expect(sig.recoverDigest(Checksum256.from(p!.bytes)).toString()).toBe(PUB_K1);
    expect(out.transaction_id).toBe("will-be-replaced");
    expect(calls.some((c) => c.path === "/v1/chain/get_abi")).toBe(false);
  });

  it("refuses in plain words: bad name, own account, unknown recipient, not enough", async () => {
    const ctx = ctxFor(mockChain().fetch);
    await expect(mod.buildTransfer({ asset: eos, to: "Not A Name", amount: "1" }, ctx)).rejects.toMatchObject({ code: "antelope/bad-address" });
    await expect(mod.buildTransfer({ asset: eos, to: ME, amount: "1" }, ctx)).rejects.toMatchObject({ code: "antelope/self-transfer" });
    await expect(mod.buildTransfer({ asset: eos, to: BOB, amount: "200000" }, ctx)).rejects.toMatchObject({ code: "antelope/insufficient-token" });
    const noBob = ctxFor(mockChain({ "/v1/chain/get_account": (b) => (b.account_name === BOB ? err("account_query_exception", 3060002, "unknown key") : { account_name: b.account_name }) }).fetch);
    await expect(mod.buildTransfer({ asset: eos, to: BOB, amount: "1" }, noBob)).rejects.toMatchObject({ code: "antelope/bad-recipient" });
  });

  it("puts CPU, NET and RAM exhaustion in plain words per network", async () => {
    const cpu = mockChain({ "/v1/chain/send_transaction2": () => err("tx_cpu_usage_exceeded", 3080004, "billed CPU time (300 us) is greater than the maximum billable CPU time for the transaction (0 us)") });
    const ctx = ctxFor(cpu.fetch);
    const r = await mod.buildTransfer({ asset: eos, to: BOB, amount: "15000" }, ctx);
    await mod.decode(r, ctx);
    const [p] = await mod.prepare(r, ctx, "a");
    await expect(mod.finalize(r, [signer.sign(p!)], ctx)).rejects.toMatchObject({ code: "antelope/insufficient-resources", userMessage: expect.stringContaining("PowerUp") });
  });

  it("refuses a bad or non-canonical signature before sending", async () => {
    const { fetch, calls } = mockChain();
    const ctx = ctxFor(fetch);
    const r = await mod.buildTransfer({ asset: eos, to: BOB, amount: "15000" }, ctx);
    await mod.decode(r, ctx);
    await mod.prepare(r, ctx, "a");
    const other = { scheme: "ecdsa-secp256k1" as const, bytes: fromHex(SIGS.TAKEOVER.rs), recovery: 0, publicKey: PUB_HEX };
    await expect(mod.finalize(r, [other], ctx)).rejects.toMatchObject({ code: "antelope/bad-signature" });
    const right = signer.sign((await mod.prepare(r, ctx, "a"))[0]!);
    await expect(mod.finalize(r, [{ ...right, recovery: 1 }], ctx)).rejects.toMatchObject({ code: "antelope/bad-signature" });
    expect(calls.some((c) => c.path === "/v1/chain/send_transaction2")).toBe(false);
  });
});

describe("dapp-shaped requests", () => {
  it("updateauth is account-takeover; JSON data is serialised with the contract's ABI; sign-only returns SIG_K1", async () => {
    const { fetch, calls } = mockChain();
    const ctx = ctxFor(fetch);
    const tx = { ...TAKEOVER, actions: [{ ...TAKEOVER.actions[0]!, data: TAKEOVER_DATA }] };
    const r = req(ANTELOPE_METHODS.signTransaction, { transaction: tx });
    const d = await mod.decode(r, ctx);
    expect(d.title).toBe(`Change who controls the active permission of ${ME}`);
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "account-takeover" });
    expect(d.lines).toContainEqual({ label: "Sent by", value: "dapp.example (it gets the signed transaction)" });
    const [p] = await mod.prepare(r, ctx, "a");
    const out = (await mod.finalize(r, [signer.sign(p!)], ctx)) as { signatures: string[]; packed_trx: string; transaction_id: string };
    expect(unpackTransaction(fromHex(out.packed_trx))).toEqual(TAKEOVER);
    expect(out.transaction_id).toBe(transactionId(fromHex(out.packed_trx)));
    expect(WkSignature.from(out.signatures[0]!).verifyDigest(Checksum256.from(p!.bytes), PublicKey.from(PUB_K1))).toBe(true);
    expect(calls.filter((c) => c.path === "/v1/chain/get_abi")).toHaveLength(1);
    expect(calls.some((c) => c.path === "/v1/chain/send_transaction2")).toBe(false);
  });

  it("any other action is read through its ABI with a caution; unknown ABI types are blind", async () => {
    const ctx = ctxFor(mockChain().fetch);
    const call = { ...EOS_SEND, actions: [{ account: "eosio", name: "buyrambytes", authorization: [{ actor: ME, permission: "active" }], data: { payer: ME, receiver: ME, bytes: 4096 } }] };
    const d = await mod.decode(req(ANTELOPE_METHODS.signAndPushTransaction, { transaction: call }), ctx);
    expect(d.title).toBe("Call buyrambytes on eosio");
    expect(d.lines).toEqual(expect.arrayContaining([{ label: "payer", value: ME }, { label: "bytes", value: "4096" }]));
    expect(d.warnings[0]).toMatchObject({ level: "caution", code: "unknown-call" });
    const blind = { ...EOS_SEND, actions: [{ account: "somedapp1111", name: "play", authorization: [{ actor: ME, permission: "active" }], data: "0102" }] };
    const b = await mod.decode(req(ANTELOPE_METHODS.signAndPushTransaction, { transaction: blind }), ctx);
    expect(b.blind).toBe(true);
    expect(b.warnings[0]).toMatchObject({ code: "blind-signing" });
  });

  it("a transfer of an unknown contract's token gets a caution; a look-alike is a scam warning", async () => {
    const tokenAbi = {
      version: "eosio::abi/1.2",
      structs: [{ name: "transfer", base: "", fields: [{ name: "from", type: "name" }, { name: "to", type: "name" }, { name: "quantity", type: "asset" }, { name: "memo", type: "string" }] }],
      actions: [{ name: "transfer", type: "transfer" }],
    };
    const ctx = ctxFor(mockChain({ "/v1/chain/get_abi": (b) => ({ account_name: b.account_name, abi: tokenAbi }) }).fetch);
    const send = (contract: string, quantity: string) => ({ ...EOS_SEND, actions: [{ account: contract, name: "transfer", authorization: [{ actor: ME, permission: "active" }], data: { from: ME, to: BOB, quantity, memo: "gm" } }] });
    const unknown = await mod.decode(req(ANTELOPE_METHODS.signAndPushTransaction, { transaction: send("gamecoins111", "5.00 GAME") }), ctx);
    expect(unknown.title).toBe(`Send 5.00 GAME to ${BOB}`);
    expect(unknown.warnings[0]).toMatchObject({ level: "caution", code: "unknown-call" });
    expect(unknown.lines).toContainEqual({ label: "Memo", value: "gm" });
    const fake = await mod.decode(req(ANTELOPE_METHODS.signAndPushTransaction, { transaction: send("eosfakecoin1", "1.0000 EOS") }), ctx);
    expect(fake.warnings[0]).toMatchObject({ level: "danger", code: "known-scam" });
  });

  it("refuses another network, other signers on sign-and-push, a key that doesn't hold the permission, context-free actions", async () => {
    const ctx = ctxFor(mockChain().fetch);
    expect(() => mod.normalize(req(ANTELOPE_METHODS.signTransaction, { transaction: EOS_SEND }, { networkId: VAULTA_MAINNET.id }), ctx)).toThrow(expect.objectContaining({ code: "antelope/network-mismatch" }));
    expect(() => mod.normalize(req(ANTELOPE_METHODS.signTransaction, { transaction: EOS_SEND, chainId: VAULTA_MAINNET.id }), ctx)).toThrow(expect.objectContaining({ code: "antelope/network-mismatch" }));
    expect(() => mod.normalize(req(ANTELOPE_METHODS.signTransaction, { transaction: { ...EOS_SEND, context_free_actions: [EOS_SEND.actions[0]] } }), ctx)).toThrow(expect.objectContaining({ code: "antelope/unsupported" }));
    expect(() => mod.normalize(req("eosio_signArbitrary", {}), ctx)).toThrow(expect.objectContaining({ code: "antelope/unsupported-method" }));
    const twoSigners = { ...EOS_SEND, actions: [{ ...EOS_SEND.actions[0]!, authorization: [{ actor: ME, permission: "active" }, { actor: BOB, permission: "active" }] }] };
    await expect(mod.decode(req(ANTELOPE_METHODS.signAndPushTransaction, { transaction: twoSigners }), ctx)).rejects.toMatchObject({ code: "antelope/missing-signature" });
    const coSign = await mod.decode(req(ANTELOPE_METHODS.signTransaction, { transaction: twoSigners }), ctx);
    expect(coSign.lines).toContainEqual({ label: "Also needs", value: `${BOB}@active` });
    const custom = { ...EOS_SEND, actions: [{ ...EOS_SEND.actions[0]!, authorization: [{ actor: ME, permission: "trading" }] }] };
    await expect(mod.decode(req(ANTELOPE_METHODS.signAndPushTransaction, { transaction: custom }), ctx)).rejects.toMatchObject({ code: "antelope/wrong-account" });
    const notMine = { ...EOS_SEND, actions: [{ ...EOS_SEND.actions[0]!, authorization: [{ actor: BOB, permission: "active" }] }] };
    await expect(mod.decode(req(ANTELOPE_METHODS.signAndPushTransaction, { transaction: notMine }), ctx)).rejects.toMatchObject({ code: "antelope/wrong-account" });
  });

  it("fills a missing header once (TAPoS from the last irreversible block, expiry 5 minutes after head)", async () => {
    const { fetch, calls } = mockChain();
    const ctx = ctxFor(fetch);
    const { expiration: _e, ref_block_num: _n, ref_block_prefix: _p, ...rest } = EOS_SEND;
    const r = req(ANTELOPE_METHODS.signTransaction, { transaction: rest });
    await mod.decode(r, ctx);
    const [p] = await mod.prepare(r, ctx, "a");
    expect(hex(p!.bytes)).toBe(hex(signingDigest(INFO.chain_id, packTransaction(EOS_SEND))));
    expect(calls.filter((c) => c.path === "/v1/chain/get_info")).toHaveLength(1);
  });
});
