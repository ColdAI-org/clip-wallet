import { ClipError, type DappRequest } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { LocalForger, ProtocolsHash } from "@taquito/local-forging";
import { describe, expect, it } from "vitest";
import {
  REVEAL_LINE,
  TEZOS_MAINNET,
  TEZOS_METHODS,
  TEZOS_NETWORKS,
  TEZOS_SHADOWNET,
  accountsResult,
  b58cEncode,
  beaconNetworkType,
  createTezosModule,
  encodePublicKey,
  fromBeaconNetwork,
  fromChainId,
  minimalFee,
  operationHash,
  plainTezosError,
  tokenAssetKey,
  unpack,
  xtzAsset,
} from "../src/index.js";
import { blake2b256, concat, fromHex, hex } from "../src/encoding.js";
import { BAKER, BAKER2, BOB, BRANCH, FA12, FA2, FRESH, ME, chain, ctxFor, fa12Token, fa2Token, fixtureSigner, makeAccount, req, simEcho } from "./helpers.js";
import { FIX, SIGS } from "./signatures.js";
import { SIM } from "./sim-fixtures.js";

const XTZ = xtzAsset(TEZOS_SHADOWNET.id);
const signer = fixtureSigner(Object.values(SIGS));
const send = (operations: unknown[], extra: Record<string, unknown> = {}, origin?: string) => req(TEZOS_METHODS.send, { account: ME, operations, ...extra }, origin);
const xtzOp = (amount: string, destination = BOB) => ({ kind: "transaction", amount, destination });
const fa2Transfer = (to: string, id: string, amount: string, from = ME) => ({
  kind: "transaction",
  amount: "0",
  destination: FA2,
  parameters: { entrypoint: "transfer", value: [{ prim: "Pair", args: [{ string: from }, [{ prim: "Pair", args: [{ string: to }, { prim: "Pair", args: [{ int: id }, { int: amount }] }] }]] }] },
});
const tokenRoute = (t: unknown) => ({ match: new RegExp(`/v1/tokens\\?contract=${(t as { contract: { address: string } }).contract.address}`), reply: [t] });
const xtzSim = simEcho(SIM.xtz as never);

/** Captured with POST /chains/main/blocks/head/helpers/forge/operations on shadownet (protocol PsUshuai). */
const FORGE_VECTORS = {
  xtz: {
    contents: [{ kind: "transaction", source: ME, fee: "374", counter: "25155454", gas_limit: "2269", storage_limit: "0", amount: "5000000", destination: BOB }],
    hex: "d4597e404a41a7b3f6d6509af41659cd95de4f8be8fabc5a1ed0cde38d91e4216c006b1195925ca88aafe7b7e6a0adf20b97ec20edb7f602feaeff0bdd1100c096b1020000b6b73d36509fb4085b6fb255132bb84a2a9b45a600",
  },
  revealTx: {
    contents: [
      { kind: "reveal", source: ME, fee: "374", counter: "25155454", gas_limit: "1000", storage_limit: "0", public_key: FIX.edpk },
      { kind: "transaction", source: ME, fee: "400", counter: "25155455", gas_limit: "2269", storage_limit: "277", amount: "1", destination: BOB },
    ],
    hex: "d4597e404a41a7b3f6d6509af41659cd95de4f8be8fabc5a1ed0cde38d91e4216b006b1195925ca88aafe7b7e6a0adf20b97ec20edb7f602feaeff0be8070000370ffb098088e67f8284ca4938f8f1eac02c3e2ab150f29adc8a7075a5ce7e63006c006b1195925ca88aafe7b7e6a0adf20b97ec20edb79003ffaeff0bdd119502010000b6b73d36509fb4085b6fb255132bb84a2a9b45a600",
  },
  fa2: {
    contents: [{ ...fa2Transfer(BOB, "0", "3000000"), source: ME, fee: "800", counter: "25155454", gas_limit: "5000", storage_limit: "100" }],
    hex: "d4597e404a41a7b3f6d6509af41659cd95de4f8be8fabc5a1ed0cde38d91e4216c006b1195925ca88aafe7b7e6a0adf20b97ec20edb7a006feaeff0b88276400018ffde7098b69dfec416559f7dfbbed20a130c92300ffff087472616e7366657200000069020000006407070100000024747a3156514134525034664c6a45454d57324652347045396b416735616262356835474c020000003407070100000024747a31634a394269347967415955764c3331666d4d43674b32476d5769545136696f47500707000000809bee02",
  },
  delegation: {
    contents: [{ kind: "delegation", source: ME, fee: "300", counter: "25155454", gas_limit: "1100", storage_limit: "0", delegate: BAKER }],
    hex: "d4597e404a41a7b3f6d6509af41659cd95de4f8be8fabc5a1ed0cde38d91e4216e006b1195925ca88aafe7b7e6a0adf20b97ec20edb7ac02feaeff0bcc0800ff001a1f5c4e7205b795a2b7334a6abe1c82da45a974",
  },
  stake: {
    contents: [
      { kind: "transaction", source: ME, fee: "500", counter: "25155454", gas_limit: "5000", storage_limit: "0", amount: "50000000", destination: ME, parameters: { entrypoint: "stake", value: { prim: "Unit" } } },
    ],
    hex: "d4597e404a41a7b3f6d6509af41659cd95de4f8be8fabc5a1ed0cde38d91e4216c006b1195925ca88aafe7b7e6a0adf20b97ec20edb7f403feaeff0b88270080e1eb1700006b1195925ca88aafe7b7e6a0adf20b97ec20edb7ff0600000002030b",
  },
};

