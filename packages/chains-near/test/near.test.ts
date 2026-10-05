import { ClipError, type DappRequest, attachMsgs } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { beforeEach, describe, expect, it } from "vitest";
import {
  NEAR_MAINNET,
  NEAR_METHODS,
  NEAR_NETWORKS,
  NEAR_TESTNET,
  USDC_CONTRACTS,
  addressFromPublicKey,
  clearTokenCache,
  createNearModule,
  decodeSignedTransaction,
  decodeTransaction,
  encodeSignedTransaction,
  encodeTransaction,
  isAccountId,
  isAddress,
  isLookalike,
  nearAsset,
  nep413Hash,
  nep413Payload,
  parseAction,
  parsePublicKey,
  plainNearError,
  resolveMedia,
  spendable,
  tokenAssetKey,
  type Action,
  type Transaction,
} from "../src/index.js";
import { b64decode, b64encode, fromHex, hex } from "../src/util.js";
import { RpcFail, ctxFor, enc, fixtureSigner, fullAccess, makeAccount, mockNear, outcome, viewAccount } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const PK = parsePublicKey(FIX.publicKey);
const USDC = USDC_CONTRACTS.testnet;
const POOL = "kiln.pool.f863973.m0";
const APP_KEY = "ed25519:DmnRVNb89cLKZY1cH1Zcr3rxMVD9r1cVfnDac7RFwM94";
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;
const account = makeAccount(ME);
const near = createNearModule();
const signer = fixtureSigner(
  ME,
  Object.values(FIX as Record<string, unknown>)
    .filter((v): v is { sig: string } => typeof v === "object" && v !== null && "sig" in v)
    .map((v) => v.sig),
);

function req(method: string, params: unknown, origin = "https://app.example", via: DappRequest["via"] = "injected"): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin, via, family: "near", networkId: NEAR_TESTNET.id, method, params };
}

/** Default chain: I have 100 NEAR and a full-access key; bob and alice exist; testnet USDC answers ft_metadata. */
function chain(extra: Record<string, unknown> = {}, urls: [RegExp, unknown][] = []) {
  const sent: string[] = [];
  const m = mockNear(
    {
      block: { header: { hash: FIX.blockHash, height: 271356934 } },
      gas_price: { gas_price: "100000000" },
      [`view_access_key:${ME}`]: fullAccess(FIX.accessKeyNonce),
      [`view_account:${ME}`]: viewAccount((100n * NEAR).toString()),
      "view_account:bob.testnet": viewAccount("1"),
      "view_account:alice.testnet": viewAccount("1"),
      [`call:${USDC}:ft_metadata`]: { spec: "ft-1.0.0", name: "USDC", symbol: "USDC", decimals: 6 },
      send_tx: (p: Record<string, unknown>) => {
        sent.push(p.signed_tx_base64 as string);
        expect(p.wait_until).toBe("EXECUTED_OPTIMISTIC");
        return outcome(`h${sent.length}`, ME, "bob.testnet");
      },
      ...extra,
    },
    urls,
  );
  return { ...m, sent, ctx: ctxFor(account, m.fetch) };
}

async function roundTrip(request: DappRequest, ctx = chain().ctx) {
  const payloads = await near.prepare(request, ctx, "approval-1");
  const sigs = payloads.map((p) => signer.sign(p));
  return { payloads, result: await near.finalize(request, sigs, ctx) };
}

async function rejects(p: Promise<unknown>, code: string) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ClipError);
  expect((e as ClipError).code).toBe(code);
  return e as ClipError;
}

beforeEach(() => clearTokenCache());

