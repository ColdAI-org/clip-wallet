import { ClipError, type DappRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { TronWeb, Trx, utils as twUtils } from "tronweb";
import { describe, expect, it } from "vitest";
import {
  TRON_MAINNET,
  TRON_METHODS,
  TRON_NETS,
  TRON_NETWORKS,
  TRON_NILE,
  TRON_SHASTA,
  addressBytes,
  controls,
  createTronModule,
  encodeRaw,
  fromChainId,
  jsonMismatches,
  messageHash,
  parseRaw,
  toBase58,
  txIdOf,
  usdtAsset,
} from "../src/index.js";
import { encodeTransfer, encodeTrigger } from "../src/tx.js";
import { fromHex, hex, utf8 } from "../src/util.js";
import { NILE_TX } from "./fixtures.js";
import { blockByNum, chainParameters, ctxFor, fixtureSigner, meAccount, mockTron, nowBlock, req } from "./helpers.js";
import { BOB, BOB_PUB, ME, ME_PUB, SIG } from "./signatures.js";

const NILE_USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const DAPP_NOW = 1_791_285_780_000; // after the fixtures were made, before they expire
const BUILD_NOW = 1_791_284_760_000;
const signer = fixtureSigner([SIG.builtTrx, SIG.dappTransfer, SIG.dappTrc20, SIG.message]);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const tw = { address: (TronWeb as unknown as { address: unknown }).address, utils: twUtils, Trx } as unknown as {
  address: { fromHex(h: string): string; toHex(a: string): string };
  utils: {
    crypto: { computeAddress(pub: number[] | Uint8Array): number[]; getBase58CheckAddress(b: number[]): string; ecRecover(data: string, sig: string): string };
    transaction: { txCheck(tx: unknown): boolean; txJsonToPb(tx: unknown): unknown; txPbToRawDataHex(pb: unknown): string };
    message: { hashMessage(m: string | Uint8Array): string };
  };
  Trx: { verifyMessageV2(message: string, signature: string): string };
};

/** A java-tron mock with this account, Bob, chain parameters, a head block and blocks matching `refHash`. */
function setup(over: Record<string, unknown> = {}, refHash: string = NILE_TX.transfer.raw_data.ref_block_hash, now = DAPP_NOW) {
  const mock = mockTron({
    "/wallet/getaccount": (b: Record<string, unknown>) => (b.address === ME ? meAccount() : b.address === BOB ? { address: BOB, balance: 1 } : {}),
    "/wallet/getaccountresource": { freeNetLimit: 600, freeNetUsed: 600 },
    "/wallet/getchainparameters": chainParameters,
    "/wallet/getnowblock": nowBlock(),
    "/wallet/getblockbynum": blockByNum(refHash),
    ...over,
  });
  return { m: createTronModule({ now: () => now, sleep: async () => {}, confirmPollMs: 0 }), ctx: ctxFor(mock.fetch), calls: mock.calls };
}

const signTx = (tx: unknown, extra: Record<string, unknown> = {}, origin?: string): DappRequest => req(TRON_METHODS.signTransaction, { address: ME, transaction: tx, ...extra }, origin);
const rawOf = (r: DappRequest) => (r.params as { transaction: { raw_data_hex: string } }).transaction.raw_data_hex;

describe("accounts and addresses", () => {
  const m = createTronModule();
  it("derives like TronLink / TronWeb.fromMnemonic and encodes T… addresses", () => {
    expect(m.family).toBe("tron");
    expect(m.curve).toBe("secp256k1");
    expect(m.derivationPath(0)).toBe("m/44'/195'/0'/0/0");
    expect(m.derivationPath(3)).toBe("m/44'/195'/0'/0/3");
    expect(m.addressFromPublicKey(fromHex(ME_PUB), TRON_NILE)).toBe(ME);
    expect(m.addressFromPublicKey(fromHex(BOB_PUB), TRON_MAINNET)).toBe(BOB);
  });

  it("matches TronWeb's own address maths", () => {
    // TronWeb computeAddress takes the 65-byte uncompressed key.
    for (const [pub, addr] of [[ME_PUB, ME], [BOB_PUB, BOB]] as const) {
      const uncompressed = secp256k1.Point.fromBytes(fromHex(pub)).toBytes(false);
      expect(tw.utils.crypto.getBase58CheckAddress(tw.utils.crypto.computeAddress(uncompressed))).toBe(addr);
      expect(tw.address.fromHex(hex(addressBytes(addr)!))).toBe(addr);
    }
  });

  it("checks base58check addresses", () => {
    expect(m.isAddress(ME)).toBe(true);
    expect(m.isAddress(` ${BOB} `)).toBe(true);
    expect(m.isAddress(`${ME.slice(0, -1)}${ME.endsWith("H") ? "J" : "H"}`)).toBe(false); // checksum
    expect(m.isAddress("41c8599111f29c1e1e061265b4af93ea1f274ad78a")).toBe(false); // hex is for dapps, not for typing
    expect(m.isAddress("0xc8599111f29c1e1e061265b4af93ea1f274ad78a")).toBe(false);
    expect(m.isAddress("T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb")).toBe(true); // the zero address (black hole)
    expect(toBase58("41c8599111f29c1e1e061265b4af93ea1f274ad78a")).toBe(ME);
    expect(m.networksForAddress(ME, [...TRON_NETWORKS, { ...TRON_NILE, id: "eip155:1", family: "evm" }]).map((n) => n.id)).toEqual(TRON_NETWORKS.map((n) => n.id));
    expect(m.networksForAddress("nope", TRON_NETWORKS)).toEqual([]);
  });
});

describe("networks", () => {
  it("uses the WalletConnect / Reown ids and accepts other spellings", () => {
    expect(TRON_NETWORKS.map((n) => n.id)).toEqual(["tron:0xcd8690dc", "tron:0x94a9059e", "tron:0x2b6653dc"]);
    expect(TRON_NILE.testnet && TRON_SHASTA.testnet && !TRON_MAINNET.testnet).toBe(true);
    expect(fromChainId("0x2b6653dc")).toBe(TRON_MAINNET.id);
    expect(fromChainId("tron:728126428")).toBe(TRON_MAINNET.id); // ChainAgnostic draft (decimal)
    expect(fromChainId(3448148188)).toBe(TRON_NILE.id);
    expect(fromChainId(TRON_NETS.shasta.genesisBlockId)).toBe(TRON_SHASTA.id);
    expect(fromChainId("eip155:1")).toBeNull();
    for (const n of Object.values(TRON_NETS)) expect(n.genesisBlockId.endsWith(n.chainId.slice(2))).toBe(true);
  });

  it("keys Tether USDT as usdt on mainnet only", () => {
    expect(usdtAsset(TRON_MAINNET.id)).toMatchObject({ key: "usdt", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 });
    expect(usdtAsset(TRON_NILE.id)).toMatchObject({ key: `trc20:${NILE_USDT}`, symbol: "USDT" });
    expect(usdtAsset(TRON_SHASTA.id)).toBeNull();
  });
});

describe("transaction bytes", () => {
  it("parses what java-tron builds: txID = sha256(raw_data), JSON agrees with the hex (as TronWeb's txCheck says)", () => {
    for (const [name, tx] of Object.entries(NILE_TX)) {
      const raw = parseRaw(fromHex(tx.raw_data_hex));
      expect(hex(txIdOf(raw.bytes)), name).toBe(tx.txID);
      expect(raw.contracts).toHaveLength(1);
      expect(raw.oddities, name).toEqual([]);
      expect(jsonMismatches(tx.raw_data as Record<string, unknown>, raw), name).toEqual([]);
      expect(tw.utils.transaction.txCheck(JSON.parse(JSON.stringify(tx))), name).toBe(true);
    }
  });

  it("spots JSON that says something other than the hex", () => {
    const tx = JSON.parse(JSON.stringify(NILE_TX.transfer));
    tx.raw_data.contract[0].parameter.value.amount = 1;
    expect(jsonMismatches(tx.raw_data, parseRaw(fromHex(tx.raw_data_hex)))).toEqual(["contract[0].amount"]);
    expect(tw.utils.transaction.txCheck(tx)).toBe(false);
    const t2 = JSON.parse(JSON.stringify(NILE_TX.trc20));
    t2.raw_data.contract[0].parameter.value.contract_address = BOB;
    expect(jsonMismatches(t2.raw_data, parseRaw(fromHex(t2.raw_data_hex)))).toEqual(["contract[0].contract_address"]);
  });

  it("encodes byte-for-byte what TronWeb encodes from the same JSON", () => {
    const ref = { number: 71585237n, blockId: "0000000004444dd56ee3c6be8649ac0a384d36e2fb9f1724e30d40b7d8faf835", timestamp: 1791284757000n };
    const me = addressBytes(ME)!;
    const bob = addressBytes(BOB)!;
    const usdt = addressBytes(NILE_USDT)!;
    const data = fromHex(`a9059cbb000000000000000000000000${hex(bob).slice(2)}${(1_000_000).toString(16).padStart(64, "0")}`);
    const cases = [
      { raw: encodeRaw({ ref, timestamp: 1791284760000n, expiration: 1791285357000n, name: "TransferContract", value: encodeTransfer(me, bob, 1_500_000n) }), type: "TransferContract", value: { owner_address: hex(me), to_address: hex(bob), amount: 1_500_000 } },
      { raw: encodeRaw({ ref, timestamp: 1791284760000n, expiration: 1791285357000n, feeLimit: 2_900_000n, name: "TriggerSmartContract", value: encodeTrigger(me, usdt, data) }), type: "TriggerSmartContract", value: { owner_address: hex(me), contract_address: hex(usdt), data: hex(data) } },
      { raw: encodeRaw({ ref, timestamp: 1791284760000n, expiration: 1791285357000n, memo: "hello", name: "TransferContract", value: encodeTransfer(me, bob, 1n) }), type: "TransferContract", value: { owner_address: hex(me), to_address: hex(bob), amount: 1 } },
    ];
    for (const c of cases) {
      const r = parseRaw(c.raw);
      const json = {
        visible: false,
        txID: hex(txIdOf(c.raw)),
        raw_data_hex: hex(c.raw),
        raw_data: {
          ref_block_bytes: hex(r.refBlockBytes),
          ref_block_hash: hex(r.refBlockHash),
          expiration: Number(r.expiration),
          timestamp: Number(r.timestamp),
          ...(r.feeLimit ? { fee_limit: Number(r.feeLimit) } : {}),
          ...(r.data.length ? { data: hex(r.data) } : {}),
          contract: [{ type: c.type, parameter: { type_url: `type.googleapis.com/protocol.${c.type}`, value: c.value } }],
        },
      };
      expect(tw.utils.transaction.txPbToRawDataHex(tw.utils.transaction.txJsonToPb(json)).toLowerCase()).toBe(hex(c.raw));
      expect(jsonMismatches(json.raw_data, r)).toEqual([]);
    }
  });
});

describe("decode", () => {
  it("explains a dapp's TRX transfer with the bandwidth it burns", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(signTx(NILE_TX.transfer), ctx);
    expect(d.title).toBe(`Send 1.5 TRX to ${short(BOB)}`);
    expect(d.titleMsg).toMatchObject({ id: "bg.req.sendTo", values: { amount: "1.5 TRX", to: short(BOB) } });
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "trx" }), delta: "-1500000" }]);
    // 1 + 2 (length varint) + 133 raw + 67 signature + 64 result bytes = 267 bytes × 1000 sun (no free bandwidth left)
    expect(d.fee).toEqual({ asset: expect.objectContaining({ key: "trx" }), amount: "267000" });
    expect(d.lines).toEqual(
      expect.arrayContaining([
        { label: "To", value: BOB },
        { label: "Network fee at most", value: "0.267 TRX" },
        expect.objectContaining({ label: "Sent by", value: "app.example (it gets the signed transaction)" }),
      ]),
    );
  });

  it("is free when the daily free bandwidth covers it, and says when the recipient's account must be opened", async () => {
    const free = setup({ "/wallet/getaccountresource": { freeNetLimit: 600, freeNetUsed: 0 } });
    expect((await free.m.decode(signTx(NILE_TX.transfer), free.ctx)).fee?.amount).toBe("0");

    const fresh = setup({ "/wallet/getaccount": (b: Record<string, unknown>) => (b.address === ME ? meAccount() : {}) });
    const d = await fresh.m.decode(signTx(NILE_TX.transfer), fresh.ctx);
    expect(d.fee?.amount).toBe("1100000"); // 1 TRX system fee + 0.1 TRX (no staked bandwidth); free bandwidth can't pay it
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "new-recipient", msg: expect.objectContaining({ id: "bg.tron.newAccountFee", values: { amount: "1.1 TRX" } }) }));
  });

  it("explains a TRC-20 transfer with the energy it burns", async () => {
    const { m, ctx } = setup({
      "/wallet/getaccountresource": { freeNetLimit: 600, freeNetUsed: 0, EnergyLimit: 1975, EnergyUsed: 0 },
      "/wallet/triggerconstantcontract": { result: { result: true }, energy_used: 14650, constant_result: ["0".repeat(63) + "1"] },
      "/wallet/estimateenergy": { result: { result: true }, energy_required: 21975 },
    }, NILE_TX.trc20.raw_data.ref_block_hash);
    const d = await m.decode(signTx(NILE_TX.trc20), ctx);
    expect(d.title).toBe(`Send 1 USDT to ${short(BOB)}`);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: `trc20:${NILE_USDT}`, symbol: "USDT" }), delta: "-1000000" }]);
    expect(d.fee?.amount).toBe("2000000"); // (21975 − 1975 available) × 100 sun; bandwidth is free
    expect(d.simulated).toBe(true);
    expect(d.lines).toContainEqual({ label: "Token", value: `USDT (${NILE_USDT})` });
  });

  it("warns when a contract call is expected to fail", async () => {
    const { m, ctx } = setup({
      "/wallet/triggerconstantcontract": { result: { result: false, code: "CONTRACT_EXE_ERROR", message: hex(utf8("REVERT opcode executed")) } },
      "/wallet/estimateenergy": { result: { result: false } },
    }, NILE_TX.trc20.raw_data.ref_block_hash);
    const d = await m.decode(signTx(NILE_TX.trc20), ctx);
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "simulation-failed", msg: expect.objectContaining({ id: "bg.warn.expectedToFailReason", values: { reason: "REVERT opcode executed" } }) }));
    expect(d.fee?.amount).toBe(String(30_000_000 + (1 + 2 + 211 + 67 + 64) * 1000)); // the whole fee limit + bandwidth
  });

  it("flags an unlimited approval (hex addresses, visible: false)", async () => {
    const { m, ctx } = setup({ "/wallet/triggerconstantcontract": { result: { result: true }, energy_used: 20000 } }, NILE_TX.approve.raw_data.ref_block_hash);
    const d = await m.decode(signTx(NILE_TX.approve), ctx);
    expect(d.title).toBe(`Allow ${short(BOB)} to spend unlimited USDT`);
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "unlimited-approval", msg: { id: "bg.warn.letsTakeAll" } });
    expect(d.blind).toBe(false);
  });

  it("explains staking, unstaking, lending energy, voting and permission changes in plain words", async () => {
    const run = async (tx: (typeof NILE_TX)[keyof typeof NILE_TX]) => {
      const { m, ctx } = setup({}, tx.raw_data.ref_block_hash);
      return m.decode(signTx(tx), ctx);
    };
    const freeze = await run(NILE_TX.freeze);
    expect(freeze.title).toBe("Stake 10 TRX for energy");
    expect(freeze.titleMsg?.values?.resource).toMatchObject({ id: "bg.tron.energy" });
    expect(freeze.lines).toContainEqual(expect.objectContaining({ label: "Unstaking takes", value: "14 days" }));
    expect(freeze.balanceChanges[0]?.delta).toBe("-10000000");

    expect((await run(NILE_TX.unfreeze)).title).toBe("Unstake 1 TRX");

    const lend = await run(NILE_TX.delegate);
    expect(lend.title).toBe(`Lend the energy of 5 TRX you've staked to ${short(BOB)}`);
    expect(lend.lines).toContainEqual(expect.objectContaining({ label: "Locked", value: "About 24 hours. You can't take it back before then." }));

    const vote = await run(NILE_TX.vote);
    expect(vote.title).toBe("Vote for 1 Super Representatives");
    expect(vote.lines).toEqual(expect.arrayContaining([{ label: "Validator", value: `${toBase58("41608e7e1c6f6dcc1679ea512503e41ca0254e0948")}: 3` }]));

    const perm = await run(NILE_TX.perm);
    expect(perm.title).toBe("Change who controls your TRON account");
    expect(perm.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "account-takeover" }));
    expect(perm.lines[0]).toEqual({ label: "Owner", value: `${BOB} ×1 (needs 1)` });

    const memo = await run(NILE_TX.memo);
    expect(memo.lines).toContainEqual({ label: "Memo", value: "hello" });
    expect(memo.fee?.amount).toBe(String(1_000_000 + (1 + 2 + 138 + 67 + 64) * 1000)); // the memo fee + bandwidth
  });

  it("is blind for calldata it can't read, unknown contract types and bytes that don't parse", async () => {
    const me = addressBytes(ME)!;
    const ref = { number: 71585237n, blockId: "0000000004444dd56ee3c6be8649ac0a384d36e2fb9f1724e30d40b7d8faf835", timestamp: 1791284757000n };
    const call = encodeRaw({ ref, timestamp: 1791284760000n, expiration: 1791286000000n, feeLimit: 10_000_000n, name: "TriggerSmartContract", value: encodeTrigger(me, addressBytes(NILE_USDT)!, fromHex("12345678"), 5n) });
    const { m, ctx } = setup({ "/wallet/triggerconstantcontract": { result: { result: true }, energy_used: 500 } }, "6ee3c6be8649ac0a");
    const d = await m.decode(signTx({ raw_data_hex: hex(call) }), ctx);
    expect(d.blind).toBe(true);
    expect(d.title).toBe(`Use 0x12345678 on contract ${short(NILE_USDT)}`);
    expect(d.warnings[0]).toMatchObject({ code: "blind-signing", level: "danger" });
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "trx" }), delta: "-5" }]);

    const proposal = encodeRaw({ ref, timestamp: 1791284760000n, expiration: 1791286000000n, name: "ProposalCreateContract", value: encodeTransfer(me, me, 0n) });
    expect((await m.decode(signTx({ raw_data_hex: hex(proposal) }), ctx)).blind).toBe(true);

    const garbage = await m.decode(signTx({ raw_data_hex: "0aff" }), ctx);
    expect(garbage.blind).toBe(true);
    expect(garbage.titleMsg?.id).toBe("bg.req.unreadableFrom");
  });

  it("explains a message", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(req(TRON_METHODS.signMessage, { address: ME, message: "Sign in to app.example" }), ctx);
    expect(d).toMatchObject({ title: "Sign a message for app.example", blind: false, lines: [{ label: "Message", value: "Sign in to app.example" }] });
    const bin = await m.decode(req(TRON_METHODS.signMessage, { message: "00ff", encoding: "hex" }), ctx);
    expect(bin.lines).toEqual([{ label: "Message (not text)", value: "0x00ff" }]);
  });

  it("refuses the wrong network, the wrong account, a lying txID or JSON, an expired or foreign transaction", async () => {
    const code = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        expect(e).toBeInstanceOf(ClipError);
        return (e as ClipError).code;
      }
      return "no error";
    };
    const { m, ctx } = setup();
    expect(await code(m.decode({ ...signTx(NILE_TX.transfer), networkId: TRON_MAINNET.id }, ctx))).toBe("tron/network-mismatch");
    // A transaction whose reference block isn't on this network (TAPOS) is refused too.
    const other = setup({}, "0000000000000000");
    expect(await code(other.m.decode(signTx(NILE_TX.transfer), other.ctx))).toBe("tron/network-mismatch");
    expect(await code(m.decode(signTx(NILE_TX.transfer, { address: BOB }), ctx))).toBe("tron/wrong-account");
    expect(await code(m.decode(signTx({ ...NILE_TX.transfer, txID: NILE_TX.trc20.txID }), ctx))).toBe("tron/txid-mismatch");
    const lying = JSON.parse(JSON.stringify(NILE_TX.transfer));
    lying.raw_data.contract[0].parameter.value.to_address = ME;
    expect(await code(m.decode(signTx(lying), ctx))).toBe("tron/json-mismatch");
    expect(await code(m.decode(signTx({ nope: 1 }), ctx))).toBe("tron/malformed");
    const late = setup({}, NILE_TX.transfer.raw_data.ref_block_hash, NILE_TX.transfer.raw_data.expiration + 1);
    expect(await code(late.m.decode(signTx(NILE_TX.transfer), late.ctx))).toBe("tron/expired");
    // Bob's transaction: this account isn't its owner.
    const ref = { number: 71585237n, blockId: "0000000004444dd56ee3c6be8649ac0a384d36e2fb9f1724e30d40b7d8faf835", timestamp: 1791284757000n };
    const bobs = encodeRaw({ ref, timestamp: 1n, expiration: 1791286000000n, name: "TransferContract", value: encodeTransfer(addressBytes(BOB)!, addressBytes(ME)!, 1n) });
    expect(await code(m.decode(signTx({ raw_data_hex: hex(bobs) }), ctx))).toBe("tron/not-a-signer");
    // An account whose owner permission was handed to another key (what happened to this public test account on Nile).
    const taken = setup({ "/wallet/getaccount": { ...meAccount(), owner_permission: { threshold: 1, keys: [{ address: "TBvYV4gvmB73zNhGdMW12bxxmPkpibcrRt", weight: 1 }] } } });
    const e = await taken.m.decode(signTx(NILE_TX.transfer), taken.ctx).catch((x: ClipError) => x);
    expect(e).toMatchObject({ code: "tron/not-controlled", msg: { id: "bg.tron.notControlled" } });
    expect(await code(m.decode(req("tron_signTypedData", {}), ctx))).toBe("tron/unsupported-method");
  });

  it("controls(): owner, active permissions and multi-signature thresholds", () => {
    expect(controls({}, ME, 0)).toBe(true);
    expect(controls({}, ME, 2)).toBe(false);
    expect(controls(meAccount(), ME, 0)).toBe(true);
    expect(controls(meAccount(), ME, 2)).toBe(true);
    expect(controls(meAccount(), ME, 3)).toBe(false);
    expect(controls({ address: ME, owner_permission: { threshold: 2, keys: [{ address: ME, weight: 1 }, { address: BOB, weight: 1 }] } }, ME, 0)).toBe(false);
  });
});