const SIGN_IN_TEXT = "Tezos Signed Message: https://app.example 2026-10-03T00:00:00Z Sign in to App";
/** Beacon's sign-in form: "05" + "01" + 8-hex-digit byte length + utf8 hex. */
function michelineString(text: string): string {
  const b = new TextEncoder().encode(text);
  return `0501${b.length.toString(16).padStart(8, "0")}${hex(b)}`;
}

async function expectClip(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ClipError);
  expect((e as ClipError).code).toBe(code);
  if (message) expect((e as ClipError).userMessage).toMatch(message);
  return e as ClipError;
}

describe("networks and addresses", () => {
  it("CAIP-2 ids are tezos:<chain id>; testnets first", () => {
    expect(TEZOS_SHADOWNET.id).toBe("tezos:NetXsqzbfFenSTS");
    expect(TEZOS_MAINNET.id).toBe("tezos:NetXdQprcVkpaWU");
    expect(TEZOS_NETWORKS.map((n) => n.testnet)).toEqual([true, false]);
    expect(fromChainId("tezos:mainnet")).toBe(TEZOS_MAINNET.id);
    expect(fromChainId("NetXsqzbfFenSTS")).toBe(TEZOS_SHADOWNET.id);
    expect(fromChainId("tezos:NetXnHfVqm9iesp")).toBeNull(); // ghostnet, retired
    expect(beaconNetworkType(TEZOS_SHADOWNET.id)).toBe("shadownet");
    expect(fromBeaconNetwork({ type: "mainnet" })).toBe(TEZOS_MAINNET.id);
    expect(fromBeaconNetwork({ type: "custom", rpcUrl: "https://rpc.shadownet.teztnets.com/" })).toBe(TEZOS_SHADOWNET.id);
    expect(fromBeaconNetwork({ type: "ghostnet" })).toBeUndefined();
    expect(xtzAsset(TEZOS_MAINNET.id)).toMatchObject({ key: "xtz", decimals: 6 });
    expect(tokenAssetKey(TEZOS_MAINNET.id, "KT1XnTn74bUtxHfDtBmm2bGZAQfhPbvKWR8o", "0")).toBe("usdt");
    expect(tokenAssetKey(TEZOS_SHADOWNET.id, FA2, "0")).toBe(`fa:${FA2}:0`);
  });

  it("tz1 and edpk from the public key (vector: WalletConnect tezos_getAccounts example)", () => {
    const m = createTezosModule();
    const pub = fromHex(FIX.publicKey);
    expect(m.addressFromPublicKey(pub, TEZOS_SHADOWNET)).toBe("tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL");
    expect(encodePublicKey(pub)).toBe("edpku4US3ZykcZifjzSGFCmFr3zRgCKndE82estE4irj4d5oqDNDvf");
    expect(accountsResult(makeAccount())).toEqual([{ algo: "ed25519", address: ME, pubkey: FIX.edpk }]);
    expect(m.derivationPath(0)).toBe("m/44'/1729'/0'/0'");
    expect(m.derivationPath(3)).toBe("m/44'/1729'/3'/0'");
  });

  it("isAddress: tz1–tz4 and KT1 with checksum", () => {
    const m = createTezosModule();
    expect(m.isAddress(ME)).toBe(true);
    expect(m.isAddress(FA2)).toBe(true);
    expect(m.isAddress(b58cEncode("tz2", new Uint8Array(20).fill(1)))).toBe(true);
    expect(m.isAddress(b58cEncode("tz4", new Uint8Array(20).fill(2)))).toBe(true);
    expect(m.isAddress(`${ME.slice(0, -1)}X`)).toBe(false);
    expect(m.isAddress("0x1234")).toBe(false);
    expect(m.networksForAddress(ME, TEZOS_NETWORKS)).toHaveLength(2);
  });

  it("local forging equals the node's forge RPC (captured vectors)", async () => {
    const lf = new LocalForger(ProtocolsHash.PsUshuai9);
    for (const v of Object.values(FORGE_VECTORS)) {
      expect(await lf.forge({ branch: BRANCH, contents: v.contents } as never)).toBe(v.hex);
    }
  });

  it("minimal fee formula", () => {
    // 100 + 1 mutez/byte + 0.1 mutez/gas, rounded up
    expect(minimalFee(170, 2269n)).toBe(100n + 170n + 227n);
  });
});

