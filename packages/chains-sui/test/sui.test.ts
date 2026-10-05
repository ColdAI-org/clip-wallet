import { ClipError } from "@clip-wallet/core";
import { bcs } from "@mysten/sui/bcs";
import { messageWithIntent } from "@mysten/sui/cryptography";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { blake2b } from "@noble/hashes/blake2.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SUI_MAINNET,
  SUI_NETWORKS,
  SUI_TESTNET,
  USDC_COIN_TYPES,
  clearCoinCache,
  coinAssetKey,
  createSuiModule,
  fromChainId,
  plainSuiError,
  serializeSignature,
  suiAddressFromPublicKey,
  toWalletStandardChain,
} from "../src/index.js";
import { b64decode, b64encode, fromHex } from "../src/util.js";
import { ACCOUNT, SUI, USDC, ctxFor, fixtureSigner, metadata, mockGql, req, simResult } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const BOB = FIX.bob;
const signer = fixtureSigner([FIX.transferSig, FIX.swapSig, FIX.messageSig]);
const sui = createSuiModule();
const meta = () => ({ clipCoinMetadata: (v: Record<string, unknown>) => ({ coinMetadata: metadata[v.coinType as string] ?? null }) });
const ws = (method: string, transaction: string, extra: Record<string, unknown> = {}) =>
  req(method, { inputs: [{ account: ME, transaction, chain: "sui:testnet", ...extra }] });
/** gas: 1_000_000 + 988_000 − 978_120 */
const FEE = 1_009_880n;

beforeEach(() => clearCoinCache());

describe("networks and addresses", () => {
  it("uses CAIP-2 ids that are also the Wallet Standard chains", () => {
    expect(SUI_NETWORKS.map((n) => n.id).sort()).toEqual(["sui:devnet", "sui:mainnet", "sui:testnet"]);
    expect(SUI_TESTNET.testnet).toBe(true);
    expect(SUI_MAINNET.testnet).toBe(false);
    expect(toWalletStandardChain("sui:testnet")).toBe("sui:testnet");
    expect(fromChainId("sui:localnet")).toBeNull();
    expect(SUI_TESTNET.rpcUrls[0]).toBe("https://graphql.testnet.sui.io/graphql");
  });

  it("keys SUI and Circle USDC as shared assets, others by coin type", () => {
    expect(coinAssetKey("sui:testnet", "0x2::sui::SUI")).toBe("sui");
    expect(coinAssetKey("sui:testnet", USDC)).toBe("usdc");
    expect(USDC_COIN_TYPES.testnet).toBe(USDC);
    expect(coinAssetKey("sui:mainnet", USDC)).toBe(`sui:${USDC}`); // testnet USDC is not mainnet USDC
  });

  it("derives the address as blake2b-256(0x00 || pubkey) and matches the offline SDK account", () => {
    expect(suiAddressFromPublicKey(fromHex(FIX.publicKey))).toBe(ME);
    expect(sui.addressFromPublicKey(fromHex(FIX.publicKey), SUI_TESTNET)).toBe(ME);
    expect(sui.derivationPath(0)).toBe("m/44'/784'/0'/0'/0'");
    expect(sui.isAddress(ME)).toBe(true);
    expect(sui.isAddress("0x2")).toBe(false);
    expect(sui.networksForAddress(ME, SUI_NETWORKS)).toHaveLength(3);
  });
});