describe("networks and addresses", () => {
  it("uses WalletConnect's near:<network> chain ids, testnet first", () => {
    expect(NEAR_NETWORKS.map((n) => n.id)).toEqual(["near:testnet", "near:mainnet"]);
    expect(NEAR_TESTNET.testnet).toBe(true);
    expect(NEAR_MAINNET.testnet).toBe(false);
    expect(NEAR_TESTNET.nativeAsset).toEqual({ key: "near", symbol: "NEAR", name: "NEAR", decimals: 24, networkId: "near:testnet" });
    expect(tokenAssetKey("near:mainnet", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1")).toBe("usdc");
    expect(tokenAssetKey("near:testnet", USDC)).toBe("usdc");
    expect(tokenAssetKey("near:testnet", "usdc.fakes.testnet")).toBe("nep141:usdc.fakes.testnet");
  });

  it("derives the implicit account id and path", () => {
    expect(near.derivationPath(0)).toBe("m/44'/397'/0'");
    expect(near.derivationPath(3)).toBe("m/44'/397'/3'");
    expect(near.addressFromPublicKey(PK.data, NEAR_TESTNET)).toBe(ME);
    expect(addressFromPublicKey(PK.data)).toBe(ME);
    expect(() => near.addressFromPublicKey(new Uint8Array(31), NEAR_TESTNET)).toThrow();
  });

  it("validates named, implicit and ETH-implicit accounts", () => {
    for (const ok of ["alice.near", "bob.testnet", "a1", "app_1-x.sub.near", ME, "0x" + "ab".repeat(20), "kiln.pool.f863973.m0"]) expect(isAddress(ok)).toBe(true);
    for (const bad of ["a", "Alice.near", "-a.near", "a..near", "a.near.", "a b", "x".repeat(65), "0xABCDEF", "alice@near", ""]) expect(isAddress(bad)).toBe(false);
    expect(isAccountId("ab")).toBe(true);
  });

  it("maps .near to mainnet, .testnet to testnet, implicit to both", () => {
    expect(near.networksForAddress("alice.near", NEAR_NETWORKS).map((n) => n.id)).toEqual(["near:mainnet"]);
    expect(near.networksForAddress("bob.testnet", NEAR_NETWORKS).map((n) => n.id)).toEqual(["near:testnet"]);
    expect(near.networksForAddress(ME, NEAR_NETWORKS)).toHaveLength(2);
    expect(near.networksForAddress("nope!", NEAR_NETWORKS)).toEqual([]);
  });
});

describe("borsh", () => {
  it("matches near-api-js' signed transfer vector (test/unit/signers/key_pair_signer.test.ts)", () => {
    const tx: Transaction = {
      signerId: "test.near",
      publicKey: parsePublicKey("ed25519:Anu7LYDfpLtkP7E16LT9imXF694BdQaa9ufVkQiwTQxC"),
      nonce: 1n,
      receiverId: "whatever.near",
      blockHash: Uint8Array.from([15, 164, 115, 253, 38, 144, 29, 242, 150, 190, 106, 220, 76, 196, 223, 52, 208, 64, 239, 162, 67, 82, 36, 182, 152, 105, 16, 230, 48, 194, 254, 246]),
      actions: [{ kind: "Transfer", deposit: 1n }],
    };
    const sig = b64decode("lpqDMyGG7pdV5IOTJVJYBuGJo9LSu0tHYOlEQ+l+HE8i3u7wBZqOlxMQDtpuGRRNp+ig735TmyBwi6HY0CG9AQ==");
    const bytes = encodeTransaction(tx);
    expect(ed25519.verify(sig, sha256(bytes), tx.publicKey.data)).toBe(true);
    expect(hex(encodeSignedTransaction(bytes, sig))).toBe(
      "09000000746573742e6e65617200917b3d268d4b58f7fec1b150bd68d69be3ee5d4cc39855e341538465bb77860d01000000000000000d00000077686174657665722e6e6561720fa473fd26901df296be6adc4cc4df34d040efa2435224b6986910e630c2fef601000000030100000000000000000000000000000000969a83332186ee9755e4839325525806e189a3d2d2bb4b4760e94443e97e1c4f22deeef0059a8e9713100eda6e19144da7e8a0ef7e539b20708ba1d8d021bd01",
    );
    const back = decodeSignedTransaction(encodeSignedTransaction(bytes, sig));
    expect(back.tx).toEqual(tx);
    expect(back.signature).toEqual(sig);
  });

  it("matches @near-js/transactions for every fixture and round-trips", () => {
    for (const k of ["nativeTransfer", "ftTransfer", "stake", "signIn", "signOut", "wcTx"] as const) {
      const bytes = b64decode(FIX[k].txBase64);
      const tx = decodeTransaction(bytes);
      expect(encodeTransaction(tx)).toEqual(bytes);
      expect(hex(sha256(bytes))).toBe(FIX[k].hash);
      expect(b64encode(encodeSignedTransaction(bytes, fromHex(FIX[k].sig)))).toBe(FIX[k].signedBase64);
    }
  });

  it("round-trips every action kind and stops at unknown ones", () => {
    const pk = parsePublicKey(APP_KEY);
    const actions: Action[] = [
      { kind: "CreateAccount" },
      { kind: "DeployContract", code: Uint8Array.of(0, 97, 115, 109) },
      { kind: "FunctionCall", methodName: "m", args: enc({ a: 1 }), gas: 5n, deposit: 2n ** 100n },
      { kind: "Transfer", deposit: 7n },
      { kind: "Stake", stake: 9n, publicKey: pk },
      { kind: "AddKey", publicKey: pk, accessKey: { nonce: 0n, permission: "FullAccess" } },
      { kind: "AddKey", publicKey: pk, accessKey: { nonce: 0n, permission: { allowance: null, receiverId: "x.near", methodNames: ["a", "b"] } } },
      { kind: "DeleteKey", publicKey: { keyType: 1, data: new Uint8Array(64).fill(3) } },
      { kind: "DeleteAccount", beneficiaryId: "bob.near" },
      {
        kind: "Delegate",
        delegateAction: { senderId: "a.near", receiverId: "b.near", actions: [{ kind: "Transfer", deposit: 1n }], nonce: 3n, maxBlockHeight: 99n, publicKey: pk },
        signature: { keyType: 0, data: new Uint8Array(64).fill(1) },
      },
      { kind: "DeployGlobalContract", code: Uint8Array.of(1, 2), deployMode: "AccountId" },
      { kind: "UseGlobalContract", contractIdentifier: { accountId: "lib.near" } },
      { kind: "UseGlobalContract", contractIdentifier: { codeHash: new Uint8Array(32).fill(5) } },
    ];
    const tx: Transaction = { signerId: "a.near", publicKey: PK, nonce: 2n ** 60n, receiverId: "b.near", blockHash: new Uint8Array(32), actions };
    const bytes = encodeTransaction(tx);
    expect(decodeTransaction(bytes)).toEqual(tx);
    const unknown = encodeTransaction({ ...tx, actions: [{ kind: "Transfer", deposit: 1n }] });
    unknown[unknown.length - 17] = 13; // Transfer → tag 13 (a newer protocol action)
    unknown.set(Uint8Array.of(2, 0, 0, 0), unknown.length - 21); // two actions
    expect(decodeTransaction(unknown).actions).toEqual([{ kind: "Unknown", tag: 13 }]);
    expect(() => decodeTransaction(bytes.slice(0, 40))).toThrow();
  });
});

describe("NEP-413", () => {
  const nonce = b64decode("KNV0cOpvJ50D5vfF9pqWom8wo2sliQ4W+Wa7uZ3Uk6Y=");

  it("hashes like near-api-js' known vector", () => {
    const h = nep413Hash({ message: "Hello NEAR!", recipient: "round-toad.testnet", nonce });
    expect([...h]).toEqual([1, 152, 236, 223, 103, 218, 230, 0, 34, 54, 210, 18, 244, 68, 108, 252, 140, 166, 102, 57, 242, 4, 202, 234, 205, 94, 246, 245, 198, 141, 23, 250]);
  });

  it("verifies near-api-js' published signatures (with and without callbackUrl)", () => {
    // Public key of the near-api-js test key 3FyRt… (its last 32 bytes).
    const pub = parsePublicKey("ed25519:2RM3EotCzEiVobm6aMjaup43k8cFffR4KHFtrqbZ79Qy").data;
    const withCb = nep413Hash({ message: "Hello NEAR!", recipient: "example.near", nonce, callbackUrl: "http://localhost:3000" });
    const without = nep413Hash({ message: "Hello NEAR!", recipient: "example.near", nonce });
    expect(ed25519.verify(b64decode("zzZQ/GwAjrZVrTIFlvmmQbDQHllfzrr8urVWHaRt5cPfcXaCSZo35c5LDpPpTKivR6BxLyb3lcPM0FfCW5lcBQ=="), withCb, pub)).toBe(true);
    expect(ed25519.verify(b64decode("NnJgPU1Ql7ccRTITIoOVsIfElmvH1RV7QAT4a9Vh6ShCOnjIzRwxqX54JzoQ/nK02p7VBMI2vJn48rpImIJwAw=="), without, pub)).toBe(true);
  });

  it("builds the NEP's own example payload and our fixtures", () => {
    const n = Uint8Array.from({ length: 32 }, (_, i) => i);
    const p = { message: "hi", recipient: "myapp.com", nonce: n, callbackUrl: "myapp.com/callback" };
    expect(hex(nep413Payload(p))).toBe(FIX.nep413cb.payloadHex);
    expect(hex(nep413Payload(p)).slice(0, 8)).toBe("9d010080"); // u32 LE 2^31 + 413
    expect(hex(nep413Hash(p))).toBe(FIX.nep413cb.hash);
    expect(hex(nep413Hash({ message: "Sign in to app.example", recipient: "app.example", nonce: n }))).toBe(FIX.nep413.hash);
    expect(() => nep413Payload({ ...p, nonce: new Uint8Array(28) })).toThrow();
  });
});

describe("action JSON", () => {
  it("reads wallet-selector and near-api-js shapes the same", () => {
    const keyData = { "0": 189, ...Object.fromEntries([...parsePublicKey(APP_KEY).data].map((b, i) => [String(i), b])) };
    const pairs: [unknown, unknown][] = [
      [{ type: "Transfer", params: { deposit: "5" } }, { enum: "transfer", transfer: { deposit: "5n" } }],
      [
        { type: "FunctionCall", params: { methodName: "m", args: { a: 1 }, gas: "30", deposit: "1" } },
        { enum: "functionCall", functionCall: { methodName: "m", args: { type: "Buffer", data: [...enc({ a: 1 })] }, gas: 30, deposit: "1" } },
      ],
      [
        { type: "FunctionCall", params: { methodName: "m", argsBase64: b64encode(enc({ a: 1 })), gas: "30", deposit: "1" } },
        { functionCall: { methodName: "m", args: b64encode(enc({ a: 1 })), gas: "30", deposit: "1" } },
      ],
      [
        { type: "AddKey", params: { publicKey: APP_KEY, accessKey: { permission: "FullAccess" } } },
        { addKey: { publicKey: { ed25519Key: { keyType: 0, data: keyData }, enum: "ed25519Key" }, accessKey: { nonce: "0n", permission: { fullAccess: {}, enum: "fullAccess" } } } },
      ],
      [
        { type: "AddKey", params: { publicKey: APP_KEY, accessKey: { permission: { receiverId: "r.near", allowance: "10", methodNames: ["x"] } } } },
        { addKey: { publicKey: APP_KEY, accessKey: { nonce: 0, permission: { functionCall: { allowance: "10n", receiverId: "r.near", methodNames: ["x"] }, enum: "functionCall" } } } },
      ],
      [{ type: "DeleteKey", params: { publicKey: APP_KEY } }, { deleteKey: { publicKey: APP_KEY } }],
      [{ type: "DeleteAccount", params: { beneficiaryId: "b.near" } }, { deleteAccount: { beneficiaryId: "b.near" } }],
      [{ type: "CreateAccount" }, { createAccount: {}, enum: "createAccount" }],
      [{ type: "DeployContract", params: { codeBase64: "AGFzbQ==" } }, { deployContract: { code: { "0": 0, "1": 97, "2": 115, "3": 109 } } }],
      [{ type: "Stake", params: { stake: "9", publicKey: APP_KEY } }, { stake: { stake: "9", publicKey: APP_KEY } }],
    ];
    for (const [a, b] of pairs) expect(parseAction(a)).toEqual(parseAction(b));
    expect(parseAction({ useGlobalContract: { contractIdentifier: { AccountId: "lib.near" }, enum: "AccountId" } })).toEqual({
      kind: "UseGlobalContract",
      contractIdentifier: { accountId: "lib.near" },
    });
    expect(parseAction({ signedDelegate: { delegateAction: {} } })).toEqual({ kind: "Unknown", tag: 8 });
    expect(parseAction({ type: "Teleport", params: {} })).toEqual({ kind: "Unknown", tag: -1 });
    expect(() => parseAction({ type: "Transfer", params: { deposit: "-1" } })).toThrow();
    expect(() => parseAction("transfer")).toThrow();
  });
});

describe("decode", () => {
  const send = (actions: unknown[], receiverId = "bob.testnet", extra: Record<string, unknown> = {}) =>
    req(NEAR_METHODS.signAndSendTransaction, { receiverId, actions, ...extra });

  it("describes a NEAR transfer with fee and balance change", async () => {
    const { ctx } = chain();
    const d = await near.decode(send([{ type: "Transfer", params: { deposit: (15n * NEAR / 10n).toString() } }]), ctx);
    expect(d.title).toBe("Send 1.5 NEAR to bob.testnet");
    // Built as a string through the action list; the background attaches the Msg by that exact text.
    expect(attachMsgs(d).titleMsg).toEqual({ id: "bg.req.sendTo", values: { amount: "1.5 NEAR", to: "bob.testnet" }, fallback: d.title });
    expect(d.balanceChanges).toEqual([{ asset: nearAsset("near:testnet"), delta: (-15n * NEAR / 10n).toString() }]);
    expect(d.fee).toEqual({ asset: nearAsset("near:testnet"), amount: (700_000_000_000n * 100_000_000n).toString() });
    expect(d.lines.find((l) => l.label === "Network fee")?.value).toBe("about 0.00007 NEAR");
    expect(d.blind).toBe(false);
    expect(d.warnings).toEqual([]);
  });

  it("warns about a named recipient that doesn't exist", async () => {
    const { ctx } = chain();
    const d = await near.decode(send([{ type: "Transfer", params: { deposit: "1" } }], "ghost.testnet"), ctx);
    expect(d.warnings.map((w) => w.code)).toEqual(["new-recipient"]);
  });

  it("describes an FT transfer with storage registration", async () => {
    const { ctx } = chain();
    const actions = [
      { type: "FunctionCall", params: { methodName: "storage_deposit", args: { account_id: "bob.testnet", registration_only: true }, gas: "30000000000000", deposit: "1250000000000000000000" } },
      { type: "FunctionCall", params: { methodName: "ft_transfer", args: { receiver_id: "bob.testnet", amount: "2500000" }, gas: "30000000000000", deposit: "1" } },
    ];
    const d = await near.decode(send(actions, USDC), ctx);
    expect(d.title).toBe("Send 2.5 USDC to bob.testnet");
    expect(d.lines[0]).toEqual({ label: "Also", value: `Register bob.testnet with ${USDC.slice(0, 6)}…${USDC.slice(-4)}` });
    const usdc = d.balanceChanges.find((c) => c.asset.key === "usdc");
    expect(usdc?.delta).toBe("-2500000");
    expect(d.balanceChanges.find((c) => c.asset.key === "near")?.delta).toBe("-1250000000000000000001");
    expect(d.lines.find((l) => l.label === "Network fee")?.value).toMatch(/^up to 0\.00\d+ NEAR \(unused gas is refunded\)$/);
  });

  it("flags a USDC look-alike token", async () => {
    const { ctx } = chain({ "call:usdc.fakes.testnet:ft_metadata": { name: "Bridged USDC", symbol: "USDC.e", decimals: 6 } });
    const d = await near.decode(
      send([{ type: "FunctionCall", params: { methodName: "ft_transfer", args: { receiver_id: "bob.testnet", amount: "1000000" }, gas: "30000000000000", deposit: "1" } }], "usdc.fakes.testnet"),
      ctx,
    );
    expect(d.title).toBe("Send 1 USDC.e to bob.testnet");
    expect(d.warnings.map((w) => [w.level, w.code])).toEqual([["danger", "known-scam"]]);
    expect(d.balanceChanges[1]?.asset.spam).toBe(true);
  });

  it("describes staking-pool calls", async () => {
    const { ctx } = chain();
    const call = (methodName: string, args: unknown, deposit = "0") => send([{ type: "FunctionCall", params: { methodName, args, gas: "125000000000000", deposit } }], POOL);
    const stake = await near.decode(call("deposit_and_stake", {}, (50n * NEAR).toString()), ctx);
    expect(stake.title).toBe("Stake 50 NEAR with kiln");
    expect(stake.lines.some((l) => l.value.includes("4 epochs"))).toBe(true);
    expect(stake.balanceChanges[0]?.delta).toBe((-50n * NEAR).toString());
    expect((await near.decode(call("unstake", { amount: (20n * NEAR).toString() }), ctx)).title).toBe("Unstake 20 NEAR from kiln");
    expect((await near.decode(call("unstake_all", {}), ctx)).title).toBe("Unstake everything from kiln");
    expect((await near.decode(call("withdraw_all", {}), ctx)).title).toBe("Withdraw your unstaked NEAR from kiln");
    expect((await near.decode(call("withdraw", { amount: NEAR.toString() }), ctx)).title).toBe("Withdraw 1 NEAR of unstaked NEAR from kiln");
  });

  it("describes wNEAR, NFT and generic calls", async () => {
    const { ctx } = chain();
    const fc = (methodName: string, args: unknown, deposit = "0") => ({ type: "FunctionCall", params: { methodName, args, gas: "30000000000000", deposit } });
    const wrap = await near.decode(send([fc("near_deposit", {}, NEAR.toString())], "wrap.testnet"), ctx);
    expect(wrap.title).toBe("Wrap 1 NEAR into wNEAR");
    expect(wrap.balanceChanges.map((c) => [c.asset.symbol, c.delta])).toEqual([
      ["NEAR", (-NEAR).toString()],
      ["wNEAR", NEAR.toString()],
    ]);
    expect((await near.decode(send([fc("near_withdraw", { amount: NEAR.toString() }, "1")], "wrap.testnet"), ctx)).title).toBe("Unwrap 1 wNEAR into NEAR");
    expect((await near.decode(send([fc("nft_transfer", { receiver_id: "bob.testnet", token_id: "7" }, "1")], "nft.examples.testnet"), ctx)).title).toBe("Send NFT 7 to bob.testnet");
    const generic = await near.decode(send([fc("add_message", { text: "hi" })], "guest-book.testnet"), ctx);
    expect(generic.title).toBe("Call add_message on guest-book.testnet");
    expect(generic.lines.find((l) => l.label === "Arguments")?.value).toContain('"text": "hi"');
    expect(generic.blind).toBe(false);
    const binary = await near.decode(send([{ type: "FunctionCall", params: { methodName: "x", argsBase64: "AP8=", gas: "1", deposit: "0" } }], "guest-book.testnet"), ctx);
    expect(binary.blind).toBe(true);
    expect(binary.warnings[0]?.code).toBe("blind-signing");
  });

  it("puts danger warnings on key, code and account changes", async () => {
    const { ctx } = chain();
    const mine = (actions: unknown[]) => send(actions, ME);
    const full = await near.decode(mine([{ type: "AddKey", params: { publicKey: APP_KEY, accessKey: { permission: "FullAccess" } } }]), ctx);
    expect(full.title).toBe(`Give app.example full control of ${ME.slice(0, 6)}…${ME.slice(-4)}`);
    expect(full.warnings.map((w) => [w.level, w.code])).toEqual([["danger", "account-takeover"]]);

    const limited = await near.decode(mine([{ type: "AddKey", params: { publicKey: APP_KEY, accessKey: { permission: { receiverId: "guest-book.testnet", allowance: "250000000000000000000000" } } } }]), ctx);
    expect(limited.title).toBe("Let app.example use guest-book.testnet for you");
    expect(limited.lines.find((l) => l.label === "Fee allowance")?.value).toBe("0.25 NEAR");
    expect(limited.warnings).toEqual([]);
    const unlimited = await near.decode(mine([{ type: "AddKey", params: { publicKey: APP_KEY, accessKey: { permission: { receiverId: "guest-book.testnet" } } } }]), ctx);
    expect(unlimited.warnings.map((w) => [w.level, w.code])).toEqual([["caution", "unlimited-approval"]]);

    const delMine = await near.decode(mine([{ type: "DeleteKey", params: { publicKey: FIX.publicKey } }]), ctx);
    expect(delMine.warnings.map((w) => [w.level, w.code])).toEqual([["danger", "account-takeover"]]);
    const delOther = await near.decode(mine([{ type: "DeleteKey", params: { publicKey: APP_KEY } }]), ctx);
    expect(delOther.warnings).toEqual([]);

    const del = await near.decode(mine([{ type: "DeleteAccount", params: { beneficiaryId: "bob.testnet" } }]), ctx);
    expect(del.warnings.map((w) => [w.level, w.code])).toEqual([["danger", "account-closure"]]);
    expect(del.warnings[0]?.message).toContain("sends everything left to bob.testnet");

    const deploy = await near.decode(mine([{ type: "DeployContract", params: { codeBase64: "AGFzbQ==" } }]), ctx);
    expect(deploy.title).toBe(`Replace the code on ${ME.slice(0, 6)}…${ME.slice(-4)}`);
    expect(deploy.warnings.map((w) => [w.level, w.code])).toEqual([["danger", "account-takeover"]]);
  });

  it("decodes unknown actions as blind instead of failing", async () => {
    const { ctx } = chain();
    const d = await near.decode(send([{ signedDelegate: { delegateAction: {} } }]), ctx);
    expect(d.blind).toBe(true);
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "blind-signing" });
    await rejects(near.prepare(send([{ signedDelegate: {} }]), ctx, "a"), "near/unsupported-action");
  });

  it("refuses accounts this key doesn't control", async () => {
    const { ctx } = chain({ "view_access_key:nobody.testnet": () => { throw new RpcFail("UNKNOWN_ACCOUNT", "account nobody.testnet does not exist while viewing"); } });
    const e = await rejects(near.decode(send([{ type: "Transfer", params: { deposit: "1" } }], "bob.testnet", { signerId: "alice.testnet" }), ctx), "near/not-your-account");
    expect(e.userMessage).toBe("This NEAR account isn't controlled by this wallet's key.");
    await rejects(near.decode(send([{ type: "Transfer", params: { deposit: "1" } }], "bob.testnet", { signerId: "nobody.testnet" }), ctx), "near/account-not-found");
    const fresh = chain({ [`view_access_key:${ME}`]: () => { throw new RpcFail("UNKNOWN_ACCOUNT", "does not exist"); } });
    const e2 = await rejects(near.decode(send([{ type: "Transfer", params: { deposit: "1" } }]), fresh.ctx), "near/account-not-found");
    expect(e2.userMessage).toMatch(/Receive some NEAR first/);
  });

  it("enforces function-call key limits", async () => {
    const fc = { nonce: 5, permission: { FunctionCall: { allowance: null, method_names: ["add_message"], receiver_id: "guest-book.testnet" } } };
    const { ctx } = chain({ "view_access_key:alice.testnet": fc });
    const call = (receiverId: string, methodName: string, deposit = "0") =>
      req(NEAR_METHODS.signAndSendTransaction, { signerId: "alice.testnet", receiverId, actions: [{ type: "FunctionCall", params: { methodName, args: {}, gas: "1", deposit } }] });
    const ok = await near.decode(call("guest-book.testnet", "add_message"), ctx);
    expect(ok.lines[0]).toEqual({ label: "From account", value: "alice.testnet" });
    await rejects(near.decode(call("other.testnet", "add_message"), ctx), "near/limited-key");
    await rejects(near.decode(call("guest-book.testnet", "other"), ctx), "near/limited-key");
    await rejects(near.decode(call("guest-book.testnet", "add_message", "1"), ctx), "near/limited-key");
    await rejects(near.decode(req(NEAR_METHODS.signAndSendTransaction, { signerId: "alice.testnet", receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: "1" } }] }), ctx), "near/limited-key");
  });

  it("rejects malformed requests plainly", async () => {
    const { ctx } = chain();
    await rejects(near.decode(req(NEAR_METHODS.signAndSendTransaction, { actions: [] }), ctx), "near/bad-params");
    await rejects(near.decode(req(NEAR_METHODS.signAndSendTransaction, { receiverId: "bob.testnet", actions: [{ type: "Transfer", params: {} }] }), ctx), "near/bad-action");
    await rejects(near.decode(req("near_teleport", {}), ctx), "near/unsupported-method");
    await rejects(near.decode(req(NEAR_METHODS.signAndSendTransactions, { transactions: [] }), ctx), "near/bad-params");
  });
});