describe("prepare and finalize", () => {
  it("signs sha256(raw_data) and returns the transaction with an r‖s‖v signature TronWeb recovers", async () => {
    const { m, ctx, calls } = setup();
    const r = signTx(NILE_TX.transfer);
    const payloads = await m.prepare(r, ctx, "a1");
    expect(payloads).toEqual([{ accountId: "tron:0", scheme: "ecdsa-secp256k1", bytes: fromHex(NILE_TX.transfer.txID), approvalId: "a1" }]);
    const out = (await m.finalize(r, payloads.map((p) => signer.sign(p)), ctx)) as { txID: string; signature: string[]; raw_data_hex: string };
    expect(out.txID).toBe(NILE_TX.transfer.txID);
    expect(out.signature).toEqual([SIG.dappTransfer]);
    expect(out.raw_data_hex).toBe(NILE_TX.transfer.raw_data_hex);
    expect(tw.address.fromHex(tw.utils.crypto.ecRecover(out.txID, out.signature[0]!))).toBe(ME);
    expect(calls.filter((c) => c.path.includes("broadcast"))).toEqual([]);
  });

  it("signs messages like TronWeb's signMessageV2 (verifyMessageV2 recovers the account)", async () => {
    const { m, ctx } = setup();
    const r = req(TRON_METHODS.signMessage, { address: ME, message: "Sign in to app.example" });
    const [p] = await m.prepare(r, ctx, "a2");
    expect(hex(p!.bytes)).toBe(tw.utils.message.hashMessage("Sign in to app.example").replace(/^0x/, ""));
    expect(hex(messageHash(utf8("Sign in to app.example")))).toBe(hex(p!.bytes));
    const out = (await m.finalize(r, [signer.sign(p!)], ctx)) as { signature: string };
    expect(out.signature).toBe(`0x${SIG.message}`);
    expect(tw.Trx.verifyMessageV2("Sign in to app.example", out.signature)).toBe(ME);
  });

  it("refuses a bad signature before broadcasting", async () => {
    const { m, ctx, calls } = setup({ "/wallet/broadcasthex": { result: true } });
    const r = { ...signTx(NILE_TX.transfer), method: TRON_METHODS.signAndSendTransaction };
    const [p] = await m.prepare(r, ctx, "a3");
    const good = signer.sign(p!);
    const flipped = good.bytes.slice();
    flipped[10] = flipped[10]! ^ 1;
    await expect(m.finalize(r, [{ ...good, bytes: flipped }], ctx)).rejects.toMatchObject({ code: "tron/bad-signature" });
    // A real signature, but over another transaction.
    const other = fixtureSigner([SIG.dappTrc20]).sign({ ...p!, bytes: fromHex(NILE_TX.trc20.txID) });
    await expect(m.finalize(r, [other], ctx)).rejects.toMatchObject({ code: "tron/bad-signature" });
    await expect(m.finalize(r, [], ctx)).rejects.toMatchObject({ code: "tron/bad-signature" });
    expect(calls.filter((c) => c.path.includes("broadcast"))).toEqual([]);
  });

  it("fixes a wrong recovery id instead of sending a signature java-tron would reject", async () => {
    const { m, ctx } = setup();
    const r = signTx(NILE_TX.transfer);
    const [p] = await m.prepare(r, ctx, "a4");
    const s = signer.sign(p!);
    const out = (await m.finalize(r, [{ ...s, recovery: 1 - (s.recovery ?? 0) }], ctx)) as { signature: string[] };
    expect(out.signature).toEqual([SIG.dappTransfer]);
  });
});