describe("tezos_send", () => {
  it("XTZ transfer: decode, prepare (blake2b(03‖forged)), finalize injects and returns the hash", async () => {
    const { fetch, calls } = chain({ sim: xtzSim, inject: (b: unknown) => operationHash(fromHex(b as string)) });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const r = send([xtzOp("5000000")]);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Send 5 XTZ to tz1c…ioGP");
    expect(d.blind).toBe(false);
    expect(d.simulated).toBe(true);
    expect(d.balanceChanges).toEqual([{ asset: XTZ, delta: "-5000000" }]);
    expect(d.lines).toContainEqual({ label: "To", value: BOB });
    expect(d.lines).toContainEqual({ label: "Network fee", value: "0.000481 XTZ" });
    expect(d.fee).toEqual({ asset: XTZ, amount: "481" });
    expect(d.warnings).toEqual([]);

    // The simulation saw counter+1, the head~2 branch and a zero signature.
    const sim = calls.find((c) => c.url.endsWith("simulate_operation"))!.body as { operation: { branch: string; contents: { counter: string }[] }; chain_id: string };
    expect(sim.operation.branch).toBe(BRANCH);
    expect(sim.operation.contents[0]!.counter).toBe("25155454");
    expect(sim.chain_id).toBe("NetXsqzbfFenSTS");

    const [payload, ...rest] = await m.prepare(r, ctx, "approval-1");
    expect(rest).toEqual([]);
    expect(payload!.scheme).toBe("ed25519");
    const forged = await new LocalForger(ProtocolsHash.PsUshuai9).forge({
      branch: BRANCH,
      contents: [{ kind: "transaction", source: ME, fee: "481", counter: "25155454", gas_limit: "2269", storage_limit: "0", amount: "5000000", destination: BOB }],
    } as never);
    expect(hex(payload!.bytes)).toBe(hex(blake2b256(concat(new Uint8Array([3]), fromHex(forged)))));

    const sig = signer.sign(payload!);
    expect(ed25519.verify(sig.bytes, payload!.bytes, fromHex(FIX.publicKey))).toBe(true);
    const out = (await m.finalize(r, [sig], ctx)) as { operationHash: string };
    const injected = calls.find((c) => c.url.includes("/injection/operation"))!;
    expect(injected.body).toBe(forged + hex(sig.bytes));
    expect(out.operationHash).toBe(operationHash(fromHex(forged + hex(sig.bytes))));
    expect(out.operationHash.startsWith("o")).toBe(true);
  });

  it("rejects a signature that doesn't match", async () => {
    const { fetch, calls } = chain({ sim: xtzSim });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const r = send([xtzOp("5000000")]);
    const [p] = await m.prepare(r, ctx, "a");
    const sig = signer.sign(p!);
    const bad = new Uint8Array(sig.bytes);
    bad[0]! ^= 1;
    await expectClip(m.finalize(r, [{ ...sig, bytes: bad }], ctx), "tezos/bad-signature", /didn't match/);
    expect(calls.some((c) => c.url.includes("injection"))).toBe(false);
  });

  it("finalize without prepare fails plainly", async () => {
    const { fetch } = chain({ sim: xtzSim });
    await expectClip(createTezosModule().finalize(send([xtzOp("1")]), [], ctxFor(fetch)), "tezos/expired");
  });

  it("injection errors become plain messages", async () => {
    const { fetch } = chain({ sim: xtzSim, inject: [{ kind: "temporary", id: "proto.025-PsUshuai.contract.counter_in_the_past" }], injectStatus: 500 });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const r = send([xtzOp("5000000")]);
    const [p] = await m.prepare(r, ctx, "a");
    await expectClip(m.finalize(r, [signer.sign(p!)], ctx), "tezos/send-failed", /same time/);
  });

  it("first transaction from a new account prepends a reveal", async () => {
    const revealMeta = { operation_result: { status: "applied", consumed_milligas: "1000000" } }; // synthetic reveal result
    const sim = (b: unknown) => {
      const contents = (b as { operation: { contents: Record<string, unknown>[] } }).operation.contents;
      return { contents: contents.map((c) => ({ ...c, metadata: c.kind === "reveal" ? revealMeta : SIM.xtz.contents[0]!.metadata })) };
    };
    const { fetch, calls } = chain({ managerKey: null, sim });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const r = send([xtzOp("1000000")]);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Send 1 XTZ to tz1c…ioGP");
    expect(d.lines).toContainEqual({ label: "Account setup", value: REVEAL_LINE });
    const body = calls.find((c) => c.url.endsWith("simulate_operation"))!.body as { operation: { contents: Record<string, string>[] } };
    expect(body.operation.contents.map((c) => [c.kind, c.counter])).toEqual([
      ["reveal", "25155454"],
      ["transaction", "25155455"],
    ]);
    expect(body.operation.contents[0]!.public_key).toBe(FIX.edpk);
    const [p] = await m.prepare(r, ctx, "a");
    expect(p!.bytes).toHaveLength(32);
  });

  it("a dapp reveal is dropped when the account is already revealed", async () => {
    const { fetch, calls } = chain({ sim: xtzSim });
    const d = await createTezosModule().decode(send([{ kind: "reveal", public_key: FIX.edpk }, xtzOp("1")]), ctxFor(fetch));
    expect(d.title).toBe("Send 0.000001 XTZ to tz1c…ioGP");
    const body = calls.find((c) => c.url.endsWith("simulate_operation"))!.body as { operation: { contents: unknown[] } };
    expect(body.operation.contents).toHaveLength(1);
  });

  it("sending to a new address shows the storage cost", async () => {
    const { fetch } = chain({ sim: simEcho(SIM.alloc as never) });
    const d = await createTezosModule().decode(send([xtzOp("1000000", FRESH)]), ctxFor(fetch));
    // 257 bytes allocation + 20 buffer, × 250 mutez/byte
    expect(d.lines).toContainEqual({ label: "Storage", value: "up to 0.06925 XTZ (paid once to the network for storing data)" });
    expect(BigInt(d.fee!.amount)).toBeGreaterThan(69250n);
  });

  it("keeps a higher dapp fee", async () => {
    const { fetch } = chain({ sim: xtzSim });
    const d = await createTezosModule().decode(send([{ ...xtzOp("1"), fee: "5000", gas_limit: "9000" }]), ctxFor(fetch));
    expect(d.fee!.amount).toBe("5000");
  });

  it("FA2 transfer with TzKT metadata", async () => {
    const { fetch } = chain({ sim: xtzSim, tzkt: [tokenRoute(fa2Token), { match: new RegExp(`/v1/accounts/${FA2}$`), reply: { alias: "Test Coin" } }] });
    const d = await createTezosModule().decode(send([fa2Transfer(BOB, "0", "3000000")]), ctxFor(fetch));
    expect(d.title).toBe("Send 3 TST to tz1c…ioGP");
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: `fa:${FA2}:0`, symbol: "TST", decimals: 6 }), delta: "-3000000" }]);
    expect(d.lines).toContainEqual({ label: "Token contract", value: `Test Coin (${FA2})` });
  });

  it("FA1.2 transfer and approvals", async () => {
    const { fetch } = chain({ sim: xtzSim, tzkt: [tokenRoute(fa12Token)] });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const call = (entrypoint: string, value: unknown) => ({ kind: "transaction", amount: "0", destination: FA12, parameters: { entrypoint, value } });
    const t = await m.decode(send([call("transfer", { prim: "Pair", args: [{ string: ME }, { prim: "Pair", args: [{ string: BOB }, { int: "150000000" }] }] })]), ctx);
    expect(t.title).toBe("Send 1.5 tzBTC to tz1c…ioGP");
    expect(t.balanceChanges[0]!.delta).toBe("-150000000");

    const unlimited = await m.decode(send([call("approve", { prim: "Pair", args: [{ string: BOB }, { int: "340282366920938463463374607431768211456" }] })]), ctx);
    expect(unlimited.title).toBe("Let tz1c…ioGP spend all your tzBTC");
    expect(unlimited.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "unlimited-approval" }));

    const limited = await m.decode(send([call("approve", { prim: "Pair", args: [{ string: BOB }, { int: "1000" }] })]), ctx);
    expect(limited.title).toBe("Let tz1c…ioGP spend up to 0.00001 tzBTC");
    expect(limited.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "unlimited-approval" }));

    const revoke = await m.decode(send([call("approve", { prim: "Pair", args: [{ string: BOB }, { int: "0" }] })]), ctx);
    expect(revoke.warnings).toEqual([]);
  });

  it("FA2 update_operators add → approval-for-all danger", async () => {
    const { fetch } = chain({ sim: xtzSim, tzkt: [{ match: new RegExp(`/v1/accounts/${FA2}$`), reply: { alias: "Cool Cats" } }, { match: new RegExp(`/v1/accounts/${BOB}$`), reply: { alias: "objkt.com Marketplace" } }] });
    const value = [{ prim: "Left", args: [{ prim: "Pair", args: [{ string: ME }, { prim: "Pair", args: [{ string: BOB }, { int: "7" }] }] }] }];
    const d = await createTezosModule().decode(send([{ kind: "transaction", amount: "0", destination: FA2, parameters: { entrypoint: "update_operators", value } }]), ctxFor(fetch));
    expect(d.title).toBe("Let objkt.com Marketplace move your Cool Cats tokens");
    expect(d.warnings).toContainEqual({ level: "danger", code: "approval-for-all", message: "Lets objkt.com Marketplace move your Cool Cats tokens (token 7) at any time, without asking again." });
  });

  it("other contract calls are described with a preview", async () => {
    const { fetch } = chain({ sim: xtzSim, tzkt: [{ match: new RegExp(`/v1/accounts/${FA2}$`), reply: { alias: "Test Coin" } }] });
    const d = await createTezosModule().decode(
      send([{ kind: "transaction", amount: "2000000", destination: FA2, parameters: { entrypoint: "mint", value: { prim: "Pair", args: [{ string: ME }, { int: "5" }] } } }]),
      ctxFor(fetch),
    );
    expect(d.title).toBe("Call mint on Test Coin with 2 XTZ");
    expect(d.lines).toContainEqual({ label: "Details", value: `Pair("${ME}", 5)` });
    expect(d.balanceChanges).toEqual([{ asset: XTZ, delta: "-2000000" }]);
  });

  it("delegation and stopping it", async () => {
    const { fetch } = chain({ sim: simEcho(SIM.delegate_stake as never), tzkt: [{ match: new RegExp(`/v1/delegates/${BAKER}$`), reply: { address: BAKER, alias: "Captain Stake", active: true } }] });
    const m = createTezosModule();
    const d = await m.decode(send([{ kind: "delegation", delegate: BAKER }]), ctxFor(fetch));
    expect(d.title).toBe("Delegate to Captain Stake");
    expect(d.balanceChanges).toEqual([]);
    const stop = await m.decode(send([{ kind: "delegation" }]), ctxFor(fetch));
    expect(stop.title).toBe("Stop delegating");
  });

  it("origination is a caution", async () => {
    const { fetch } = chain({ sim: xtzSim });
    const d = await createTezosModule().decode(send([{ kind: "origination", balance: "1000000", script: { code: [], storage: { int: "0" } } }]), ctxFor(fetch));
    expect(d.title).toBe("Create a smart contract with 1 XTZ");
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "blind-signing" }));
    expect(d.blind).toBe(false);
  });

  it("operation kinds it can't explain are blind", async () => {
    const { fetch } = chain({ sim: xtzSim });
    const d = await createTezosModule().decode(send([{ kind: "increase_paid_storage", amount: "10", destination: FA2 }]), ctxFor(fetch));
    expect(d.blind).toBe(true);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "blind-signing" }));
  });

  it("refuses consensus operations and other accounts", async () => {
    const { fetch } = chain({ sim: xtzSim });
    const m = createTezosModule();
    await expectClip(m.decode(send([{ kind: "ballot", proposal: "x", ballot: "yay" }]), ctxFor(fetch)), "tezos/unsupported-operation");
    await expectClip(m.decode(send([{ ...xtzOp("1"), source: BOB }]), ctxFor(fetch)), "tezos/wrong-account");
    await expectClip(m.decode(req(TEZOS_METHODS.send, { account: BOB, operations: [xtzOp("1")] }), ctxFor(fetch)), "tezos/wrong-account");
    await expectClip(m.decode(send([xtzOp("1", "tz1notanaddress")]), ctxFor(fetch)), "tezos/bad-operation");
  });

  it("audit TEZ-01: refuses Micheline nodes that carry two values (shown as one address, forged as another)", async () => {
    const { fetch } = chain({ sim: xtzSim });
    const smuggled = {
      kind: "transaction",
      amount: "0",
      destination: FA2,
      parameters: { entrypoint: "transfer", value: [{ prim: "Pair", args: [{ string: ME }, [{ prim: "Pair", args: [{ string: BOB, bytes: "0000" + "11".repeat(20) }, { prim: "Pair", args: [{ int: "0" }, { int: "5" }] }] }]] }] },
    };
    await expectClip(createTezosModule().decode(send([smuggled]), ctxFor(fetch)), "tezos/bad-operation");
  });

  it("audit TEZ-02: a rebuild after approval can't cost more than the screen showed", async () => {
    let t = 1_000_000;
    let captured: unknown = SIM.xtz;
    const m = createTezosModule({ now: () => t, reuseMs: 1000 });
    const { fetch } = chain({ sim: (b: never) => simEcho(captured as never)(b) });
    const r = send([xtzOp("1")]);
    await m.decode(r, ctxFor(fetch));
    t += 5000;
    captured = SIM.alloc; // the destination now needs a new-account storage burn
    await expectClip(m.prepare(r, ctxFor(fetch), "a"), "tezos/fee-changed");
  });

  it("simulation failures: danger in decode, plain error in prepare", async () => {
    const m = createTezosModule();
    const fail = chain({ sim: simEcho(SIM.fa2_fail as never) });
    const r = send([fa2Transfer(BOB, "0", "5")]);
    const d = await m.decode(r, ctxFor(fail.fetch));
    expect(d.simulated).toBe(false);
    expect(d.warnings).toContainEqual({ level: "danger", code: "simulation-failed", message: "The app's contract refused this: “FA2_INSUFFICIENT_BALANCE”. Nothing was sent." });
    await expectClip(m.prepare(r, ctxFor(fail.fetch), "a"), "tezos/simulation-failed", /FA2_INSUFFICIENT_BALANCE/);

    const low = chain({ sim: simEcho(SIM.low as never) });
    const d2 = await m.decode(send([xtzOp("999000000000")]), ctxFor(low.fetch));
    expect(d2.warnings[0]!.message).toBe("You don't have enough XTZ for this, including the network fee.");

    const empty = chain({ sim: SIM.empty, simStatus: 500 });
    const d3 = await m.decode(send([xtzOp("1")]), ctxFor(empty.fetch));
    expect(d3.warnings[0]!.message).toMatch(/has no XTZ yet/);

    const noDelegate = chain({ sim: simEcho(SIM.stake_nodelegate as never) });
    const d4 = await m.decode(send([{ kind: "transaction", amount: "1000000", destination: ME, parameters: { entrypoint: "stake", value: { prim: "Unit" } } }]), ctxFor(noDelegate.fetch));
    expect(d4.warnings[0]!.message).toBe("Pick a baker (delegate) before staking.");
  });
});