describe("prepare / finalize", () => {
  it("signs and sends a transfer: payload is sha256(borsh tx) and send_tx gets the signed tx", async () => {
    const c = chain();
    const r = req(NEAR_METHODS.signAndSendTransaction, { receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: (15n * NEAR / 10n).toString() } }] });
    const { payloads, result } = await roundTrip(r, c.ctx);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ accountId: "near:0", scheme: "ed25519", approvalId: "approval-1" });
    expect(hex(payloads[0]!.bytes)).toBe(FIX.nativeTransfer.hash);
    expect(c.sent).toEqual([FIX.nativeTransfer.signedBase64]);
    expect(result).toMatchObject({ status: { SuccessValue: "" }, transaction: { hash: "h1" } });
    // The prepared transaction is used once.
    await rejects(near.finalize(r, [signer.sign(payloads[0]!)], c.ctx), "near/not-prepared");
  });

  it("refuses a bad signature and sends nothing", async () => {
    const c = chain();
    const r = req(NEAR_METHODS.signAndSendTransaction, { receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: (15n * NEAR / 10n).toString() } }] });
    const [p] = await near.prepare(r, c.ctx, "a");
    const wrong = { scheme: "ed25519" as const, bytes: fromHex(FIX.stake.sig), publicKey: ME };
    const e = await rejects(near.finalize(r, [wrong], c.ctx), "near/bad-signature");
    expect(e.userMessage).toBe("The signature didn't match. Nothing was sent.");
    expect(c.sent).toEqual([]);
    expect(p).toBeDefined();
    await rejects(near.finalize(req(NEAR_METHODS.signAndSendTransaction, { receiverId: "bob.testnet", actions: [] }), [], c.ctx), "near/not-prepared");
  });

  it("sends a batch in order with increasing nonces", async () => {
    const c = chain();
    const r = req(NEAR_METHODS.signAndSendTransactions, {
      transactions: [
        { receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: NEAR.toString() } }] },
        { signerId: ME, receiverId: "alice.testnet", actions: [{ enum: "transfer", transfer: { deposit: (2n * NEAR).toString() } }] },
      ],
    });
    const d = await near.decode(r, c.ctx);
    expect(d.title).toBe("Approve 2 transactions");
    expect(d.balanceChanges[0]?.delta).toBe((-3n * NEAR).toString());
    const { payloads, result } = await roundTrip(r, c.ctx);
    expect(payloads.map((p) => hex(p.bytes))).toEqual([FIX.batch1.hash, FIX.batch2.hash]);
    expect(c.sent).toEqual([FIX.batch1.signedBase64, FIX.batch2.signedBase64]);
    expect(Array.isArray(result) && result.length).toBe(2);
  });

  it("returns a failed outcome to dapps but plain words to the wallet", async () => {
    const failure = { Failure: { ActionError: { index: 0, kind: { AccountDoesNotExist: { account_id: "bob.testnet" } } } } };
    const mk = () => chain({ send_tx: () => outcome("h", ME, "bob.testnet", failure) });
    const body = { receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: (15n * NEAR / 10n).toString() } }] };
    const { result } = await roundTrip(req(NEAR_METHODS.signAndSendTransaction, body), mk().ctx);
    expect(result).toMatchObject({ status: failure });
    const c = mk();
    const own = req(NEAR_METHODS.signAndSendTransaction, body, "clip-wallet");
    const ps = await near.prepare(own, c.ctx, "a");
    const e = await rejects(near.finalize(own, ps.map((p) => signer.sign(p)), c.ctx), "near/tx-failed");
    expect(e.userMessage).toBe("One of the accounts in this transaction doesn't exist. Check the account name and try again.");
  });

  it("maps RPC send errors to plain words", async () => {
    const c = chain({ send_tx: () => { throw new RpcFail("INVALID_TRANSACTION", { TxExecutionError: { InvalidTxError: { NotEnoughBalance: { signer_id: ME, balance: "1", cost: "2" } } } }); } });
    const r = req(NEAR_METHODS.signAndSendTransaction, { receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: (15n * NEAR / 10n).toString() } }] });
    const ps = await near.prepare(r, c.ctx, "a");
    const e = await rejects(near.finalize(r, ps.map((p) => signer.sign(p)), c.ctx), "near/send-failed");
    expect(e.userMessage).toBe("You don't have enough NEAR to cover this and its network fee.");
    expect(plainNearError('{"InvalidTxError":"Expired"}')).toBe("This transaction took too long and expired. Try again.");
    expect(plainNearError('{"InvalidTxError":{"InvalidNonce":{"tx_nonce":1,"ak_nonce":2}}}')).toMatch(/got there first/);
    expect(plainNearError('{"LackBalanceForState":{}}')).toMatch(/storage/);
    expect(plainNearError("weird")).toBe("NEAR didn't accept this transaction. Try again in a moment.");
  });
});

