import { describe, expect, it } from "vitest";
import { ClipError, type DappRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import { Address, Message, MessageComputer, Transaction, TransactionComputer, UserPublicKey } from "@multiversx/sdk-core";
import {
  MULTIVERSX_DEVNET,
  MULTIVERSX_MAINNET,
  MULTIVERSX_METHODS,
  MULTIVERSX_NETWORKS,
  MULTIVERSX_TESTNET,
  type PlainTransaction,
  bytesToSign,
  createMultiversXModule,
  esdtAsset,
  messageHash,
  parseCall,
  parseTransaction,
  plainMultiversXError,
  serializeForSigning,
} from "../src/index.js";
import { b64encode, encodeAddress, fromHex, hex, utf8 } from "../src/util.js";
import { API, GATEWAY, baseRoutes, ctxFor, gw, makeAccount, mockFetch, reply, signer } from "./helpers.js";
import { FIX } from "./signatures.js";

const module = createMultiversXModule({ confirmPollMs: 0, confirmAttempts: 3, sleep: async () => {} });
const PROVIDER = "erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqq80llllsrepk69";
const CONTRACT = "erd1qqqqqqqqqqqqqpgqd77fnev2sthnczp2lnfx0y5jdycynjfhzzgq6p3rax";

function tx(over: Partial<PlainTransaction> = {}): PlainTransaction {
  return { nonce: 7, value: "0", receiver: FIX.bob, sender: FIX.me, gasPrice: 1000000000, gasLimit: 500000, chainID: "D", version: 2, ...over };
}
const data = (s: string) => b64encode(utf8(s));
const hexOf = (s: string) => hex(utf8(s));

function req(method: string, params: unknown, over: Partial<DappRequest> = {}): DappRequest {
  return { id: "r1", origin: "https://app.example", via: "walletconnect", family: "multiversx", networkId: "mvx:D", method, params, ...over };
}
const one = (t: PlainTransaction) => req(MULTIVERSX_METHODS.signTransaction, { transaction: t });

describe("networks and addresses", () => {
  it("devnet, testnet and mainnet use the mvx namespace with the chain's own chain ID", () => {
    expect(MULTIVERSX_NETWORKS.map((n) => n.id)).toEqual(["mvx:D", "mvx:T", "mvx:1"]);
    expect(MULTIVERSX_DEVNET.testnet && MULTIVERSX_TESTNET.testnet && !MULTIVERSX_MAINNET.testnet).toBe(true);
    expect(MULTIVERSX_MAINNET.rpcUrls[0]).toBe("https://gateway.multiversx.com");
    expect(MULTIVERSX_MAINNET.nativeAsset).toMatchObject({ key: "egld", symbol: "EGLD", decimals: 18 });
  });

  it("derives the abandon-about address like sdk-core, and checks bech32 checksums", () => {
    expect(module.derivationPath(0)).toBe("m/44'/508'/0'/0'/0'");
    expect(module.derivationPath(3)).toBe("m/44'/508'/0'/0'/3'");
    expect(module.curve).toBe("ed25519");
    const addr = module.addressFromPublicKey(fromHex(FIX.publicKey), MULTIVERSX_DEVNET);
    expect(addr).toBe(FIX.me);
    expect(new Address(fromHex(FIX.publicKey)).toBech32()).toBe(FIX.me);
    expect(module.isAddress(FIX.me)).toBe(true);
    expect(module.isAddress(FIX.me.slice(0, -1) + (FIX.me.endsWith("g") ? "h" : "g"))).toBe(false);
    expect(module.isAddress("cosmos1sqhjrtmsn5yjk6w85099p8v0ly0g8z9pxeqe5dvu5rlf2n7vq3vq")).toBe(false);
    expect(module.networksForAddress(FIX.me, MULTIVERSX_NETWORKS)).toHaveLength(3);
  });

  it("USDC is the known ESDT (bridged, own key); look-alikes and unregistered tokens are spam", () => {
    expect(esdtAsset("mvx:1", { identifier: "USDC-c76f1f", decimals: 6 })).toMatchObject({ key: "usdc.mvx", symbol: "USDC", bridged: true, decimals: 6 });
    expect(esdtAsset("mvx:D", { identifier: "USDC-350c4e", decimals: 6 })).toMatchObject({ key: "usdc.mvx", bridged: true });
    expect(esdtAsset("mvx:1", { identifier: "USDC-350c4e", ticker: "USDC", decimals: 6, assets: { status: "active" } }).spam).toBe(true);
    expect(esdtAsset("mvx:1", { identifier: "WEGLD-bd4d79", ticker: "WEGLD", decimals: 18, assets: { status: "active" } }).key).toBe("esdt:WEGLD-bd4d79");
    expect(esdtAsset("mvx:1", { identifier: "WEGLD-bd4d79", ticker: "WEGLD", decimals: 18, assets: { status: "active" } }).spam).toBeUndefined();
    expect(esdtAsset("mvx:1", { identifier: "FREE-123456", ticker: "FREE", decimals: 18 }).spam).toBe(true);
  });
});

describe("serialization (cross-checked with @multiversx/sdk-core)", () => {
  const computer = new TransactionComputer();
  const cases: [string, PlainTransaction][] = [
    ["EGLD transfer", tx({ value: "1500000000000000000", gasLimit: 50000 })],
    ["ESDT transfer", tx({ data: data(`ESDTTransfer@${hexOf("USDC-350c4e")}@2625a0`), gasLimit: 413000 })],
    ["usernames, guardian, relayer, hash signing", tx({ senderUsername: data("alice"), receiverUsername: data("bob"), options: 3, guardian: CONTRACT, relayer: PROVIDER, data: data("hello") })],
    ["version 1, note", tx({ version: 1, data: data("for the coffee ☕") })],
  ];
  for (const [name, plain] of cases) {
    it(name, () => {
      const t = parseTransaction(plain);
      const sdk = Transaction.newFromPlainObject(plain as never);
      expect(hex(serializeForSigning(t))).toBe(hex(computer.computeBytesForSigning(sdk)));
      expect(hex(bytesToSign(t))).toBe(hex(computer.computeBytesForVerifying(sdk)));
    });
  }

  it("the wallet's own transfers serialize exactly as sdk-core would", async () => {
    const f = mockFetch(baseRoutes());
    const r = await module.buildTransfer({ asset: MULTIVERSX_DEVNET.nativeAsset, to: FIX.bob, amount: "1500000000000000000" }, ctxFor(f.fetch));
    const plain = (r.params as { transactions: PlainTransaction[] }).transactions[0]!;
    const [p] = await module.prepare(r, ctxFor(f.fetch), "ap");
    expect(hex(p!.bytes)).toBe(hex(computer.computeBytesForSigning(Transaction.newFromPlainObject(plain as never))));
  });

  it("message hash matches MessageComputer, and the fixture signature verifies with sdk-core", async () => {
    const m = new Message({ data: utf8(FIX.message) });
    expect(hex(messageHash(utf8(FIX.message)))).toBe(hex(new MessageComputer().computeBytesForSigning(m)));
    expect(await new UserPublicKey(fromHex(FIX.publicKey)).verify(messageHash(utf8(FIX.message)), fromHex(FIX.messageSig))).toBe(true);
  });

  it("refuses malformed fields", () => {
    expect(() => parseTransaction(tx({ value: "-1" }))).toThrow(ClipError);
    expect(() => parseTransaction(tx({ receiver: "erd1nope" }))).toThrow(ClipError);
    expect(() => parseTransaction(tx({ version: 1, options: 1 }))).toThrow(ClipError);
    expect(() => parseTransaction(tx({ data: "not base64!" }))).toThrow(ClipError);
    expect(parseCall(utf8("ESDTTransfer@0a@zz"))).toBeNull();
    expect(parseCall(utf8("delegate"))).toEqual({ fn: "delegate", args: [] });
  });
});

describe("decode", () => {
  const f = mockFetch(baseRoutes());
  const ctx = ctxFor(f.fetch);

  it("an EGLD transfer", async () => {
    const d = await module.decode(one(tx({ value: "1500000000000000000", gasLimit: 50000 })), ctx);
    expect(d.title).toBe(`Send 1.5 EGLD to ${FIX.bob.slice(0, 7)}…${FIX.bob.slice(-4)}`);
    expect(d.titleMsg?.id).toBe("bg.req.sendTo");
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([{ asset: MULTIVERSX_DEVNET.nativeAsset, delta: "-1500000000000000000" }]);
    expect(d.fee).toMatchObject({ amount: "50000000000000" });
    expect(d.lines).toContainEqual({ label: "Network fee", value: "up to 0.00005 EGLD" });
    expect(d.lines).toContainEqual({ label: "Sent by", value: "app.example (it gets the signed transaction)" });
  });

  it("an ESDTTransfer of USDC", async () => {
    const d = await module.decode(one(tx({ data: data(`ESDTTransfer@${hexOf("USDC-350c4e")}@2625a0`), gasLimit: 413000 })), ctx);
    expect(d.title).toMatch(/^Send 2\.5 USDC to erd1sxm/);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc.mvx", address: "USDC-350c4e" }), delta: "-2500000" }]);
    // fee: 113,000 gas to move the data at full price + 300,000 × 1% (gas price modifier)
    expect(d.fee?.amount).toBe(String(113000n * 1000000000n + 300000n * 10000000n));
  });

  it("a look-alike USDC is flagged", async () => {
    const d = await module.decode(one(tx({ data: data(`ESDTTransfer@${hexOf("USDC-fa4e01")}@2625a0`) })), ctx);
    expect(d.warnings.some((w) => w.code === "known-scam" && w.level === "danger")).toBe(true);
  });

  it("a MultiESDTNFTTransfer of EGLD + WEGLD + an NFT", async () => {
    const dest = hex(fromHex("80" + "00".repeat(31)));
    const d = await module.decode(
      one(tx({ receiver: FIX.me, data: data(`MultiESDTNFTTransfer@${dest}@03@${hexOf("EGLD-000000")}@@0de0b6b3a7640000@${hexOf("WEGLD-a28c59")}@@0de0b6b3a7640000@${hexOf("NICENFT-abcdef")}@05@01`) })),
      ctx,
    );
    expect(d.blind).toBe(false);
    expect(d.title).toContain("1 EGLD + 1 WEGLD + 1 × NICENFT #5");
    expect(d.lines).toContainEqual({ label: "To", value: encodeAddress(fromHex(dest)) });
    expect(d.balanceChanges.map((c) => c.asset.symbol).sort()).toEqual(["EGLD", "WEGLD"]);
  });

  it("delegation: stake, unstake, claim, withdraw, restake in plain words", async () => {
    const shortP = `${PROVIDER.slice(0, 7)}…${PROVIDER.slice(-4)}`;
    expect(shortP).toBeTruthy();
    const stake = await module.decode(one(tx({ receiver: PROVIDER, value: "1000000000000000000", data: data("delegate"), gasLimit: 12000000 })), ctx);
    expect(stake.title).toBe("Stake 1 EGLD with castlestake");
    expect(stake.titleMsg?.id).toBe("bg.req.stakeWith");
    expect(stake.balanceChanges[0]?.delta).toBe("-1000000000000000000");
    const un = await module.decode(one(tx({ receiver: PROVIDER, data: data("unDelegate@0de0b6b3a7640000"), gasLimit: 12000000 })), ctx);
    expect(un.title).toBe("Unstake 1 EGLD from castlestake");
    expect((await module.decode(one(tx({ receiver: PROVIDER, data: data("claimRewards"), gasLimit: 6000000 })), ctx)).title).toBe("Claim your staking rewards from castlestake");
    expect((await module.decode(one(tx({ receiver: PROVIDER, data: data("withdraw"), gasLimit: 12000000 })), ctx)).title).toBe("Withdraw your unstaked EGLD from castlestake");
    expect((await module.decode(one(tx({ receiver: PROVIDER, data: data("reDelegateRewards"), gasLimit: 12000000 })), ctx)).title).toBe("Restake your rewards with castlestake");
  });

  it("SetGuardian, GuardAccount and ChangeOwnerAddress are dangers", async () => {
    const g = await module.decode(one(tx({ receiver: FIX.me, data: data(`SetGuardian@${hex(fromHex("11".repeat(32)))}@${hexOf("ServiceID")}`) })), ctx);
    expect(g.titleMsg?.id).toBe("bg.multiversx.setGuardianTitle");
    expect(g.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "account-takeover" }));
    const ga = await module.decode(one(tx({ receiver: FIX.me, data: data("GuardAccount") })), ctx);
    expect(ga.warnings[0]).toMatchObject({ level: "danger", code: "account-takeover" });
    const o = await module.decode(one(tx({ receiver: CONTRACT, data: data(`ChangeOwnerAddress@${hex(fromHex("22".repeat(32)))}`) })), ctx);
    expect(o.title).toMatch(/^Give contract erd1qqq…3rax to /);
    expect(o.warnings[0]).toMatchObject({ level: "danger", code: "account-takeover" });
  });

  it("another smart contract call is named with a caution", async () => {
    const d = await module.decode(one(tx({ receiver: CONTRACT, value: "100000000000000000", data: data("swapTokensFixedInput@0a@0b") })), ctx);
    expect(d.title).toBe("Approve swapTokensFixedInput on contract erd1qqq…3rax");
    expect(d.blind).toBe(false);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "unknown-call" }));
    expect(d.balanceChanges[0]?.delta).toBe("-100000000000000000");
  });

  it("a note to a person is shown, not blind", async () => {
    const d = await module.decode(one(tx({ value: "1", data: data("invoice 42") })), ctx);
    expect(d.blind).toBe(false);
    expect(d.lines).toContainEqual({ label: "Note", value: "invoice 42" });
  });

  it("undecodable data to a contract is blind", async () => {
    const d = await module.decode(one(tx({ receiver: CONTRACT, data: b64encode(Uint8Array.of(0, 1, 2, 255)) })), ctx);
    expect(d.blind).toBe(true);
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "blind-signing" });
  });

  it("several transactions → one approval", async () => {
    const d = await module.decode(req(MULTIVERSX_METHODS.signTransactions, { transactions: [tx({ value: "1" }), tx({ nonce: 8, value: "2" })] }), ctx);
    expect(d.title).toBe("Approve 2 transactions");
    expect(d.balanceChanges[0]?.delta).toBe("-3");
  });

  it("a relayed transaction's fee is paid by the relayer", async () => {
    const d = await module.decode(one(tx({ value: "1", relayer: PROVIDER, version: 2 })), ctx);
    expect(d.fee).toMatchObject({ amount: "0", sponsored: true });
    expect(d.lines).toContainEqual({ label: "Fee paid by", value: PROVIDER });
  });

  it("a dry run through the gateway: success marks it simulated, a failure warns in plain words", async () => {
    const sims: string[] = [];
    const ok = mockFetch(baseRoutes([[/\/transaction\/simulate\?checkSignature=false$/, (_u: string, init?: RequestInit) => (sims.push(String(init?.body)), gw({ result: { status: "success", hash: "aa" } }))]]));
    const d = await module.decode(one(tx({ value: "1", gasLimit: 50000 })), ctxFor(ok.fetch));
    expect(d.simulated).toBe(true);
    expect(JSON.parse(sims[0]!)).toMatchObject({ sender: FIX.me, signature: "00".repeat(64) });
    const failing = mockFetch(
      baseRoutes([[/\/transaction\/simulate/, gw({ result: { receiverShard: { status: "success" }, senderShard: { status: "fail", failReason: "insufficient balance for fees, has: 0, wanted: 50000000000000" } } })]]),
    );
    const f2 = await module.decode(one(tx({ value: "1", gasLimit: 50000 })), ctxFor(failing.fetch));
    expect(f2.simulated).toBe(false);
    expect(f2.warnings).toContainEqual({ level: "caution", code: "simulation-failed", message: "A test run says you don't have enough EGLD for this and its network fee." });
  });

  it("a message", async () => {
    const d = await module.decode(req(MULTIVERSX_METHODS.signMessage, { message: FIX.message, address: FIX.me }), ctx);
    expect(d.title).toBe("Sign a message for app.example");
    expect(d.lines).toEqual([{ label: "Message", value: FIX.message }]);
  });

  it("refuses the wrong network, account or method", async () => {
    await expect(module.decode(one(tx({ chainID: "1" })), ctx)).rejects.toMatchObject({ code: "multiversx/network-mismatch" });
    await expect(module.decode(one(tx()), ctxFor(f.fetch, MULTIVERSX_MAINNET))).rejects.toMatchObject({ code: "multiversx/network-mismatch" });
    await expect(module.decode(one(tx({ sender: FIX.bob })), ctx)).rejects.toMatchObject({ code: "multiversx/wrong-account" });
    await expect(module.decode(req(MULTIVERSX_METHODS.signMessage, { message: "x", address: FIX.bob }), ctx)).rejects.toMatchObject({ code: "multiversx/wrong-account" });
    await expect(module.decode(req("mvx_cancelAction", {}), ctx)).rejects.toMatchObject({ code: "multiversx/unsupported-method" });
    // Only the wallet itself may ask it to send.
    await expect(module.decode(req(MULTIVERSX_METHODS.signAndSendTransactions, { transactions: [tx()] }), ctx)).rejects.toMatchObject({ code: "multiversx/unsupported-method" });
  });
});