describe("buildTransfer", () => {
  const head = { blockId: "6ee3c6be8649ac0a" };
  const build = (over: Record<string, unknown> = {}) => setup(over, head.blockId, BUILD_NOW);

  it("builds, decodes, signs, broadcasts and confirms a TRX send", async () => {
    let sent: Record<string, unknown> | undefined;
    const { m, ctx, calls } = build({
      "/wallet/broadcasthex": (b: Record<string, unknown>) => ((sent = b), { result: true, txid: "x" }),
      "/wallet/gettransactioninfobyid": (b: Record<string, unknown>) => ({ id: b.value, blockNumber: 71585240, receipt: {} }),
    });
    const r = await m.buildTransfer({ asset: TRON_NILE.nativeAsset, to: BOB, amount: "1500000" }, ctx);
    expect(r).toMatchObject({ origin: WALLET_ORIGIN, family: "tron", networkId: TRON_NILE.id, method: TRON_METHODS.signAndSendTransaction });
    expect(rawOf(r)).toBe(SIG.builtRaw);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe(`Send 1.5 TRX to ${short(BOB)}`);
    expect(d.lines.some((l) => l.label === "Sent by")).toBe(false);
    const payloads = await m.prepare(r, ctx, "b1");
    const out = (await m.finalize(r, payloads.map((p) => signer.sign(p)), ctx)) as { txID: string; result: boolean };
    const txID = hex(txIdOf(fromHex(SIG.builtRaw)));
    expect(out).toMatchObject({ txID, result: true });
    // Transaction { raw_data = 1; signature = 2 }
    expect(SIG.builtRaw.length / 2).toBe(133); // length varint 0x85 0x01
    expect(sent?.transaction).toBe(`0a8501${SIG.builtRaw}1241${SIG.builtTrx}`);
    expect(calls.some((c) => c.path === "/wallet/gettransactioninfobyid")).toBe(true);
  });

  it("refuses in plain words", async () => {
    const code = (p: Promise<unknown>) => p.then(() => "no error", (e: ClipError) => e.code);
    const { m, ctx } = build();
    const trx = TRON_NILE.nativeAsset;
    expect(await code(m.buildTransfer({ asset: trx, to: ME, amount: "1" }, ctx))).toBe("tron/self-transfer");
    expect(await code(m.buildTransfer({ asset: trx, to: "TBad", amount: "1" }, ctx))).toBe("tron/bad-address");
    expect(await code(m.buildTransfer({ asset: trx, to: BOB, amount: "0" }, ctx))).toBe("tron/bad-amount");
    expect(await code(m.buildTransfer({ asset: trx, to: BOB, amount: "57200892190" }, ctx))).toBe("tron/insufficient-funds");
    const fresh = build({ "/wallet/getaccount": {} });
    const e = await fresh.m.buildTransfer({ asset: trx, to: BOB, amount: "1" }, fresh.ctx).catch((x: ClipError) => x);
    expect(e).toMatchObject({ code: "tron/not-open", msg: { id: "bg.tron.notOpen" } });
    const toContract = build({ "/wallet/getaccount": (b: Record<string, unknown>) => (b.address === ME ? meAccount() : { address: NILE_USDT, type: "Contract" }) });
    expect(await code(toContract.m.buildTransfer({ asset: trx, to: NILE_USDT, amount: "1" }, toContract.ctx))).toBe("tron/contract-recipient");
  });

  it("says why a broadcast failed", async () => {
    const { m, ctx } = build({ "/wallet/broadcasthex": { result: false, code: "BANDWITH_ERROR", message: hex(utf8("Account resource insufficient error.")) } });
    const r = await m.buildTransfer({ asset: TRON_NILE.nativeAsset, to: BOB, amount: "1500000" }, ctx);
    const payloads = await m.prepare(r, ctx, "b2");
    const e = await m.finalize(r, payloads.map((p) => signer.sign(p)), ctx).catch((x: ClipError) => x);
    expect(e).toMatchObject({ code: "tron/send-failed", userMessage: "You need a little TRX to pay for this transaction's bandwidth. Nothing was sent." });
  });

  it("builds a TRC-20 (USDT) send with a fee limit from the energy estimate", async () => {
    const usdt = usdtAsset(TRON_NILE.id)!;
    const trigger = (b: Record<string, unknown>) =>
      String(b.data).startsWith("70a08231")
        ? { result: { result: true }, constant_result: [(5_000_000).toString(16).padStart(64, "0")] }
        : { result: { result: true }, energy_used: 14650, constant_result: ["0".repeat(63) + "1"] };
    const { m, ctx } = build({ "/wallet/triggerconstantcontract": trigger, "/wallet/estimateenergy": { result: { result: true }, energy_required: 21975 } });
    const r = await m.buildTransfer({ asset: usdt, to: BOB, amount: "1000000" }, ctx);
    const raw = parseRaw(fromHex(rawOf(r)));
    expect(raw.contracts[0]?.name).toBe("TriggerSmartContract");
    expect(raw.feeLimit).toBe(2_900_000n); // 21975 energy × 100 sun × 1.3, rounded up to 0.1 TRX
    const d = await m.decode(r, ctx);
    expect(d.title).toBe(`Send 1 USDT to ${short(BOB)}`);
    expect(d.fee?.amount).toBe(String(2_197_500 + (1 + 2 + parseRaw(fromHex(rawOf(r))).bytes.length + 67 + 64) * 1000)); // energy + bandwidth
    expect(await m.buildTransfer({ asset: usdt, to: BOB, amount: "6000000" }, ctx).then(() => "", (e: ClipError) => e.code)).toBe("tron/insufficient-token");
  });
});