describe("NEP-413 signMessage", () => {
  const nonce = Uint8Array.from({ length: 32 }, (_, i) => i);
  const msg = (extra: Record<string, unknown> = {}, origin = "https://app.example") =>
    req(NEAR_METHODS.signMessage, { message: "Sign in to app.example", recipient: "app.example", nonce: b64encode(nonce), ...extra }, origin);

  it("decodes, signs the NEP-413 hash and returns the SignedMessage", async () => {
    const { ctx } = chain();
    const d = await near.decode(msg({ state: "s1" }), ctx);
    expect(d.title).toBe("Sign in to app.example");
    expect(d.warnings).toEqual([]);
    expect(d.lines.find((l) => l.label === "Nonce")?.value).toBe(b64encode(nonce));
    const { payloads, result } = await roundTrip(msg({ state: "s1" }), ctx);
    expect(hex(payloads[0]!.bytes)).toBe(FIX.nep413.hash);
    expect(result).toEqual({ accountId: ME, publicKey: FIX.publicKey, signature: FIX.nep413.sigBase64, state: "s1" });
    expect(ed25519.verify(b64decode(FIX.nep413.sigBase64), fromHex(FIX.nep413.hash), PK.data)).toBe(true);
  });

  it("accepts nonce bytes as number[] / Buffer JSON (WalletConnect) and the callbackUrl", async () => {
    const { ctx } = chain();
    const r = req(NEAR_METHODS.signMessage, { message: "hi", recipient: "myapp.com", nonce: { type: "Buffer", data: [...nonce] }, callbackUrl: "myapp.com/callback" }, "https://myapp.com", "walletconnect");
    const { payloads, result } = await roundTrip(r, ctx);
    expect(hex(payloads[0]!.bytes)).toBe(FIX.nep413cb.hash);
    expect(result).toEqual({ accountId: ME, publicKey: FIX.publicKey, signature: FIX.nep413cb.sigBase64 });
  });

  it("warns when the recipient isn't the requesting site", async () => {
    const { ctx } = chain();
    const d = await near.decode(msg({}, "https://evil.example"), ctx);
    expect(d.title).toBe("Sign a message for evil.example");
    expect(d.warnings.map((w) => [w.level, w.code])).toEqual([["danger", "domain-mismatch"]]);
    const sub = await near.decode(msg({}, "https://www.app.example"), ctx);
    expect(sub.warnings).toEqual([]);
    const contract = await near.decode(msg({ recipient: "social.near" }), ctx);
    expect(contract.warnings.map((w) => [w.level, w.code])).toEqual([["caution", "domain-mismatch"]]);
  });

  it("needs a 32-byte nonce and a full-access key for named accounts", async () => {
    const { ctx } = chain({ "view_access_key:alice.testnet": { nonce: 1, permission: { FunctionCall: { allowance: null, method_names: [], receiver_id: "x.testnet" } } } });
    await rejects(near.decode(req(NEAR_METHODS.signMessage, { message: "m", recipient: "app.example", nonce: b64encode(new Uint8Array(28)) }), ctx), "near/bad-params");
    await rejects(near.prepare(msg({ accountId: "alice.testnet" }), ctx, "a"), "near/limited-key");
  });
});

