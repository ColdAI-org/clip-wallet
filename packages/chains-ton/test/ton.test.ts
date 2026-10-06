import "../src/buffer.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Address, Cell, beginCell, loadMessage } from "@ton/core";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import { describe, expect, it } from "vitest";
import {
  TON_MAINNET,
  TON_NETWORKS,
  TON_TESTNET,
  commentCell,
  createTonModule,
  dnsWire,
  fromChainId,
  jettonTransferBody,
  nftTransferBody,
  parseBody,
  signDataHash,
  tonConnectNetwork,
  tonProofHash,
  walletFor,
} from "../src/index.js";
import { signingHash } from "../src/wallet.js";

const TON_TESTNET_GLOBAL_ID = -3;
import { b64decode, crc32, fromHex } from "../src/util.js";
import { BOB, JETTON_MASTER, MY_JETTON_WALLET, NFT_ITEM, NOW, addr, ctxFor, fixtureSigner, makeAccount, mockTon, raw, req } from "./helpers.js";
import { scenarios } from "./scenarios.js";
import { FIX } from "./signatures.js";

const PUB = FIX.publicKey;
const signer = fixtureSigner(PUB, FIX.sigs);
const mod = (o: Parameters<typeof createTonModule>[0] = {}) => createTonModule({ now: () => NOW, minIntervalMs: 0, ...o });
const ME = mod().walletAddress(fromHex(PUB), TON_TESTNET);
const meAddr = () => Address.parse(ME.raw);
const S = scenarios(ME.raw);
const active = (seqno = 5, balance = 10n ** 10n) => ({ status: "active" as const, seqno, balance });
const ctx = (state: Parameters<typeof mockTon>[1], over: Parameters<typeof mockTon>[2] = []) => {
  const m = mockTon(meAddr, state, over);
  return { ...m, ctx: ctxFor(makeAccount(PUB, ME.friendly), m.fetch) };
};

describe("networks", () => {
  it("maps ton:, tvm: and TON Connect network ids", () => {
    expect(TON_TESTNET.id).toBe("ton:-3");
    expect(TON_MAINNET.id).toBe("ton:-239");
    expect(fromChainId("-239")).toBe("ton:-239");
    expect(fromChainId("tvm:-3")).toBe("ton:-3");
    expect(fromChainId("ton:1")).toBeNull();
    expect(tonConnectNetwork(TON_TESTNET.id)).toBe("-3");
    expect(TON_TESTNET.nativeAsset).toMatchObject({ key: "gram", symbol: "GRAM", decimals: 9 });
    expect(TON_NETWORKS.filter((n) => n.testnet)).toEqual([TON_TESTNET]);
  });
});