describe("balances", () => {
  it("reads TRX and USDT, and staking separately", async () => {
    const { m, ctx } = setup({
      "/wallet/getaccount": {
        ...meAccount(),
        frozenV2: [{ amount: 1_000_000 }, { type: "ENERGY", amount: 2_000_000 }, { type: "TRON_POWER" }],
        unfrozenV2: [{ type: "ENERGY", unfreeze_amount: 300, unfreeze_expire_time: DAPP_NOW + 1 }, { unfreeze_amount: 40, unfreeze_expire_time: DAPP_NOW - 1 }],
      },
      "/wallet/triggerconstantcontract": (b: Record<string, unknown>) => {
        expect(b).toMatchObject({ owner_address: ME, contract_address: NILE_USDT, data: `70a08231000000000000000000000000${hex(addressBytes(ME)!).slice(2)}` });
        return { result: { result: true }, constant_result: [(25_000_000).toString(16).padStart(64, "0")] };
      },
      "/wallet/getaccountresource": { EnergyLimit: 100, EnergyUsed: 1, NetLimit: 10, NetUsed: 2, freeNetLimit: 600, freeNetUsed: 5 },
    });
    const b = await m.getBalances(ctx);
    expect(b.map((x) => [x.asset.key, x.amount])).toEqual([
      ["trx", "57200892190"],
      [`trc20:${NILE_USDT}`, "25000000"],
    ]);
    expect(await m.staking(ctx)).toEqual({
      staked: "3000000",
      unstaking: "300",
      withdrawable: "40",
      energy: { used: "1", limit: "100" },
      bandwidth: { used: "2", limit: "10", freeUsed: "5", freeLimit: "600" },
    });
    expect(await m.getNfts(ctx)).toEqual([]);
    const empty = setup({ "/wallet/getaccount": {}, "/wallet/triggerconstantcontract": { result: { result: true }, constant_result: ["0".repeat(64)] } });
    expect((await empty.m.getBalances(empty.ctx)).map((x) => x.amount)).toEqual(["0", "0"]);
  });

  it("uses the next endpoint when one is down, and says so in plain words when none answers", async () => {
    const ctx = ctxFor((async (u: string) => (String(u).startsWith("https://nile.trongrid.io") ? new Response("busy", { status: 503 }) : new Response(JSON.stringify(meAccount())))) as typeof fetch);
    const m = createTronModule();
    expect((await m.getBalances({ ...ctx, network: { ...TRON_SHASTA, rpcUrls: ["https://nile.trongrid.io", "https://api.nileex.io"] } }))[0]?.amount).toBe("57200892190");
    const down = ctxFor((async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    await expect(m.getBalances(down)).rejects.toMatchObject({ code: "tron/offline" });
  });
});