describe("WalletConnect", () => {
  it("signs a dapp-built transaction and returns it in the same byte shape", async () => {
    const { ctx, sent } = chain();
    const bytes = b64decode(FIX.wcTx.txBase64);
    const r = req(NEAR_METHODS.wcSignTransaction, { transaction: { type: "Buffer", data: [...bytes] } }, "https://guest-book.example", "walletconnect");
    const d = await near.decode(r, ctx);
    expect(d.title).toBe("Call add_message on guest-book.testnet");
    expect(d.lines.at(-1)).toEqual({ label: "Sent by", value: "guest-book.example (it gets the signed transaction)" });
    const { payloads, result } = await roundTrip(r, ctx);
    expect(hex(payloads[0]!.bytes)).toBe(FIX.wcTx.hash);
    expect(result).toEqual({ type: "Buffer", data: [...b64decode(FIX.wcTx.signedBase64)] });
    expect(sent).toEqual([]);
  });

  it("accepts a JSON-serialised Uint8Array (wallet-selector tx.encode()) and batches", async () => {
    const { ctx } = chain();
    const asObj = (b: Uint8Array) => Object.fromEntries([...b].map((x, i) => [String(i), x]));
    const r = req(NEAR_METHODS.wcSignTransactions, { transactions: [asObj(b64decode(FIX.wcTx.txBase64)), [...b64decode(FIX.wcTx2.txBase64)]] }, "https://x.example", "walletconnect");
    const { result } = await roundTrip(r, ctx);
    expect(result).toEqual([[...b64decode(FIX.wcTx.signedBase64)], [...b64decode(FIX.wcTx2.signedBase64)]]);
  });

  it("refuses transactions for another key and unreadable bytes", async () => {
    const { ctx } = chain();
    const other = decodeTransaction(b64decode(FIX.wcTx.txBase64));
    other.publicKey = parsePublicKey(APP_KEY);
    await rejects(near.decode(req(NEAR_METHODS.wcSignTransaction, { transaction: [...encodeTransaction(other)] }), ctx), "near/wrong-account");
    await rejects(near.decode(req(NEAR_METHODS.wcSignTransaction, { transaction: [1, 2, 3] }), ctx), "near/bad-transaction");
  });

  it("near_signIn adds a function-call key on chain; near_signOut removes it", async () => {
    const accounts = [{ accountId: ME, publicKey: APP_KEY }];
    const c = chain();
    const signIn = req(NEAR_METHODS.wcSignIn, { permission: { receiverId: "guest-book.testnet", methodNames: [] }, accounts }, "https://guest-book.example", "walletconnect");
    const d = await near.decode(signIn, c.ctx);
    expect(d.title).toBe("Let guest-book.example use guest-book.testnet for you");
    const a = await roundTrip(signIn, c.ctx);
    expect(hex(a.payloads[0]!.bytes)).toBe(FIX.signIn.hash);
    expect(a.result).toBeNull();
    const signOut = req(NEAR_METHODS.wcSignOut, { accounts }, "https://guest-book.example", "walletconnect");
    const b = await roundTrip(signOut, c.ctx);
    expect(hex(b.payloads[0]!.bytes)).toBe(FIX.signOut.hash);
    expect(c.sent).toEqual([FIX.signIn.signedBase64, FIX.signOut.signedBase64]);
  });
});