describe("tezos_sign", () => {
  it("Micheline sign-in message: shows the text, signs blake2b(payload), returns edsig", async () => {
    const { fetch } = chain();
    const m = createTezosModule();
    const payload = michelineString(SIGN_IN_TEXT);
    expect(unpack(fromHex(payload))).toEqual({ kind: "string", text: SIGN_IN_TEXT });
    const r = req(TEZOS_METHODS.sign, { account: ME, payload, signingType: "micheline" });
    const d = await m.decode(r, ctxFor(fetch));
    expect(d.title).toBe("Sign in to app.example");
    expect(d.lines).toContainEqual({ label: "Statement", value: "Sign in to App" });
    expect(d.warnings).toEqual([]);
    expect(d.blind).toBe(false);
    const [p] = await m.prepare(r, ctxFor(fetch), "a");
    expect(hex(p!.bytes)).toBe(hex(blake2b256(fromHex(payload))));
    const out = (await m.finalize(r, [signer.sign(p!)], ctxFor(fetch))) as { signature: string };
    expect(out.signature.startsWith("edsig")).toBe(true);
  });

  it("sign-in for another domain → domain-mismatch", async () => {
    const { fetch } = chain();
    const d = await createTezosModule().decode(req(TEZOS_METHODS.sign, { payload: michelineString(SIGN_IN_TEXT) }, "https://evil.example"), ctxFor(fetch));
    expect(d.title).toBe("Sign in to app.example");
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "domain-mismatch" }));
  });

  it("packed data that isn't a string is blind (could be a permit)", async () => {
    const { fetch } = chain();
    const d = await createTezosModule().decode(req(TEZOS_METHODS.sign, { payload: "05070700010002" }), ctxFor(fetch));
    expect(d.blind).toBe(true);
    expect(d.warnings.map((w) => w.code)).toEqual(["permit", "blind-signing"]);
  });

  it("an operation payload (03…) is decoded but blind, with a danger warning", async () => {
    const { fetch } = chain();
    const m = createTezosModule();
    const r = req(TEZOS_METHODS.sign, { payload: `03${FORGE_VECTORS.xtz.hex}`, signingType: "operation" });
    const d = await m.decode(r, ctxFor(fetch));
    expect(d.title).toBe("Sign an operation for app.example: Send 5 XTZ to tz1c…ioGP");
    expect(d.blind).toBe(true);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "blind-signing" }));
    expect(d.fee!.amount).toBe("374");
    await expectClip(m.decode(req(TEZOS_METHODS.sign, { payload: "03deadbeef", signingType: "operation" }), ctxFor(fetch)), "tezos/unreadable-operation");
    await expectClip(m.decode(req(TEZOS_METHODS.sign, { payload: "0501", signingType: "operation" }), ctxFor(fetch)), "tezos/bad-payload");
  });

  it("raw text is a caution; raw binary is blind", async () => {
    const { fetch } = chain();
    const m = createTezosModule();
    const text = await m.decode(req(TEZOS_METHODS.sign, { payload: hex(new TextEncoder().encode("hello")), signingType: "raw" }), ctxFor(fetch));
    expect(text.lines).toContainEqual({ label: "Message", value: "hello" });
    expect(text.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "blind-signing" }));
    const bin = await m.decode(req(TEZOS_METHODS.sign, { payload: "00ff00ff", signingType: "raw" }), ctxFor(fetch));
    expect(bin.blind).toBe(true);
  });

  it("tezos_getAccounts needs no signature", async () => {
    const { fetch } = chain();
    const m = createTezosModule();
    const r = req(TEZOS_METHODS.getAccounts, {});
    expect(await m.prepare(r, ctxFor(fetch), "a")).toEqual([]);
    expect(await m.finalize(r, [], ctxFor(fetch))).toEqual([{ algo: "ed25519", address: ME, pubkey: FIX.edpk }]);
  });
});