describe("addresses", () => {
  it("computes the v5r1 wallet per network (different wallet id → different address)", () => {
    const m = mod();
    const pk = Buffer.from(fromHex(PUB));
    const w3 = WalletContractV5R1.create({ walletId: { networkGlobalId: -3, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } }, publicKey: pk });
    const w239 = WalletContractV5R1.create({ walletId: { networkGlobalId: -239, context: { walletVersion: "v5r1", workchain: 0, subwalletNumber: 0 } }, publicKey: pk });
    expect(m.addressFromPublicKey(fromHex(PUB), TON_TESTNET)).toBe(w3.address.toString({ urlSafe: true, bounceable: false, testOnly: true }));
    expect(m.addressFromPublicKey(fromHex(PUB), TON_MAINNET)).toBe(w239.address.toString({ urlSafe: true, bounceable: false, testOnly: false }));
    expect(m.addressFromPublicKey(fromHex(PUB), TON_TESTNET)).toMatch(/^0Q/);
    expect(m.addressFromPublicKey(fromHex(PUB), TON_MAINNET)).toMatch(/^UQ/);
    expect(m.derivationPath(2)).toBe("m/44'/607'/2'");
  });

  it("matches a real testnet v5r1 wallet (public key read with get_public_key on testnet)", () => {
    const pk = fromHex("0fa6a21a09873e58b99ee8d9a77662822140875fa77904768c59673a8804bc47");
    expect(mod().walletAddress(pk, TON_TESTNET).raw).toBe("0:fa6bebb28e2017f20466b4f8b6ced75e044962c3a1ab05ae9d40178cf309507c");
  });

  it("v4r2 is a module option: the standard wallet on mainnet, a network-bound one elsewhere (audit CHAIN-L)", async () => {
    const m = mod({ walletVersion: "v4r2" });
    const standard = WalletContractV4.create({ workchain: 0, publicKey: Buffer.from(fromHex(PUB)) });
    expect(m.walletAddress(fromHex(PUB), TON_MAINNET).raw).toBe(standard.address.toRawString());
    expect(m.features[0]).toMatchObject({ name: "SendTransaction", maxMessages: 4 });
    // The v4r2 wallet id is in every signed message. With the same id on both networks, a testnet transfer could be
    // replayed on mainnet by anyone who saw it. Off mainnet the id is bound to the network, so the wallet differs.
    const testnet = walletFor(fromHex(PUB), TON_TESTNET_GLOBAL_ID, "v4r2") as WalletContractV4;
    const mainnet = walletFor(fromHex(PUB), -239, "v4r2") as WalletContractV4;
    expect(testnet.walletId).not.toBe(mainnet.walletId);
    expect(m.walletAddress(fromHex(PUB), TON_TESTNET).raw).not.toBe(standard.address.toRawString());
    const plan = { seqno: 0, timeout: 1_900_000_000, messages: [], deploy: false };
    expect(Buffer.from(await signingHash(testnet, plan)).toString("hex")).not.toBe(Buffer.from(await signingHash(mainnet, plan)).toString("hex"));
  });

  it("validates addresses and narrows test-only ones to testnets", () => {
    const m = mod();
    expect(m.isAddress(ME.friendly)).toBe(true);
    expect(m.isAddress(ME.raw)).toBe(true);
    expect(m.isAddress("EQ-not-an-address")).toBe(false);
    expect(m.networksForAddress(ME.friendly, TON_NETWORKS)).toEqual([TON_TESTNET]);
    const mainnetForm = Address.parse(ME.raw).toString({ bounceable: false });
    expect(m.networksForAddress(mainnetForm, TON_NETWORKS)).toEqual(TON_NETWORKS);
  });

  it("builds the TON Connect ton_addr item with the wallet's StateInit", () => {
    const item = mod().tonAddrItem(fromHex(PUB), TON_TESTNET);
    expect(item).toMatchObject({ name: "ton_addr", address: ME.raw, network: "-3", publicKey: PUB });
    const si = Cell.fromBase64(item.walletStateInit);
    expect(si.hash().equals(Address.parse(ME.raw).hash)).toBe(true); // TON Connect proof check: hash(stateInit) == address
  });
});

describe("payload codecs", () => {
  it("round-trips comments, jetton and NFT transfers", () => {
    expect(parseBody(commentCell("hi"))).toEqual({ kind: "comment", text: "hi" });
    expect(parseBody(null)).toEqual({ kind: "empty" });
    const j = parseBody(jettonTransferBody({ amount: 5n, destination: Address.parse(BOB), responseDestination: meAddr(), forwardTon: 1n, forwardPayload: commentCell("memo") }));
    expect(j).toMatchObject({ kind: "jetton-transfer", amount: 5n, forwardTon: 1n, forwardComment: "memo" });
    const n = parseBody(nftTransferBody({ newOwner: Address.parse(BOB), responseDestination: meAddr(), forwardTon: 0n }));
    expect(n).toMatchObject({ kind: "nft-transfer", forwardTon: 0n });
    expect(parseBody(beginCell().storeUint(0xdeadbeef, 32).endCell())).toEqual({ kind: "unknown", op: 0xdeadbeef });
  });

  it("CRC-32 and TEP-81 DNS wire form", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(dnsWire("App.Example")).toBe("example\0app\0");
  });

  it("signData text hash follows the spec byte layout (big-endian)", () => {
    const a = meAddr();
    const enc = new TextEncoder();
    const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const domain = enc.encode("app.example");
    const text = enc.encode("hello");
    const msg = new Uint8Array([
      0xff, 0xff, ...enc.encode("ton-connect/sign-data/"), 0, 0, 0, 0, ...a.hash, ...u32(domain.length), ...domain,
      0, 0, 0, 0, ...u32(NOW), ...enc.encode("txt"), ...u32(text.length), ...text,
    ]);
    expect(signDataHash({ type: "text", text: "hello" }, a, "app.example", NOW)).toEqual(sha256(msg));
  });

  it("ton_proof hash uses little-endian length and timestamp", () => {
    const a = meAddr();
    const enc = new TextEncoder();
    const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    const msg = new Uint8Array([...enc.encode("ton-proof-item-v2/"), 0, 0, 0, 0, ...a.hash, ...le32(11), ...enc.encode("app.example"), ...le32(NOW), 0, 0, 0, 0, ...enc.encode("p")]);
    const expected = sha256(new Uint8Array([0xff, 0xff, ...enc.encode("ton-connect"), ...sha256(msg)]));
    expect(tonProofHash(a, "app.example", NOW, "p")).toEqual(expected);
  });
});