describe("buildTransfer", () => {
  const usdcAsset = { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: "near:testnet", address: USDC };

  it("builds a native transfer that round-trips to the fixture", async () => {
    const c = chain();
    const r = await near.buildTransfer({ asset: nearAsset("near:testnet"), to: "bob.testnet", amount: (15n * NEAR / 10n).toString() }, c.ctx);
    expect(r).toMatchObject({ origin: "clip-wallet", via: "injected", family: "near", method: NEAR_METHODS.signAndSendTransaction, params: { signerId: ME, receiverId: "bob.testnet" } });
    expect((await near.decode(r, c.ctx)).title).toBe("Send 1.5 NEAR to bob.testnet");
    await roundTrip(r, c.ctx);
    expect(c.sent).toEqual([FIX.nativeTransfer.signedBase64]);
  });

  it("registers the recipient with the token when needed (NEP-145)", async () => {
    const c = chain({
      [`call:${USDC}:ft_balance_of`]: "10000000",
      [`call:${USDC}:storage_balance_of`]: null,
      [`call:${USDC}:storage_balance_bounds`]: { min: "1250000000000000000000", max: "1250000000000000000000" },
    });
    const r = await near.buildTransfer({ asset: usdcAsset, to: "bob.testnet", amount: "2500000" }, c.ctx);
    const d = await near.decode(r, c.ctx);
    expect(d.title).toBe("Send 2.5 USDC to bob.testnet");
    const { payloads } = await roundTrip(r, c.ctx);
    expect(hex(payloads[0]!.bytes)).toBe(FIX.ftTransfer.hash);
    expect(c.sent).toEqual([FIX.ftTransfer.signedBase64]);
  });

  it("skips registration when the recipient already has storage", async () => {
    const c = chain({ [`call:${USDC}:ft_balance_of`]: "10000000", [`call:${USDC}:storage_balance_of`]: { total: "1250000000000000000000", available: "0" } });
    const r = await near.buildTransfer({ asset: usdcAsset, to: "bob.testnet", amount: "2500000" }, c.ctx);
    const actions = (r.params as { actions: { params: { methodName: string; gas: string; deposit: string } }[] }).actions;
    expect(actions.map((a) => a.params.methodName)).toEqual(["ft_transfer"]);
    expect(actions[0]?.params).toMatchObject({ gas: (30n * TGAS).toString(), deposit: "1" });
  });

  it("validates plainly", async () => {
    const c = chain({ [`call:${USDC}:ft_balance_of`]: "1" });
    const native = nearAsset("near:testnet");
    await rejects(near.buildTransfer({ asset: native, to: "Bob!", amount: "1" }, c.ctx), "near/bad-address");
    await rejects(near.buildTransfer({ asset: native, to: ME, amount: "1" }, c.ctx), "near/self-transfer");
    await rejects(near.buildTransfer({ asset: native, to: "bob.testnet", amount: "0" }, c.ctx), "near/bad-amount");
    await rejects(near.buildTransfer({ asset: native, to: "alice.near", amount: "1" }, c.ctx), "near/wrong-network");
    await rejects(near.buildTransfer({ asset: native, to: "ghost.testnet", amount: "1" }, c.ctx), "near/account-not-found");
    await rejects(near.buildTransfer({ asset: native, to: "bob.testnet", amount: (101n * NEAR).toString() }, c.ctx), "near/insufficient-funds");
    await rejects(near.buildTransfer({ asset: usdcAsset, to: "bob.testnet", amount: "2" }, c.ctx), "near/insufficient-token");
    // Implicit recipients need no lookup: sending creates the account.
    const implicit = "ab".repeat(32);
    const ok = await near.buildTransfer({ asset: native, to: implicit, amount: "1" }, c.ctx);
    expect((ok.params as { receiverId: string }).receiverId).toBe(implicit);
    const main = mockNear({}, []);
    await rejects(near.buildTransfer({ asset: nearAsset("near:mainnet"), to: "bob.testnet", amount: "1" }, ctxFor(account, main.fetch, NEAR_MAINNET)), "near/wrong-network");
  });
});