describe("decode", () => {
  it("describes a SUI transfer with the dry run's balance change and gas", async () => {
    const m = mockGql({
      ...meta(),
      clipSimulate: () =>
        simResult([
          [ME, SUI, (-(1_500_000_000n + FEE)).toString()],
          [BOB, SUI, "1500000000"],
        ]),
    });
    const d = await sui.decode(ws("sui:signAndExecuteTransaction", FIX.transfer), ctxFor(m.fetch));
    expect(d.title).toBe(`Send 1.5 SUI to ${BOB.slice(0, 6)}…${BOB.slice(-4)}`);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "sui", decimals: 9 }), delta: "-1500000000" }]);
    expect(d.fee).toEqual({ asset: expect.objectContaining({ key: "sui" }), amount: FEE.toString() });
    expect(d.simulated).toBe(true);
    expect(d.blind).toBe(false);
    expect(d.warnings).toEqual([]);
    expect(d.lines).toContainEqual({ label: "Sends to", value: BOB });
    expect(d.lines.find((l) => l.label === "Network fee")!.value).toBe("0.00100988 SUI (at most 0.003)");
    // the simulation got the exact BCS bytes
    expect(m.calls.find((c) => c.op === "clipSimulate")!.variables).toEqual({ tx: { bcs: { value: FIX.transfer } } });
  });

  it("lists Move calls by package::module::function and shows what moves", async () => {
    const m = mockGql({
      ...meta(),
      clipSimulate: () =>
        simResult([
          [ME, SUI, (-(100_000_000n + FEE)).toString()],
          [ME, USDC, "5000000"],
        ]),
    });
    const d = await sui.decode(ws("sui:signTransaction", FIX.swap), ctxFor(m.fetch));
    expect(d.title).toBe("Swap exact a for b on app.example");
    expect(d.lines).toContainEqual({ label: "App action", value: "0xabab…abab::pool::swap_exact_a_for_b" });
    // Audit UNK-01: an app's own function is never presented as fully understood.
    expect(d.warnings.map((w) => w.code)).toContain("unknown-call");
    expect(d.lines).toContainEqual({ label: "Sent by", value: "app.example (it gets the signed transaction)" });
    expect(d.balanceChanges).toEqual([
      { asset: expect.objectContaining({ key: "sui" }), delta: "-100000000" },
      { asset: expect.objectContaining({ key: "usdc", symbol: "USDC", decimals: 6, address: USDC }), delta: "5000000" },
    ]);
  });

  it("recognises staking", async () => {
    const m = mockGql({ ...meta(), clipSimulate: () => simResult([[ME, SUI, (-(2_000_000_000n + FEE)).toString()]]) });
    const d = await sui.decode(ws("sui:signAndExecuteTransaction", FIX.stake), ctxFor(m.fetch));
    expect(d.title).toBe("Stake 2 SUI");
    expect(d.lines).toContainEqual({ label: "Stake with", value: `0x${"5a".repeat(32)}` });
  });

  it("warns when the dry run fails, and still decodes when the dry run can't run", async () => {
    const failing = mockGql({ ...meta(), clipSimulate: () => simResult([], undefined, "FAILURE") });
    const d = await sui.decode(ws("sui:signTransaction", FIX.swap), ctxFor(failing.fetch));
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "simulation-failed" }));
    expect(d.warnings[0]!.message).toMatch(/contract refused/);

    const down = mockGql({
      ...meta(),
      clipSimulate: () => {
        throw new Error("timeout");
      },
    });
    const d2 = await sui.decode(ws("sui:signTransaction", FIX.transfer), ctxFor(down.fetch));
    expect(d2.simulated).toBe(false);
    expect(d2.title).toBe(`Send 1.5 SUI to ${BOB.slice(0, 6)}…${BOB.slice(-4)}`); // from the PTB itself
    expect(d2.fee!.amount).toBe("3000000"); // the budget, as an upper bound
    expect(d2.warnings).toContainEqual(expect.objectContaining({ code: "simulation-failed", level: "caution" }));
  });

  it("marks sponsored transactions and never sends them itself", async () => {
    const tx = Transaction.from(FIX.transfer);
    tx.setGasOwner(BOB);
    const bytes = await tx.build();
    const m = mockGql({ ...meta(), clipSimulate: () => simResult([[ME, SUI, "-1500000000"], [BOB, SUI, "1500000000"]]) });
    const d = await sui.decode(ws("sui:signTransaction", b64encode(bytes)), ctxFor(m.fetch));
    expect(d.fee!.sponsored).toBe(true);
    expect(d.balanceChanges[0]!.delta).toBe("-1500000000"); // no fee taken out: I don't pay it
    expect(d.lines).toContainEqual({ label: "Network fee", value: `Paid by ${BOB.slice(0, 6)}…${BOB.slice(-4)}` });
  });

  it("refuses other accounts, other networks and transactions from someone else", async () => {
    const m = mockGql(meta());
    await expect(sui.decode(req("sui:signTransaction", { inputs: [{ account: BOB, transaction: FIX.transfer }] }), ctxFor(m.fetch))).rejects.toMatchObject({
      code: "sui/wrong-account",
    });
    await expect(sui.decode(ws("sui:signTransaction", FIX.transfer, { chain: "sui:mainnet" }), ctxFor(m.fetch))).rejects.toMatchObject({ code: "sui/network-mismatch" });
    const other = Transaction.from(FIX.transfer);
    other.setSender(BOB);
    await expect(sui.decode(ws("sui:signTransaction", b64encode(await other.build())), ctxFor(m.fetch))).rejects.toMatchObject({ code: "sui/not-a-signer" });
    await expect(sui.decode(ws("sui:signTransaction", "AAEC"), ctxFor(m.fetch))).rejects.toMatchObject({ code: "sui/bad-transaction" });
    await expect(sui.decode(req("sui:signMessage", {}), ctxFor(m.fetch))).rejects.toBeInstanceOf(ClipError);
  });

  it("shows personal messages as text, or as hex marked blind", async () => {
    const m = mockGql({});
    const d = await sui.decode(req("sui:signPersonalMessage", { inputs: [{ account: ME, message: btoa("Hello Sui") }] }), ctxFor(m.fetch));
    expect(d).toMatchObject({ title: "Sign a message for app.example", blind: false, lines: [{ label: "Message", value: "Hello Sui" }] });
    const bin = await sui.decode(req("sui:signPersonalMessage", { inputs: [{ account: ME, message: b64encode(new Uint8Array([0, 1, 2])) }] }), ctxFor(m.fetch));
    expect(bin.blind).toBe(true);
    expect(bin.warnings[0]!.code).toBe("blind-signing");
  });
});