describe("balances and NFTs (TzKT)", () => {
  const nft = {
    account: { address: ME },
    token: {
      contract: { alias: "hic et nunc NFTs", address: "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton" },
      tokenId: "885210",
      standard: "fa2",
      totalSupply: "5",
      metadata: {
        name: "Hanging on the cliff",
        symbol: "OBJKT",
        decimals: "0",
        displayUri: "ipfs://Qmb1vdJHpGX5851i2oc3zyBifUPh8cC7d3jpAGt5kr5jVT",
        artifactUri: "ipfs://Qmb1vdJHpGX5851i2oc3zyBifUPh8cC7d3jpAGt5kr5jVT",
        attributes: [{ name: "Border", value: "Cosmic Relic" }],
        isBooleanAmount: false,
      },
    },
    balance: "1",
  };
  const fake = { account: { address: ME }, token: { contract: { address: FA12 }, tokenId: "0", standard: "fa1.2", metadata: { name: "USD Coin", symbol: "USDC", decimals: "6" } }, balance: "100000000" };
  const routes = [
    { match: new RegExp(`/v1/accounts/${ME}$`), reply: { address: ME, balance: 33441477, stakedBalance: 30400495, unstakedBalance: 0 } },
    { match: /\/v1\/tokens\/balances\?account=/, reply: [{ account: { address: ME }, token: fa2Token, balance: "2500000" }, nft, fake] },
  ];

  it("XTZ is spendable balance; FA tokens with metadata; look-alikes are spam", async () => {
    const { fetch } = chain({ tzkt: routes });
    const b = await createTezosModule().getBalances(ctxFor(fetch));
    expect(b[0]).toEqual({ asset: XTZ, amount: "3040982" });
    expect(b[1]).toEqual({ asset: expect.objectContaining({ key: `fa:${FA2}:0`, symbol: "TST", decimals: 6, address: FA2 }), amount: "2500000" });
    expect(b[1]!.asset.spam).toBeUndefined();
    expect(b[2]!.asset).toMatchObject({ symbol: "USDC", spam: true });
    expect(b).toHaveLength(3);
  });

  it("NFTs: FA2 with TZIP-21 media and attributes", async () => {
    const { fetch } = chain({ tzkt: routes });
    const n = await createTezosModule({ ipfsGateway: "https://gw.example/ipfs/" }).getNfts(ctxFor(fetch));
    expect(n).toEqual([
      {
        networkId: TEZOS_SHADOWNET.id,
        standard: "fa2",
        collection: { address: "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton", name: "hic et nunc NFTs" },
        tokenId: "885210",
        name: "Hanging on the cliff",
        mediaUrl: "https://gw.example/ipfs/Qmb1vdJHpGX5851i2oc3zyBifUPh8cC7d3jpAGt5kr5jVT",
        attributes: [{ trait: "Border", value: "Cosmic Relic" }],
      },
    ]);
  });
});