describe("staking", () => {
  const fastnear: [RegExp, unknown][] = [[/test\.api\.fastnear\.com\/v1\/account\/.+\/staking$/, { account_id: ME, pools: [{ pool_id: POOL, last_update_block_height: 1 }, { pool_id: "old.pool.f863973.m0", last_update_block_height: null }] }]];

  it("lists positions from FastNEAR pools and get_account", async () => {
    const c = chain(
      {
        [`call:${POOL}:get_account`]: { account_id: ME, unstaked_balance: (5n * NEAR).toString(), staked_balance: (50n * NEAR).toString(), can_withdraw: false },
        "call:old.pool.f863973.m0:get_account": { account_id: ME, unstaked_balance: "4", staked_balance: "0", can_withdraw: true },
        "call:extra.pool.f863973.m0:get_account": { account_id: ME, unstaked_balance: NEAR.toString(), staked_balance: "0", can_withdraw: true },
      },
      fastnear,
    );
    const mod = createNearModule({ stakingPools: { "near:testnet": ["extra.pool.f863973.m0"] } });
    const pos = await mod.staking.getPositions(c.ctx);
    expect(pos).toEqual([
      { validator: "extra.pool.f863973.m0", validatorName: "extra", asset: nearAsset("near:testnet"), staked: "0", withdrawable: NEAR.toString() },
      { validator: POOL, validatorName: "kiln", asset: nearAsset("near:testnet"), staked: (50n * NEAR).toString(), unstaking: (5n * NEAR).toString() },
    ]);
  });

  it("builds stake / unstake / withdraw requests that sign like the fixtures", async () => {
    const c = chain();
    const stake = await near.staking.buildStake({ validator: POOL, amount: (50n * NEAR).toString() }, c.ctx);
    expect(stake).toMatchObject({ origin: "clip-wallet", via: "injected", method: NEAR_METHODS.signAndSendTransaction, params: { receiverId: POOL } });
    expect((await near.decode(stake, c.ctx)).title).toBe("Stake 50 NEAR with kiln");
    expect(hex((await near.prepare(stake, c.ctx, "a"))[0]!.bytes)).toBe(FIX.stake.hash);
    const unstake = await near.staking.buildUnstake({ validator: POOL, amount: (20n * NEAR).toString() }, c.ctx);
    const du = await near.decode(unstake, c.ctx);
    expect(du.title).toBe("Unstake 20 NEAR from kiln");
    expect(du.lines.find((l) => l.label === "When")?.value).toMatch(/about 4 epochs/);
    expect(hex((await near.prepare(unstake, c.ctx, "a"))[0]!.bytes)).toBe(FIX.unstake.hash);
    const withdraw = await near.staking.buildWithdraw({ validator: POOL }, c.ctx);
    expect((await near.decode(withdraw, c.ctx)).title).toBe("Withdraw your unstaked NEAR from kiln");
    await roundTrip(withdraw, c.ctx);
    expect(c.sent).toEqual([FIX.withdraw.signedBase64]);
  });

  it("refuses non-pools and amounts over the balance", async () => {
    const { ctx } = chain();
    await rejects(near.staking.buildStake({ validator: "bob.testnet", amount: "1" }, ctx), "near/bad-validator");
    await rejects(near.staking.buildStake({ validator: POOL, amount: (200n * NEAR).toString() }, ctx), "near/insufficient-funds");
  });
});