describe("balances and NFTs", () => {
  it("lists GRAM and held jettons; look-alikes are spam", async () => {
    const { ctx: c } = ctx(active(5, 123n));
    const b = await mod().getBalances(c);
    expect(b[0]).toEqual({ asset: TON_TESTNET.nativeAsset, amount: "123" });
    expect(b[1]).toMatchObject({ amount: "5000000", asset: { key: `ton:${JETTON_MASTER}`, symbol: "TUSD", decimals: 6, address: JETTON_MASTER } });
    expect(b.find((x) => x.asset.symbol === "ZERO")).toBeUndefined();
    expect(b.find((x) => x.asset.symbol === "USDT")!.asset.spam).toBe(true);
  });

  it("lists TEP-62 NFTs with untrusted media", async () => {
    const { ctx: c } = ctx(active());
    const n = await mod().getNfts(c);
    expect(n).toEqual([
      {
        networkId: "ton:-3",
        standard: "tep62",
        collection: { address: raw(0x34), name: "Boards" },
        tokenId: NFT_ITEM,
        name: "Board #1",
        mediaUrl: "https://cache.example/1.webp",
        attributes: [{ trait: "Color", value: "red" }],
      },
    ]);
  });
});

describe("decode sendTransaction", () => {
  it("describes GRAM transfers with comments, emulates and shows the fee", async () => {
    const emulation = {
      actions: [
        { type: "TonTransfer", TonTransfer: { sender: { address: ME.raw }, recipient: { address: Address.parse(BOB).toRawString() }, amount: 1500000000 } },
        { type: "TonTransfer", TonTransfer: { sender: { address: ME.raw }, recipient: { address: raw(0xc0) }, amount: 200000000 } },
      ],
      extra: -1234567,
    };
    const { ctx: c, calls } = ctx({ ...active(), emulation });
    const d = await mod().decode(S.send, c);
    expect(d.title).toBe("Approve 2 transfers for app.example");
    expect(d.lines[0]).toEqual({ label: "Transfer 1", value: `Send 1.5 GRAM to ${BOB.slice(0, 4)}…${BOB.slice(-4)}` });
    expect(d.lines).toContainEqual({ label: "Comment", value: "thanks!" });
    expect(d.lines).toContainEqual({ label: "Network fee", value: "≈ 0.001234567 GRAM" });
    expect(d.simulated).toBe(true);
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([{ asset: TON_TESTNET.nativeAsset, delta: "-1700000000" }]);
    expect(d.fee).toEqual({ asset: TON_TESTNET.nativeAsset, amount: "1234567" });
    expect(calls.some((x) => /\/v2\/accounts\/0:[0-9a-f]+\/events\/emulate\?ignore_signature_check=true/.test(x.url))).toBe(true);
  });

  it("without emulation: warns that there's no preview and uses toncenter's fee estimate", async () => {
    const { ctx: c } = ctx({ ...active(), emulateFails: true });
    const d = await mod().decode(S.send, c);
    expect(d.simulated).toBe(false);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "simulation-failed" }));
    expect(d.fee!.amount).toBe(String(66667 + 10 + 300000 + 100000));
    expect(d.balanceChanges).toEqual([{ asset: TON_TESTNET.nativeAsset, delta: "-1700000000" }]);
  });

  it("decodes structured jetton and NFT items", async () => {
    const { ctx: c } = ctx(active(6));
    const d = await mod({ emulate: false }).decode(S.items, c);
    expect(d.lines[0]!.value).toBe(`Send 2.5 TUSD to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(d.lines[1]!.value).toBe(`Send Board #1 to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(d.lines).toContainEqual({ label: "Covers token fees", value: "0.050000001 GRAM (unused part comes back)" });
    expect(d.balanceChanges).toContainEqual({ asset: expect.objectContaining({ symbol: "TUSD" }), delta: "-2500000" });
    expect(d.blind).toBe(false);
  });

  it("audit TON-01: says where leftover fee GRAM goes when an app sends it somewhere else", async () => {
    const body = jettonTransferBody({ amount: 1n, destination: Address.parse(BOB), responseDestination: Address.parse(BOB), forwardTon: 0n });
    const r = req("sendTransaction", { network: "-3", messages: [{ address: Address.parse(MY_JETTON_WALLET).toString({ testOnly: true }), amount: "50000000000", payload: body.toBoc().toString("base64") }] });
    const { ctx: c } = ctx(active());
    const d = await mod({ emulate: false }).decode(r, c);
    expect(d.lines.find((l) => l.label === "Covers token fees")!.value).toMatch(/unused part goes to/);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "unknown-call" }));
  });

  it("flags a jetton transfer through someone else's jetton wallet as blind danger", async () => {
    const body = jettonTransferBody({ amount: 1n, destination: Address.parse(BOB), responseDestination: meAddr(), forwardTon: 0n });
    const r = req("sendTransaction", { network: "-3", messages: [{ address: Address.parse(MY_JETTON_WALLET).toString({ testOnly: true }), amount: "50000000", payload: body.toBoc().toString("base64") }] });
    const { ctx: c } = ctx({ ...active(), jettonOwner: Address.parse(BOB) });
    const d = await mod({ emulate: false }).decode(r, c);
    expect(d.blind).toBe(true);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "blind-signing", message: "This token transfer goes through a token wallet that isn't yours." }));
  });

  it("marks unknown contract calls blind", async () => {
    const r = req("sendTransaction", { network: "-3", messages: [{ address: addr(0xc1, true), amount: "1", payload: beginCell().storeUint(0xabcdef01, 32).endCell().toBoc().toString("base64") }] });
    const { ctx: c } = ctx(active());
    const d = await mod({ emulate: false }).decode(r, c);
    expect(d.blind).toBe(true);
    expect(d.lines).toContainEqual({ label: "Data", value: "Operation 0xabcdef01" });
  });

  it("says plainly that a new wallet gets activated, and when funds are short", async () => {
    const { ctx: c } = ctx({ status: "uninit", seqno: 0, balance: 1n });
    const d = await mod({ emulate: false }).decode(S.firstUse, c);
    expect(d.lines).toContainEqual({ label: "Wallet", value: "Not active yet. This first transfer also activates it." });
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "high-fee" }));
  });

  it("refuses wrong network, wrong sender, expiry, raw addresses and malformed requests", async () => {
    const { ctx: c } = ctx(active());
    const m = mod({ emulate: false });
    const send = (p: object) => m.decode(req("sendTransaction", p), c);
    const msg = [{ address: BOB, amount: "1" }];
    await expect(send({ network: "-239", messages: msg })).rejects.toMatchObject({ code: "ton/network-mismatch" });
    await expect(send({ from: raw(0x99), messages: msg })).rejects.toMatchObject({ code: "ton/wrong-account" });
    await expect(send({ valid_until: NOW - 1, messages: msg })).rejects.toMatchObject({ code: "ton/expired" });
    await expect(send({ messages: [{ address: raw(0xb0), amount: "1" }] })).rejects.toMatchObject({ code: "ton/raw-address" });
    await expect(send({ messages: msg, items: [] })).rejects.toMatchObject({ code: "ton/bad-params" });
    await expect(send({ messages: [{ address: BOB, amount: "-1" }] })).rejects.toMatchObject({ code: "ton/bad-params" });
    await expect(send({ messages: Array.from({ length: 256 }, () => msg[0]) })).rejects.toMatchObject({ code: "ton/too-many-messages" });
    await expect(m.decode(req("signMessage", { messages: msg }), c)).rejects.toMatchObject({ code: "ton/unsupported-method" });
  });

  it("warns about a test-only address on mainnet", async () => {
    const mainnet = mockTon(() => Address.parse(mod().walletAddress(fromHex(PUB), TON_MAINNET).raw), active());
    const c = ctxFor(makeAccount(PUB), mainnet.fetch, TON_MAINNET);
    const r = { ...req("sendTransaction", { network: "-239", messages: [{ address: BOB, amount: "1" }] }), networkId: TON_MAINNET.id };
    const d = await mod({ emulate: false }).decode(r, c);
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "network-matters" }));
  });
});