describe("prepare and finalize", () => {
  it("signs blake2b-256(intent || BCS): exactly the bytes Sui's ed25519 signature covers", async () => {
    const m = mockGql({});
    const r = ws("sui:signTransaction", FIX.transfer);
    const [p] = await sui.prepare(r, ctxFor(m.fetch), "approval-1");
    const expected = blake2b(new Uint8Array([0, 0, 0, ...b64decode(FIX.transfer)]), { dkLen: 32 });
    expect(p).toMatchObject({ accountId: "sui:0", scheme: "ed25519", approvalId: "approval-1" });
    expect(p!.bytes).toEqual(expected);
    expect(p!.bytes).toEqual(blake2b(messageWithIntent("TransactionData", b64decode(FIX.transfer)), { dkLen: 32 }));
    const out = await sui.finalize(r, [signer.sign(p!)], ctxFor(m.fetch));
    // The serialized signature (0x00 || sig || pubkey) is byte-identical to the SDK's offline output.
    expect(out).toEqual({ bytes: FIX.transfer, signature: FIX.transferSig });
  });

  it("signs and executes through GraphQL", async () => {
    const m = mockGql({
      clipExecute: (v) => {
        expect(v).toEqual({ bytes: FIX.transfer, signatures: [FIX.transferSig] });
        return { executeTransaction: { effects: { status: "SUCCESS", effectsBcs: "AQID", executionError: null, transaction: { digest: "DiGeSt111" } } } };
      },
    });
    const r = ws("sui:signAndExecuteTransaction", FIX.transfer);
    const [p] = await sui.prepare(r, ctxFor(m.fetch), "a");
    expect(await sui.finalize(r, [signer.sign(p!)], ctxFor(m.fetch))).toEqual({ bytes: FIX.transfer, signature: FIX.transferSig, digest: "DiGeSt111", effects: "AQID" });

    const wc = req("sui_signAndExecuteTransaction", { transaction: FIX.transfer, address: ME });
    const [p2] = await sui.prepare(wc, ctxFor(m.fetch), "b");
    expect(await sui.finalize(wc, [signer.sign(p2!)], ctxFor(m.fetch))).toEqual({ digest: "DiGeSt111" });
  });

  it("turns execution failures into plain errors", async () => {
    const m = mockGql({
      clipExecute: () => {
        throw new Error("Transaction validator signing failed due to issues with transaction inputs: InsufficientGas");
      },
    });
    const r = ws("sui:signAndExecuteTransaction", FIX.transfer);
    const [p] = await sui.prepare(r, ctxFor(m.fetch), "a");
    await expect(sui.finalize(r, [signer.sign(p!)], ctxFor(m.fetch))).rejects.toMatchObject({
      code: "sui/send-failed",
      userMessage: "You don't have enough SUI to pay the network fee.",
    });
  });

  it("says an empty account can't pay the fee instead of \"couldn't run\" (dapp matrix regression)", () => {
    // Real testnet answer while building a transaction for an address with no SUI (2026-10).
    const raw = "Invalid argument: Unable to perform gas selection due to insufficient SUI balance (in address balance or coins) for account 0x6103 to satisfy required budget 2988000.";
    expect(plainSuiError(raw)).toBe("You don't have enough SUI to pay the network fee.");
  });

  it("signs personal messages over the PersonalMessage intent", async () => {
    const m = mockGql({});
    const r = req("sui:signPersonalMessage", { inputs: [{ account: ME, message: btoa("Hello Sui") }] });
    const [p] = await sui.prepare(r, ctxFor(m.fetch), "a");
    const msg = new TextEncoder().encode("Hello Sui");
    expect(p!.bytes).toEqual(blake2b(messageWithIntent("PersonalMessage", bcs.byteVector().serialize(msg).toBytes()), { dkLen: 32 }));
    expect(await sui.finalize(r, [signer.sign(p!)], ctxFor(m.fetch))).toEqual({ bytes: btoa("Hello Sui"), signature: FIX.messageSig });
    const wc = req("sui_signPersonalMessage", { message: "Hello Sui", address: ME });
    const [pw] = await sui.prepare(wc, ctxFor(m.fetch), "a");
    expect(await sui.finalize(wc, [signer.sign(pw!)], ctxFor(m.fetch))).toEqual({ signature: FIX.messageSig });
  });

  it("rejects a signature that doesn't verify", async () => {
    const m = mockGql({});
    const r = ws("sui:signTransaction", FIX.transfer);
    const wrong = { scheme: "ed25519" as const, bytes: b64decode(FIX.swapSig).slice(1, 65), publicKey: FIX.publicKey };
    await expect(sui.finalize(r, [wrong], ctxFor(m.fetch))).rejects.toMatchObject({ code: "sui/bad-signature" });
    expect(serializeSignature(new Uint8Array(64), fromHex(FIX.publicKey))).toHaveLength(Math.ceil(97 / 3) * 4);
  });
});