describe("send (buildTransfer → decode → prepare → finalize)", () => {
  function sendRoutes(status: string, sent: { body?: string }[]) {
    return baseRoutes([
      [/\/transaction\/send$/, (_u: string, init?: RequestInit) => (sent.push({ body: String(init?.body) }), gw({ txHash: "ab".repeat(32) }))],
      [/\/process-status$/, gw({ status, reason: status === "fail" ? `@04@${hexOf("insufficient funds")}` : "" })],
    ]);
  }

  it("EGLD: builds, decodes, signs, verifies and sends", async () => {
    const sent: { body?: string }[] = [];
    const f = mockFetch(sendRoutes("success", sent));
    const ctx = ctxFor(f.fetch);
    const r = await module.buildTransfer({ asset: MULTIVERSX_DEVNET.nativeAsset, to: FIX.bob, amount: "1500000000000000000" }, ctx);
    expect(r).toMatchObject({ origin: WALLET_ORIGIN, method: MULTIVERSX_METHODS.signAndSendTransactions, networkId: "mvx:D" });
    const d = await module.decode(r, ctx);
    expect(d.title).toMatch(/^Send 1\.5 EGLD to/);
    expect(d.lines.some((l) => l.label === "Sent by")).toBe(false);
    const payloads = await module.prepare(r, ctx, "ap1");
    const out = await module.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
    expect(out).toEqual({ txHash: "ab".repeat(32), txHashes: ["ab".repeat(32)], status: "success" });
    expect(JSON.parse(sent[0]!.body!)).toMatchObject({ nonce: 7, value: "1500000000000000000", signature: FIX.egldSig, chainID: "D", version: 2, gasLimit: 50000 });
  });

  it("USDC: ESDTTransfer with sdk-core's gas", async () => {
    const sent: { body?: string }[] = [];
    const f = mockFetch(sendRoutes("success", sent));
    const ctx = ctxFor(f.fetch);
    const usdc = esdtAsset("mvx:D", { identifier: "USDC-350c4e", decimals: 6 });
    const r = await module.buildTransfer({ asset: usdc, to: FIX.bob, amount: "2500000" }, ctx);
    const payloads = await module.prepare(r, ctx, "ap2");
    await module.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
    const body = JSON.parse(sent[0]!.body!) as PlainTransaction;
    expect(body).toMatchObject({ value: "0", gasLimit: 413000, signature: FIX.usdcSig });
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.data!), (c) => c.charCodeAt(0)))).toBe(`ESDTTransfer@${hexOf("USDC-350c4e")}@2625a0`);
  });

  it("a bad signature is refused before anything is sent", async () => {
    const sent: { body?: string }[] = [];
    const f = mockFetch(sendRoutes("success", sent));
    const ctx = ctxFor(f.fetch);
    const r = await module.buildTransfer({ asset: MULTIVERSX_DEVNET.nativeAsset, to: FIX.bob, amount: "1500000000000000000" }, ctx);
    const good = signer.sign((await module.prepare(r, ctx, "ap3"))[0]!);
    const bad = { ...good, bytes: Uint8Array.from(good.bytes, (b, i) => (i === 0 ? b ^ 1 : b)) };
    await expect(module.finalize(r, [bad], ctx)).rejects.toMatchObject({ code: "multiversx/bad-signature" });
    await expect(module.finalize(r, [], ctx)).rejects.toMatchObject({ code: "multiversx/bad-signature" });
    expect(sent).toHaveLength(0);
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a failed transaction and a gateway rejection come back in plain words", async () => {
    const f = mockFetch(sendRoutes("fail", []));
    const ctx = ctxFor(f.fetch);
    const r = await module.buildTransfer({ asset: MULTIVERSX_DEVNET.nativeAsset, to: FIX.bob, amount: "1500000000000000000" }, ctx);
    const sigs = (await module.prepare(r, ctx, "ap4")).map((p) => signer.sign(p));
    await expect(module.finalize(r, sigs, ctx)).rejects.toMatchObject({ code: "multiversx/transaction-failed", userMessage: "The transaction failed: there wasn't enough to cover it. Only the network fee was spent." });
    const g = mockFetch(baseRoutes([[/\/transaction\/send$/, reply(400, { data: null, error: "transaction generation failed: lowerNonceInTx: true, veryHighNonceInTx: false", code: "bad_request" })]]));
    await expect(module.finalize(r, sigs, ctxFor(g.fetch))).rejects.toMatchObject({ code: "multiversx/send-failed", userMessage: plainMultiversXError("lowerNonceInTx: true") });
  });

  it("refuses sends the network would reject", async () => {
    const f = mockFetch(baseRoutes());
    const ctx = ctxFor(f.fetch);
    const egld = MULTIVERSX_DEVNET.nativeAsset;
    await expect(module.buildTransfer({ asset: egld, to: FIX.me, amount: "1" }, ctx)).rejects.toMatchObject({ code: "multiversx/self-transfer" });
    await expect(module.buildTransfer({ asset: egld, to: "erd1xyz", amount: "1" }, ctx)).rejects.toMatchObject({ code: "multiversx/bad-address" });
    await expect(module.buildTransfer({ asset: egld, to: FIX.bob, amount: "0" }, ctx)).rejects.toMatchObject({ code: "multiversx/bad-amount" });
    await expect(module.buildTransfer({ asset: egld, to: FIX.bob, amount: "5000000000000000000" }, ctx)).rejects.toMatchObject({ code: "multiversx/insufficient-funds" });
    const usdc = esdtAsset("mvx:D", { identifier: "USDC-350c4e", decimals: 6 });
    await expect(module.buildTransfer({ asset: usdc, to: FIX.bob, amount: "10000001" }, ctx)).rejects.toMatchObject({ code: "multiversx/insufficient-token" });
    const guarded = mockFetch(baseRoutes([[new RegExp(`/address/${FIX.me}/guardian-data$`), gw({ guardianData: { guarded: true } })]]));
    await expect(module.buildTransfer({ asset: egld, to: FIX.bob, amount: "1" }, ctxFor(guarded.fetch))).rejects.toMatchObject({ code: "multiversx/guarded" });
  });

  it("signs messages and returns the hex signature", async () => {
    const f = mockFetch(baseRoutes());
    const ctx = ctxFor(f.fetch);
    const r = req(MULTIVERSX_METHODS.signMessage, { message: FIX.message, address: FIX.me });
    const payloads = await module.prepare(r, ctx, "ap5");
    expect(payloads[0]!.bytes).toHaveLength(32);
    expect(await module.finalize(r, payloads.map((p) => signer.sign(p)), ctx)).toEqual({ signature: FIX.messageSig, address: FIX.me });
  });
});

describe("balances", () => {
  it("EGLD from the gateway, fungible ESDTs from the API with spam marked", async () => {
    const f = mockFetch(
      baseRoutes([
        [
          new RegExp(`${API}/accounts/${FIX.me}/tokens`),
          [
            { identifier: "USDC-350c4e", ticker: "USDC", decimals: 6, balance: "2500000", type: "FungibleESDT", assets: { status: "active" } },
            { identifier: "USDC-fa4e01", ticker: "USDC", name: "USDC", decimals: 6, balance: "999", type: "FungibleESDT" },
            { identifier: "MEX-a659d0", ticker: "MEX", decimals: 18, balance: "7", type: "MetaESDT" },
          ],
        ],
      ]),
    );
    const b = await module.getBalances(ctxFor(f.fetch));
    expect(f.calls[0]!.url.startsWith(GATEWAY) || f.calls[0]!.url.startsWith(API)).toBe(true);
    expect(b.map((x) => [x.asset.key, x.amount, !!x.asset.spam])).toEqual([
      ["egld", "5000000000000000000", false],
      ["usdc.mvx", "2500000", false],
      ["esdt:USDC-fa4e01", "999", true],
    ]);
    expect(makeAccount().address).toBe(FIX.me);
  });
});