describe("prepare / finalize sendTransaction", () => {
  const extOf = (boc: string) => loadMessage(Cell.fromBase64(boc).beginParse());

  it("signs the v5r1 signing-message hash and broadcasts the external message", async () => {
    const m = mod();
    const { ctx: c, calls } = ctx(active());
    const p = await m.prepare(S.send, c, "ap");
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ scheme: "ed25519", approvalId: "ap", accountId: "ton:0" });
    expect(p[0]!.bytes.length).toBe(32);
    const boc = (await m.finalize(S.send, p.map((x) => signer.sign(x)), c)) as string;
    const sent = calls.find((x) => x.url.endsWith("/v2/sendBocReturnHash"))!;
    expect(sent.body).toEqual({ boc });
    const ext = extOf(boc);
    expect(ext.info.type).toBe("external-in");
    expect(ext.init).toBeFalsy();
    // v5r1 puts the 512-bit signature at the end of the body
    const bits = ext.body.bits;
    const sig = new Uint8Array(64);
    for (let i = 0; i < 512; i++) if (bits.at(bits.length - 512 + i)) sig[i >> 3]! |= 0x80 >> (i & 7);
    expect(ed25519.verify(sig, p[0]!.bytes, fromHex(PUB))).toBe(true);
  });

  it("first use attaches the wallet's StateInit (seqno 0)", async () => {
    const m = mod();
    const { ctx: c } = ctx({ status: "uninit", seqno: 0, balance: 10n ** 10n });
    const p = await m.prepare(S.firstUse, c, "ap");
    const boc = (await m.finalize(S.firstUse, p.map((x) => signer.sign(x)), c)) as string;
    expect(extOf(boc).init).toBeTruthy();
  });

  it("structured items become real jetton / NFT messages to the right contracts", async () => {
    const m = mod();
    const { ctx: c } = ctx(active(6));
    const p = await m.prepare(S.items, c, "ap");
    const boc = (await m.finalize(S.items, p.map((x) => signer.sign(x)), c)) as string;
    expect(typeof boc).toBe("string");
  });

  it("refuses bad or missing signatures and unprepared requests; nothing is sent", async () => {
    const m = mod();
    const { ctx: c, calls } = ctx(active());
    await expect(m.finalize(S.send, [], c)).rejects.toMatchObject({ code: "ton/not-prepared" });
    const p = await m.prepare(S.send, c, "ap");
    const good = signer.sign(p[0]!);
    await expect(m.finalize(S.send, [{ ...good, bytes: good.bytes.slice().fill(0, 0, 1) }], c)).rejects.toMatchObject({ code: "ton/bad-signature" });
    await expect(m.finalize(S.send, [good, good], c)).rejects.toMatchObject({ code: "ton/bad-signature" });
    expect(calls.some((x) => x.url.includes("sendBoc"))).toBe(false);
  });

  it("explains a rejected broadcast in plain words", async () => {
    const m = mod();
    const { ctx: c } = ctx(active(), [[/sendBocReturnHash/, () => { throw new Error("x"); }]]);
    const p = await m.prepare(S.send, c, "ap");
    await expect(m.finalize(S.send, p.map((x) => signer.sign(x)), c)).rejects.toMatchObject({ code: "ton/send-failed" });
  });
});