describe("staking", () => {
  const baker = (limit: number) => ({ match: new RegExp(`/v1/delegates/${BAKER}$`), reply: { address: BAKER, alias: "Captain Stake", active: true, limitOfStakingOverBaking: limit } });
  const account = (delegate: unknown, staked = 0) => ({ match: new RegExp(`/v1/accounts/${ME}$`), reply: { address: ME, balance: 18151262 + staked, stakedBalance: staked, unstakedBalance: 0, delegate } });

  it("positions from TzKT account + unstake requests", async () => {
    const { fetch } = chain({
      tzkt: [
        account({ alias: "Ziroh", address: BAKER2, active: true }, 30400495),
        {
          match: /\/v1\/staking\/unstake_requests\?staker=/,
          reply: [
            { baker: { alias: "Ziroh", address: BAKER2 }, requestedAmount: 1000, actualAmount: 1000, finalizedAmount: 0, status: "pending", unlockTime: "2026-10-04T01:17:06Z" },
            { baker: { alias: "Ziroh", address: BAKER2 }, requestedAmount: 500, actualAmount: 500, finalizedAmount: 0, status: "finalizable" },
            { baker: { alias: "Ziroh", address: BAKER2 }, requestedAmount: 9, actualAmount: 9, finalizedAmount: 9, status: "finalized" },
          ],
        },
      ],
    });
    const p = await createTezosModule().staking.getPositions(ctxFor(fetch));
    expect(p).toEqual([
      { validator: BAKER2, validatorName: "Ziroh", asset: XTZ, staked: "30400495", delegated: "18151262", unstaking: "1000", withdrawable: "500", withdrawableAt: "2026-10-04T01:17:06Z" },
    ]);
  });

  it("buildStake: delegate + stake, decoded as a stake", async () => {
    const { fetch } = chain({ sim: simEcho(SIM.delegate_stake as never), tzkt: [account(null), baker(9000000)] });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const r = await m.staking.buildStake({ validator: BAKER, amount: "50000000" }, ctx);
    expect(r).toMatchObject({ origin: "clip-wallet", via: "injected", method: "tezos_send", family: "tezos" });
    const ops = (r.params as { operations: { kind: string; parameters?: { entrypoint: string } }[] }).operations;
    expect(ops.map((o) => o.parameters?.entrypoint ?? o.kind)).toEqual(["delegation", "stake"]);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Stake 50 XTZ with Captain Stake");
    expect(d.lines).toContainEqual({ label: "Also", value: "Delegate to Captain Stake" });
    expect(d.balanceChanges).toEqual([]);
  });

  it("buildStake with a baker that refuses staking only delegates, and says so", async () => {
    const { fetch } = chain({ sim: simEcho(SIM.delegate_stake as never), tzkt: [account(null), baker(0)] });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const r = await m.staking.buildStake({ validator: BAKER, amount: "50000000" }, ctx);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Delegate to Captain Stake");
    expect(d.lines).toContainEqual({ label: "Note", value: "Captain Stake doesn't accept staking, so this only delegates. Your XTZ stays liquid and still earns delegation rewards." });
  });

  it("dapps can't add notes", async () => {
    const { fetch } = chain({ sim: xtzSim });
    const d = await createTezosModule().decode(send([xtzOp("1")], { notes: ["Totally safe"] }), ctxFor(fetch));
    expect(d.lines.some((l) => l.value === "Totally safe")).toBe(false);
  });

  it("buildStake when already staking with that baker only stakes; amount 0 is refused", async () => {
    const { fetch } = chain({ tzkt: [account({ address: BAKER, alias: "Captain Stake" }), baker(9000000)] });
    const m = createTezosModule();
    const r = await m.staking.buildStake({ validator: BAKER, amount: "1000000" }, ctxFor(fetch));
    expect((r.params as { operations: unknown[] }).operations).toHaveLength(1);
    await expectClip(m.staking.buildStake({ validator: BAKER, amount: "0" }, ctxFor(fetch)), "tezos/already-delegated");
    await expectClip(m.staking.buildStake({ validator: FA2, amount: "1" }, ctxFor(fetch)), "tezos/bad-baker");
  });

  it("unstake and withdraw", async () => {
    const { fetch } = chain({ sim: simEcho(SIM.xtz as never), tzkt: [account({ address: BAKER, alias: "Captain Stake" }, 50000000)] });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const u = await m.staking.buildUnstake({ validator: BAKER, amount: "20000000" }, ctx);
    expect((await m.decode(u, ctx)).title).toBe("Unstake 20 XTZ from Captain Stake");
    const w = await m.staking.buildWithdraw({ validator: BAKER }, ctx);
    expect((await m.decode(w, ctx)).title).toBe("Withdraw your unstaked XTZ");
    await expectClip(m.staking.buildUnstake({ validator: BAKER2, amount: "1" }, ctx), "tezos/not-your-baker");
  });
});