describe("balances, collectibles and stakes", () => {
  it("lists SUI first and every coin type with its metadata", async () => {
    const m = mockGql({
      ...meta(),
      clipBalances: (v) => {
        expect(v.owner).toBe(ME);
        return {
          address: {
            balances: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                { coinType: { repr: USDC }, totalBalance: "2500000" },
                { coinType: { repr: SUI }, totalBalance: "3000000000" },
                { coinType: { repr: "0x9::meme::MEME" }, totalBalance: "0" },
              ],
            },
          },
        };
      },
    });
    const b = await sui.getBalances(ctxFor(m.fetch));
    expect(b).toEqual([
      { asset: { key: "sui", symbol: "SUI", name: "Sui", decimals: 9, networkId: "sui:testnet" }, amount: "3000000000" },
      { asset: { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: "sui:testnet", address: USDC }, amount: "2500000" },
    ]);
  });

  it("returns objects with Display metadata as collectibles", async () => {
    const page = {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        { address: "0xc01", version: 1, contents: { type: { repr: `0x2::coin::Coin<${SUI}>` }, json: {}, display: null } },
        {
          address: "0xa11",
          version: 3,
          contents: {
            type: { repr: "0xbeef::frogs::Frog" },
            json: {},
            display: { output: { name: "Frog #7", image_url: "https://img.example/7.png", collection_name: "Frogs" }, errors: null },
          },
        },
        { address: "0xa12", version: 3, contents: { type: { repr: "0xbeef::frogs::Frog" }, json: {}, display: { output: { name: "Frog #8", image_url: "javascript:alert(1)" } } } },
        { address: "0xcap", version: 1, contents: { type: { repr: "0xbeef::admin::AdminCap" }, json: {}, display: null } },
      ],
    };
    const m = mockGql({ clipObjects: () => ({ address: { objects: page } }) });
    const nfts = await sui.getNfts(ctxFor(m.fetch));
    expect(nfts).toEqual([
      { networkId: "sui:testnet", standard: "sui-object", collection: { address: "0xbeef::frogs::Frog", name: "Frogs" }, tokenId: "0xa11", name: "Frog #7", mediaUrl: "https://img.example/7.png" },
      { networkId: "sui:testnet", standard: "sui-object", collection: { address: "0xbeef::frogs::Frog", name: "frogs::Frog" }, tokenId: "0xa12", name: "Frog #8" },
    ]);
  });

  it("reads staking positions", async () => {
    const m = mockGql({
      clipObjects: (v) => {
        expect(v.type).toBe("0x3::staking_pool::StakedSui");
        return {
          address: {
            objects: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ address: "0x57a", version: 9, contents: { type: { repr: "0x3::staking_pool::StakedSui" }, json: { pool_id: "0x900", stake_activation_epoch: "1200", principal: { value: "2000000000" } } } }],
            },
          },
        };
      },
    });
    expect(await sui.getStakes(ctxFor(m.fetch))).toEqual([{ stakeId: "0x57a", poolId: "0x900", principal: "2000000000", activationEpoch: "1200" }]);
  });
});