describe("signData and ton_proof", () => {
  it("text: shown verbatim, signed per spec, answered with signature/address/timestamp/domain/payload", async () => {
    const m = mod();
    const { ctx: c } = ctx(active());
    const d = await m.decode(S.signText, c);
    expect(d).toMatchObject({ title: "Sign a message for app.example", blind: false, lines: [{ label: "Message", value: "Sign in to app.example" }] });
    const p = await m.prepare(S.signText, c, "ap");
    expect(p[0]!.bytes).toEqual(signDataHash({ type: "text", text: "Sign in to app.example" }, meAddr(), "app.example", NOW));
    const out = (await m.finalize(S.signText, p.map((x) => signer.sign(x)), c)) as Record<string, unknown>;
    expect(out).toMatchObject({ address: ME.raw, timestamp: NOW, domain: "app.example", payload: { type: "text", text: "Sign in to app.example" } });
    expect(ed25519.verify(b64decode(out.signature as string), p[0]!.bytes, fromHex(PUB))).toBe(true);
  });

  it("binary and cell: blind with a warning, still signable", async () => {
    const m = mod();
    const { ctx: c } = ctx(active());
    for (const r of [S.signBinary, S.signCell]) {
      const d = await m.decode(r, c);
      expect(d.blind).toBe(true);
      expect(d.warnings[0]).toMatchObject({ level: "danger", code: "blind-signing" });
      const p = await m.prepare(r, c, "ap");
      await expect(m.finalize(r, p.map((x) => signer.sign(x)), c)).resolves.toMatchObject({ address: ME.raw });
    }
    expect((await m.decode(S.signBinary, c)).lines).toEqual([{ label: "Data (not text)", value: "0x010203" }]);
  });

  it("refuses signData for another network or account", async () => {
    const { ctx: c } = ctx(active());
    await expect(mod().decode(req("signData", { type: "text", text: "x", network: "-239" }), c)).rejects.toMatchObject({ code: "ton/network-mismatch" });
    await expect(mod().decode(req("signData", { type: "text", text: "x", from: raw(0x99) }), c)).rejects.toMatchObject({ code: "ton/wrong-account" });
    await expect(mod().decode(req("signData", { type: "nope" }), c)).rejects.toMatchObject({ code: "ton/bad-params" });
  });

  it("ton_proof: binds the requesting site's domain and returns the TON Connect reply", async () => {
    const m = mod();
    const { ctx: c } = ctx(active());
    expect((await m.decode(S.proof, c)).title).toBe("Prove to app.example that this wallet is yours");
    const p = await m.prepare(S.proof, c, "ap");
    expect(p[0]!.bytes).toEqual(tonProofHash(meAddr(), "app.example", NOW, "nonce-123"));
    const out = (await m.finalize(S.proof, p.map((x) => signer.sign(x)), c)) as { name: string; proof: Record<string, unknown> };
    expect(out).toMatchObject({ name: "ton_proof", proof: { timestamp: NOW, domain: { lengthBytes: 11, value: "app.example" }, payload: "nonce-123" } });
  });
});