describe("buildTransfer", () => {
  it("XTZ, FA2 and FA1.2; validation", async () => {
    const { fetch } = chain({ tzkt: [tokenRoute(fa2Token), tokenRoute(fa12Token)] });
    const m = createTezosModule();
    const ctx = ctxFor(fetch);
    const x = await m.buildTransfer({ asset: XTZ, to: BOB, amount: "1500000" }, ctx);
    expect(x.params).toEqual({ account: ME, operations: [{ kind: "transaction", amount: "1500000", destination: BOB }] });

    const asset = { key: `fa:${FA2}:0`, symbol: "TST", name: "Test Coin", decimals: 6, networkId: TEZOS_SHADOWNET.id, address: FA2 };
    const t = await m.buildTransfer({ asset, to: BOB, amount: "3000000" }, ctx);
    expect((t.params as { operations: unknown[] }).operations).toEqual([fa2Transfer(BOB, "0", "3000000")]);

    const a12 = { ...asset, key: `fa:${FA12}:0`, address: FA12 };
    const t12 = await m.buildTransfer({ asset: a12, to: BOB, amount: "7" }, ctx);
    expect((t12.params as { operations: { parameters: { value: unknown } }[] }).operations[0]!.parameters.value).toEqual({
      prim: "Pair",
      args: [{ string: ME }, { prim: "Pair", args: [{ string: BOB }, { int: "7" }] }],
    });

    await expectClip(m.buildTransfer({ asset: XTZ, to: ME, amount: "1" }, ctx), "tezos/self-transfer");
    await expectClip(m.buildTransfer({ asset: XTZ, to: "tz1nope", amount: "1" }, ctx), "tezos/bad-address");
    await expectClip(m.buildTransfer({ asset: XTZ, to: BOB, amount: "0" }, ctx), "tezos/bad-amount");
  });
});

describe("plain errors", () => {
  it("maps octez error ids", () => {
    expect(plainTezosError([{ id: "proto.025-PsUshuai.contract.balance_too_low" }])).toMatch(/enough XTZ/);
    expect(plainTezosError([{ id: "proto.025-PsUshuai.implicit.empty_implicit_contract" }])).toMatch(/no XTZ yet/);
    expect(plainTezosError([{ id: "proto.025-PsUshuai.contract.counter_in_the_past" }])).toMatch(/Try again/);
    expect(plainTezosError([{ id: "proto.025-PsUshuai.michelson_v1.script_rejected", with: { int: "12" } }])).toBe("The app's contract refused this: “error 12”. Nothing was sent.");
    expect(plainTezosError([{ id: "something.unknown" }])).toBe("The Tezos network didn't accept this. Nothing was sent. Try again in a moment.");
  });

  it("unknown methods", async () => {
    const { fetch } = chain();
    const r: DappRequest = req("tezos_frobnicate", {});
    await expectClip(createTezosModule().decode(r, ctxFor(fetch)), "tezos/unsupported-method");
  });
});