describe("buildTransfer and unresolved transactions", () => {
  /** The SDK resolves through GraphQL: getBalance for coinWithBalance, then a gas-selecting simulation. */
  function resolver(resolved: string) {
    return mockGql({
      ...meta(),
      getBalance: (v) => ({ address: { balance: { coinType: { repr: v.coinType }, totalBalance: "9000000000", addressBalance: "9000000000" } } }),
      resolveTransaction: () => ({
        simulateTransaction: { effects: { transaction: { effects: { status: "SUCCESS", epoch: { epochId: 1241 } }, transactionBcs: resolved } } },
      }),
    });
  }

  it("builds a SUI send as a signAndExecute request the approval path can decode", async () => {
    const m = resolver(FIX.transfer);
    const r = await sui.buildTransfer({ asset: SUI_TESTNET.nativeAsset, to: BOB, amount: "1500000000" }, ctxFor(m.fetch));
    expect(r).toMatchObject({ origin: "clip-wallet", family: "sui", networkId: "sui:testnet", method: "sui:signAndExecuteTransaction" });
    const input = (r.params as { inputs: { account: string; transaction: string; chain: string }[] }).inputs[0]!;
    expect(input.account).toBe(ME);
    expect(input.chain).toBe("sui:testnet");
    const data = TransactionDataBuilder.fromBytes(b64decode(input.transaction)).snapshot();
    expect(data.sender).toBe(ME);
    expect(m.calls.map((c) => c.op)).toEqual(expect.arrayContaining(["getBalance", "resolveTransaction"]));
  });

  it("refuses bad recipients and amounts", async () => {
    const m = resolver(FIX.transfer);
    const ctx = ctxFor(m.fetch);
    await expect(sui.buildTransfer({ asset: SUI_TESTNET.nativeAsset, to: "0x123", amount: "1" }, ctx)).rejects.toMatchObject({ code: "sui/bad-address" });
    await expect(sui.buildTransfer({ asset: SUI_TESTNET.nativeAsset, to: ME, amount: "1" }, ctx)).rejects.toMatchObject({ code: "sui/self-transfer" });
    await expect(sui.buildTransfer({ asset: SUI_TESTNET.nativeAsset, to: BOB, amount: "0" }, ctx)).rejects.toMatchObject({ code: "sui/bad-amount" });
  });

  it("explains a shortfall in plain words", async () => {
    const m = mockGql({
      getBalance: (v) => ({ address: { balance: { coinType: { repr: v.coinType }, totalBalance: "0", addressBalance: "0" } } }),
      getCoins: () => ({ address: { address: ME, objects: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }),
    });
    const usdc = { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: "sui:testnet", address: USDC };
    await expect(sui.buildTransfer({ asset: usdc, to: BOB, amount: "1000" }, ctxFor(m.fetch))).rejects.toMatchObject({
      code: "sui/insufficient",
      userMessage: "You don't have enough USDC.",
    });
  });

  it("names the amount of SUI sent back to yourself (dapp matrix regression)", async () => {
    const tx = new Transaction();
    tx.setSender(ME);
    tx.setGasPrice(1000);
    tx.setGasBudget(3_000_000);
    tx.setGasPayment([{ objectId: `0x${"ab".repeat(32)}`, version: "1", digest: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi" }]);
    const [c] = tx.splitCoins(tx.gas, [1]);
    tx.transferObjects([c!], ME);
    const bytes = b64encode(await tx.build());
    const m = mockGql({ ...meta(), clipSimulate: () => simResult([[ME, SUI, (-FEE).toString()]]) });
    const d = await sui.decode(ws("sui:signAndExecuteTransaction", bytes), ctxFor(m.fetch));
    expect(d.title).toBe(`Send 0.000000001 SUI to ${ME.slice(0, 6)}…${ME.slice(-4)}`);
    expect(d.lines).toContainEqual({ label: "Sends to", value: "Your own account" });
  });

  it("resolves Wallet Standard transaction JSON once and signs the same bytes it showed", async () => {
    const m = resolver(FIX.transfer);
    const tx = new Transaction();
    tx.setSender(ME);
    const [c] = tx.splitCoins(tx.gas, [1_500_000_000]);
    tx.transferObjects([c], BOB);
    const r = ws("sui:signTransaction", await tx.toJSON());
    const d = await createSuiModule({ simulate: false }).decode(r, ctxFor(m.fetch));
    expect(d.title).toMatch(/^Send/);
    const mod = createSuiModule({ simulate: false });
    const [p1] = await mod.prepare(r, ctxFor(m.fetch), "a");
    const resolveCalls = m.calls.filter((x) => x.op === "resolveTransaction").length;
    const [p2] = await mod.prepare(r, ctxFor(m.fetch), "a");
    expect(p2!.bytes).toEqual(p1!.bytes); // cached per request id: no second resolution
    expect(m.calls.filter((x) => x.op === "resolveTransaction").length).toBe(resolveCalls);
    const out = (await mod.finalize(r, [signer.sign(p1!)], ctxFor(m.fetch))) as { bytes: string; signature: string };
    expect(out.signature).toBe(FIX.transferSig);
    expect(ACCOUNT.address).toBe(ME);
  });
});