describe("buildTransfer", () => {
  it("GRAM to a raw address of an inactive wallet goes non-bounceable", async () => {
    const { ctx: c } = ctx(active());
    const r = await mod().buildTransfer({ asset: TON_TESTNET.nativeAsset, to: raw(0xb1), amount: "1000" }, c);
    expect(r).toMatchObject({ family: "ton", method: "sendTransaction", networkId: "ton:-3", origin: "clip-wallet" });
    const p = r.params as { network: string; from: string; messages: { address: string; amount: string }[] };
    expect(p.network).toBe("-3");
    expect(p.from).toBe(ME.raw);
    expect(Address.parseFriendly(p.messages[0]!.address).isBounceable).toBe(false);
    expect(p.messages[0]!.amount).toBe("1000");
  });

  it("keeps the bounce flag of a friendly address", async () => {
    const { ctx: c } = ctx(active());
    const r = await mod().buildTransfer({ asset: TON_TESTNET.nativeAsset, to: addr(0xb2, true), amount: "1" }, c);
    expect(Address.parseFriendly((r.params as { messages: { address: string }[] }).messages[0]!.address).isBounceable).toBe(true);
  });

  it("jettons become a structured item with a 1-nanogram forward", async () => {
    const { ctx: c } = ctx(active());
    const asset = { key: "x", symbol: "TUSD", name: "Test Dollar", decimals: 6, networkId: TON_TESTNET.id, address: JETTON_MASTER };
    const r = await mod().buildTransfer({ asset, to: BOB, amount: "1000000" }, c);
    expect((r.params as { items: unknown[] }).items).toEqual([{ type: "jetton", master: JETTON_MASTER, destination: Address.parse(BOB).toRawString(), amount: "1000000", forwardAmount: "1" }]);
    await expect(mod().buildTransfer({ asset, to: BOB, amount: "9000000" }, c)).rejects.toMatchObject({ code: "ton/insufficient-token" });
  });

  it("refuses bad input in plain words", async () => {
    const { ctx: c } = ctx(active(5, 10n));
    const a = TON_TESTNET.nativeAsset;
    await expect(mod().buildTransfer({ asset: a, to: "nope", amount: "1" }, c)).rejects.toMatchObject({ code: "ton/bad-address" });
    await expect(mod().buildTransfer({ asset: a, to: ME.friendly, amount: "1" }, c)).rejects.toMatchObject({ code: "ton/self-transfer" });
    await expect(mod().buildTransfer({ asset: a, to: BOB, amount: "0" }, c)).rejects.toMatchObject({ code: "ton/bad-amount" });
    await expect(mod().buildTransfer({ asset: a, to: BOB, amount: "11" }, c)).rejects.toMatchObject({ code: "ton/insufficient", userMessage: "You don't have enough GRAM." });
  });
});