describe("balances, NFTs and accounts", () => {
  it("reports spendable NEAR (storage reserve beyond the 770-byte free allowance)", () => {
    expect(spendable(10n * NEAR, 674)).toEqual({ storageReserved: 0n, available: 10n * NEAR });
    expect(spendable(10n * NEAR, 8792)).toEqual({ storageReserved: 8792n * 10n ** 19n, available: 10n * NEAR - 8792n * 10n ** 19n });
    expect(spendable(1n, 10_000)).toEqual({ storageReserved: 10n ** 23n, available: 0n });
  });

  it("lists NEAR and NEP-141 tokens, marking look-alikes as spam", async () => {
    const c = chain(
      {
        [`view_account:${ME}`]: viewAccount("453704219464313577114574583", 8792),
        "call:usdc.fakes.testnet:ft_metadata": { spec: "ft-1.0.0", name: "Bridged USDC", symbol: "USDC.e", decimals: 6 },
      },
      [
        [
          /\/v1\/account\/.+\/ft$/,
          {
            account_id: ME,
            tokens: [
              { contract_id: USDC, last_update_block_height: 1, balance: "2192767001630000" },
              { contract_id: "usdc.fakes.testnet", last_update_block_height: 1, balance: "15012265" },
              { contract_id: "zero.testnet", last_update_block_height: 1, balance: "0" },
              { contract_id: "broken.testnet", last_update_block_height: 1, balance: "5" },
            ],
          },
        ],
      ],
    );
    const b = await near.getBalances(c.ctx);
    expect(b[0]).toEqual({ asset: nearAsset("near:testnet"), amount: (453704219464313577114574583n - 8792n * 10n ** 19n).toString() });
    expect(b.slice(1).map((x) => [x.asset.key, x.asset.symbol, x.amount, !!x.asset.spam])).toEqual([
      ["usdc", "USDC", "2192767001630000", false],
      ["nep141:usdc.fakes.testnet", "USDC.e", "15012265", true],
    ]);
  });

  it("returns zero for an implicit account that doesn't exist yet", async () => {
    const m = mockNear({}, []);
    const b = await near.getBalances(ctxFor(account, m.fetch));
    expect(b).toEqual([{ asset: nearAsset("near:testnet"), amount: "0" }]);
  });

  it("spots look-alikes", () => {
    expect(isLookalike("near:testnet", "x.testnet", "USDС")).toBe(true); // Cyrillic С
    expect(isLookalike("near:testnet", USDC, "USDC")).toBe(false);
    expect(isLookalike("near:testnet", "fake.testnet", "wNEAR")).toBe(true);
    expect(isLookalike("near:testnet", "wrap.testnet", "wNEAR")).toBe(false);
    expect(isLookalike("near:testnet", "ref.testnet", "REF")).toBe(false);
  });

  it("lists NEP-171 NFTs with media resolved against base_uri", async () => {
    const c = chain(
      {
        "call:paras-token-v2.testnet:nft_metadata": { spec: "nft-1.0.0", name: "Paras Collectibles", symbol: "PARAS", base_uri: "https://ipfs.fleek.co/ipfs" },
        "call:paras-token-v2.testnet:nft_tokens_for_owner": [
          {
            token_id: "100:1",
            owner_id: ME,
            metadata: { title: "qwerty #1", media: "bafkreidbu2tupw3p4t5u737euanqe2sj3vgkn7czf5qehg565qfsu7ec4a", extra: JSON.stringify({ attributes: [{ trait_type: "Eyes", value: "Blue" }] }) },
          },
        ],
        "call:nft.examples.testnet:nft_metadata": { spec: "nft-1.0.0", name: "NFT Tutorial Contract", symbol: "GOTEAM", base_uri: null },
        "call:nft.examples.testnet:nft_tokens_for_owner": [
          { token_id: "a", owner_id: ME, metadata: { title: "GO TEAM", media: "https://bafybeidl4hjbpdr6u6xvlrizwxbrfcyqurzvcnn5xoilmcqbxfbdwrmp5m.ipfs.dweb.link/" } },
          { token_id: "b", owner_id: ME, metadata: { title: "Bad", media: "javascript:alert(1)" } },
        ],
      },
      [[/\/v1\/account\/.+\/nft$/, { account_id: ME, tokens: [{ contract_id: "paras-token-v2.testnet", last_update_block_height: 1 }, { contract_id: "nft.examples.testnet", last_update_block_height: 1 }, { contract_id: "gone.testnet", last_update_block_height: 1 }] }]],
    );
    const nfts = await near.getNfts(c.ctx);
    expect(nfts).toEqual([
      {
        networkId: "near:testnet",
        standard: "nep171",
        collection: { address: "paras-token-v2.testnet", name: "Paras Collectibles" },
        tokenId: "100:1",
        name: "qwerty #1",
        mediaUrl: "https://ipfs.fleek.co/ipfs/bafkreidbu2tupw3p4t5u737euanqe2sj3vgkn7czf5qehg565qfsu7ec4a",
        attributes: [{ trait: "Eyes", value: "Blue" }],
      },
      {
        networkId: "near:testnet",
        standard: "nep171",
        collection: { address: "nft.examples.testnet", name: "NFT Tutorial Contract" },
        tokenId: "a",
        name: "GO TEAM",
        mediaUrl: "https://bafybeidl4hjbpdr6u6xvlrizwxbrfcyqurzvcnn5xoilmcqbxfbdwrmp5m.ipfs.dweb.link/",
      },
      { networkId: "near:testnet", standard: "nep171", collection: { address: "nft.examples.testnet", name: "NFT Tutorial Contract" }, tokenId: "b", name: "Bad" },
    ]);
    expect(resolveMedia("ipfs://bafy/x.png", null, "https://ipfs.io/ipfs/")).toBe("https://ipfs.io/ipfs/bafy/x.png");
    expect(resolveMedia("data:image/png;base64,AA", null, "g/")).toBeUndefined();
  });

  it("lists the implicit account plus named accounts for the key", async () => {
    const m = mockNear({}, [[/test\.api\.fastnear\.com\/v0\/public_key\/ed25519:6j4b6zUaty6fD1awqcGCCU9JYGCWYUgdJhQrzfZhqE25$/, { public_key: FIX.publicKey, account_ids: ["me.testnet", ME, "me.testnet", "BAD"] }]]);
    expect(await near.listAccountIds(ctxFor(account, m.fetch))).toEqual([ME, "me.testnet"]);
    const down = mockNear({}, []);
    expect(await near.listAccountIds(ctxFor(account, down.fetch))).toEqual([ME]);
  });

  it("uses a named account as the signer when the context's address is one", async () => {
    const named = makeAccount(ME, "me.testnet");
    const c = chain({ "view_access_key:me.testnet": fullAccess(1) });
    const r = req(NEAR_METHODS.signAndSendTransaction, { receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: "1" } }] });
    const [p] = await near.prepare(r, { ...c.ctx, account: named }, "a");
    const tx = decodeTransaction(b64decode(FIX.nativeTransfer.txBase64));
    expect(p!.bytes).toEqual(sha256(encodeTransaction({ ...tx, signerId: "me.testnet", nonce: 2n, actions: [{ kind: "Transfer", deposit: 1n }] })));
    expect(base58.encode(tx.blockHash)).toBe(FIX.blockHash);
  });
});
