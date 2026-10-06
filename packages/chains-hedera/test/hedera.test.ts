import { ClipError, type DappRequest } from "@clip-wallet/core";
import { proto } from "@hiero-ledger/proto";
import {
  AccountAllowanceApproveTransaction,
  AccountId,
  AccountUpdateTransaction,
  Client,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  KeyList,
  NftId,
  PublicKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  TokenAssociateTransaction,
  TokenId,
  Transaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  HEDERA_MAINNET,
  HEDERA_NETWORKS,
  HEDERA_PREVIEWNET,
  HEDERA_TESTNET,
  SIGN_TRANSACTION_BYTES,
  aliasAddress,
  clearMirrorCache,
  createHederaModule,
  hbarAsset,
  lookupSelector,
  metadataUri,
  prefixMessage,
  resolveUri,
  selectorOf,
  tokenAssetKey,
} from "../src/index.js";
import { b64decode, b64encode, hex } from "../src/util.js";
import { APES, SAUCE, USDC, ctxFor, fixtureSigner, makeAccount, mirrorAccount, mockFetch } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = "0.0.1001";
const BOB = "0.0.1234";
const M = /^https:\/\/testnet\.mirrornode\.hedera\.com\/api\/v1/;
const r = (path: string) => new RegExp(M.source + path.replace(/\./g, "\\.").replace(/\?/g, "\\?"));

function client() {
  return Client.forName("testnet", { scheduleNetworkUpdate: false });
}

function frozen(tx: Transaction, payer = ME): string {
  const c = client();
  try {
    tx.setTransactionId(TransactionId.generate(AccountId.fromString(payer))).freezeWith(c);
  } finally {
    c.close();
  }
  return b64encode(tx.toBytes());
}

function req(method: string, params: unknown, id = Math.random().toString(36).slice(2)): DappRequest {
  return { id, origin: "https://app.example", via: "walletconnect", family: "hedera", networkId: "hedera:testnet", method, params };
}

const baseRoutes = (): [RegExp, unknown][] => [
  [r("/tokens/0.0.731861$"), SAUCE],
  [r("/tokens/0.0.429274$"), USDC],
  [r("/tokens/0.0.8888$"), APES],
  [r(`/accounts/${BOB}/tokens?token.id=`), { tokens: [] }],
  [r(`/accounts/${BOB}/tokens?limit`), { tokens: [], links: { next: null } }],
  [r(`/accounts/${BOB}?`), mirrorAccount(BOB, { max_automatic_token_associations: 0 })],
];

const signer = fixtureSigner(FIX.alicePublicKey, [...FIX.transferSigsAlice, ...FIX.tradeSigsAlice, FIX.messageSigAlice]);
beforeEach(() => {
  clearMirrorCache();
});
const firstBody = (b64: string) =>
  proto.SignedTransaction.decode(proto.TransactionList.decode(b64decode(b64)).transactionList[0]!.signedTransactionBytes!).bodyBytes;

describe("networks & addresses", () => {
  it("uses the Hedera WalletConnect CAIP-2 ids and public mirror nodes", () => {
    expect(HEDERA_NETWORKS.map((n) => n.id).sort()).toEqual(["hedera:mainnet", "hedera:previewnet", "hedera:testnet"]);
    expect(HEDERA_TESTNET.indexerUrl).toBe("https://testnet.mirrornode.hedera.com");
    expect(HEDERA_MAINNET.indexerUrl).toBe("https://mainnet-public.mirrornode.hedera.com");
    expect(HEDERA_PREVIEWNET.explorerUrl).toBe("https://hashscan.io/previewnet");
    expect(HEDERA_TESTNET.testnet).toBe(true);
    expect(HEDERA_MAINNET.testnet).toBe(false);
    expect(hbarAsset("hedera:testnet")).toMatchObject({ key: "hbar", decimals: 8 });
    expect(tokenAssetKey("hedera:testnet", "0.0.429274")).toBe("usdc");
    expect(tokenAssetKey("hedera:mainnet", "0.0.456858")).toBe("usdc");
    expect(tokenAssetKey("hedera:testnet", "0.0.731861")).toBe("hts:0.0.731861");
  });

  it("derives the EVM alias from a secp256k1 public key (generator point → 0x7e5f…bdf)", () => {
    const g = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    expect(aliasAddress(g)).toBe("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
    const m = createHederaModule();
    // EIP-55 (the well-known checksum of the generator's address), as the vault and the UI show it.
    expect(m.addressFromPublicKey(b64decode(b64encode(Uint8Array.from(g.match(/../g)!.map((x) => parseInt(x, 16))))), HEDERA_TESTNET)).toBe(
      "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    );
  });

  it("derives the same checksummed alias the vault shows (dapp matrix regression: they differed only in case)", () => {
    // Public key and EIP-55 address of the dapp matrix wallet's Hedera account (apps/extension/e2e/matrix/addresses.json).
    const m = createHederaModule();
    const pk = Uint8Array.from("0368049caabb6779c03728b4f93df9b405852da22874013b99d226239c122727af".match(/../g)!.map((x) => parseInt(x, 16)));
    expect(m.addressFromPublicKey(pk, HEDERA_TESTNET)).toBe("0xa3a57dB2a5237bD72D5d05cBdD797fEe21A0Fc92");
  });

  it("recognizes addresses and narrows networks by HIP-15 checksum", () => {
    const m = createHederaModule();
    expect(m.isAddress("0.0.1234")).toBe(true);
    expect(m.isAddress("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf")).toBe(true);
    expect(m.isAddress("1234")).toBe(false);
    expect(m.networksForAddress("0.0.1234", HEDERA_NETWORKS)).toHaveLength(3);
    const c = client();
    const withSum = AccountId.fromString("0.0.1234").toStringWithChecksum(c);
    c.close();
    expect(m.networksForAddress(withSum, HEDERA_NETWORKS).map((n) => n.id)).toEqual(["hedera:testnet"]);
    expect(m.derivationPath(2)).toBe("m/44'/3030'/0'/0/2"); // the vault's Hedera ECDSA path, not EVM's coin type 60
  });

  it("computes selectors from signatures", () => {
    expect(selectorOf("transfer(address,uint256)")).toBe("a9059cbb");
    expect(selectorOf("approve(address,uint256)")).toBe("095ea7b3");
    expect(lookupSelector(Uint8Array.from([0xa2, 0x2c, 0xb4, 0x65]))?.name).toBe("setApprovalForAll");
  });
});

describe("decode", () => {
  const setup = (extraRoutes: [RegExp, unknown][] = []) => {
    const { fetch } = mockFetch([...extraRoutes, ...baseRoutes()]);
    const account = makeAccount(signer.publicKeyHex, ME);
    return { m: createHederaModule(), ctx: ctxFor(account, fetch) };
  };
  const signAndExec = (tx: Transaction) => req("hedera_signAndExecuteTransaction", { signerAccountId: `hedera:testnet:${ME}`, transactionList: frozen(tx) });

  it("HBAR transfer → 'Send 10 HBAR to 0.0.1234' with max fee in HBAR", async () => {
    const { m, ctx } = setup();
    const tx = new TransferTransaction().addHbarTransfer(ME, new Hbar(-10)).addHbarTransfer(BOB, new Hbar(10)).setMaxTransactionFee(new Hbar(2));
    const d = await m.decode(signAndExec(tx), ctx);
    expect(d.title).toBe("Send 10 HBAR to 0.0.1234");
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([{ asset: hbarAsset("hedera:testnet"), delta: "-1000000000" }]);
    expect(d.fee).toEqual({ asset: hbarAsset("hedera:testnet"), amount: "200000000" });
    expect(d.lines).toContainEqual({ label: "Network fee", value: "up to 2 HBAR" });
  });

  it("token transfer to an account that hasn't added the token → plain warning", async () => {
    const { m, ctx } = setup();
    const tx = new TransferTransaction().addTokenTransfer("0.0.731861", ME, -2_500_000).addTokenTransfer("0.0.731861", BOB, 2_500_000);
    const d = await m.decode(signAndExec(tx), ctx);
    expect(d.title).toBe("Send 2.5 SAUCE to 0.0.1234");
    expect(d.balanceChanges[0]).toMatchObject({ asset: { key: "hts:0.0.731861", symbol: "SAUCE" }, delta: "-2500000" });
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "new-recipient", level: "caution", message: expect.stringContaining("hasn't added the SAUCE token") }));
  });

  it("no warning when the recipient has a free auto-association slot", async () => {
    const { m, ctx } = setup([[r(`/accounts/${BOB}?`), mirrorAccount(BOB, { max_automatic_token_associations: -1 })]]);
    const tx = new TransferTransaction().addTokenTransfer("0.0.429274", ME, -1_000_000).addTokenTransfer("0.0.429274", BOB, 1_000_000);
    const d = await m.decode(signAndExec(tx), ctx);
    expect(d.title).toBe("Send 1 USDC to 0.0.1234");
    expect(d.balanceChanges[0]!.asset.key).toBe("usdc");
    expect(d.warnings).toEqual([]);
  });

  it("swap-shaped transfer → 'Trade … for … with …', and approved (allowance) transfers are called out", async () => {
    const { m, ctx } = setup([[r(`/accounts/${ME}/tokens?token.id=`), { tokens: [{ token_id: "0.0.731861" }] }]]);
    const tx = new TransferTransaction()
      .addHbarTransfer(ME, new Hbar(-5))
      .addHbarTransfer(BOB, new Hbar(5))
      .addApprovedTokenTransfer("0.0.731861", BOB, -1_000_000)
      .addTokenTransfer("0.0.731861", ME, 1_000_000);
    const d = await m.decode(signAndExec(tx), ctx);
    expect(d.title).toBe("Trade 5 HBAR for 1 SAUCE with 0.0.1234");
    expect(d.titleMsg).toEqual({ id: "bg.req.tradeWith", values: { give: "5 HBAR", get: "1 SAUCE", who: "0.0.1234" }, fallback: d.title });
    expect(d.lines).toContainEqual({ label: "Paid from an allowance", value: BOB });
  });

  it("NFT transfer", async () => {
    const { m, ctx } = setup([[r(`/accounts/${BOB}/tokens?token.id=0.0.8888`), { tokens: [{ token_id: "0.0.8888" }] }]]);
    const tx = new TransferTransaction().addNftTransfer(new NftId(TokenId.fromString("0.0.8888"), 7), ME, BOB);
    const d = await m.decode(signAndExec(tx), ctx);
    expect(d.title).toBe("Send Hedera Apes #7 to 0.0.1234");
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ address: "0.0.8888", decimals: 0 }), delta: "-1" }]);
  });

  it("token association", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(signAndExec(new TokenAssociateTransaction().setAccountId(ME).setTokenIds(["0.0.731861"])), ctx);
    expect(d.title).toBe("Add the SAUCE token to your account");
  });

  it("unlimited token allowance → danger", async () => {
    const { m, ctx } = setup();
    const tx = new AccountAllowanceApproveTransaction().approveTokenAllowance("0.0.731861", ME, BOB, 9223372036854775807n as unknown as number);
    const d = await m.decode(signAndExec(tx), ctx);
    expect(d.title).toBe("Allow 0.0.1234 to spend unlimited SAUCE");
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "unlimited-approval" }));
  });

  it("bounded allowance → caution; all-serials NFT allowance → approval-for-all danger", async () => {
    const { m, ctx } = setup();
    const tx = new AccountAllowanceApproveTransaction()
      .approveTokenAllowance("0.0.731861", ME, BOB, 5_000_000)
      .approveTokenNftAllowanceAllSerials("0.0.8888", ME, BOB);
    const d = await m.decode(signAndExec(tx), ctx);
    expect(d.lines.filter((l) => l.label === "Permission").map((l) => l.value)).toEqual(["Allow 0.0.1234 to spend up to 5 SAUCE", "Allow 0.0.1234 to move all your Hedera Apes NFTs"]);
    expect(d.warnings.map((w) => [w.level, w.code])).toEqual([
      ["caution", "unlimited-approval"],
      ["danger", "approval-for-all"],
    ]);
  });

  it("contract call: known selector decoded (ERC-20 approve max on an HTS token), unknown → blind", async () => {
    const { m, ctx } = setup();
    const spender = "000000000000000000000000" + "00000000000000000000000000000000000004d2";
    const data = new Uint8Array([...b64decode(b64encode(Uint8Array.from([0x09, 0x5e, 0xa7, 0xb3]))), ...hexBytes(spender), ...new Uint8Array(32).fill(0xff)]);
    const known = new ContractExecuteTransaction().setContractId(ContractId.fromString("0.0.731861")).setGas(100_000).setFunctionParameters(data);
    const d = await m.decode(signAndExec(known), ctx);
    expect(d.title).toBe("Allow 0.0.1234 to spend unlimited SAUCE");
    expect(d.blind).toBe(false);
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "unlimited-approval" });

    const unknown = new ContractExecuteTransaction().setContractId(ContractId.fromString("0.0.5555")).setGas(100_000).setFunctionParameters(Uint8Array.from([1, 2, 3, 4, 5])).setPayableAmount(new Hbar(3));
    const u = await m.decode(signAndExec(unknown), ctx);
    expect(u.blind).toBe(true);
    expect(u.title).toBe("Use contract 0.0.5555");
    expect(u.balanceChanges).toEqual([{ asset: hbarAsset("hedera:testnet"), delta: "-300000000" }]);
    expect(u.warnings[0]!.code).toBe("blind-signing");
  });

  it("staking update → 'Stake HBAR with node 3'; key change → blind", async () => {
    const { m, ctx } = setup();
    const stake = new AccountUpdateTransaction().setAccountId(ME).setStakedNodeId(3).setDeclineStakingReward(false);
    const d = await m.decode(signAndExec(stake), ctx);
    expect(d.title).toBe("Stake HBAR with node 3");
    expect(d.lines).toContainEqual({ label: "Staking rewards", value: "On" });

    const takeover = new AccountUpdateTransaction().setAccountId(ME).setKey(new KeyList([PublicKey.fromStringECDSA(signer.publicKeyHex)]));
    const t = await m.decode(signAndExec(takeover), ctx);
    expect(t.blind).toBe(true);
    expect(t.warnings[0]!.level).toBe("danger");
  });

  it("ScheduleCreate shows the inner transaction", async () => {
    const { m, ctx } = setup();
    const inner = new TransferTransaction().addHbarTransfer(ME, new Hbar(-1)).addHbarTransfer(BOB, new Hbar(1));
    const d = await m.decode(signAndExec(new ScheduleCreateTransaction().setScheduledTransaction(inner)), ctx);
    expect(d.title).toBe("Schedule: send 1 HBAR to 0.0.1234");
    expect(d.lines[0]!.label).toBe("When");
  });

  it("ScheduleSign reads the inner transaction from the mirror node", async () => {
    const inner = new TransferTransaction().addHbarTransfer(ME, new Hbar(-4)).addHbarTransfer(BOB, new Hbar(4));
    const createBytes = b64decode(frozen(new ScheduleCreateTransaction().setScheduledTransaction(inner), BOB));
    const sched = proto.TransactionBody.decode(
      proto.SignedTransaction.decode(proto.TransactionList.decode(createBytes).transactionList[0]!.signedTransactionBytes!).bodyBytes,
    ).scheduleCreate!.scheduledTransactionBody!;
    const body = b64encode(proto.SchedulableTransactionBody.encode(sched).finish());
    const { m, ctx } = setup([[r("/schedules/0.0.7777$"), { schedule_id: "0.0.7777", creator_account_id: BOB, payer_account_id: BOB, transaction_body: body, memo: "", executed_timestamp: null, deleted: false, expiration_time: null }]]);
    const d = await m.decode(signAndExec(new ScheduleSignTransaction().setScheduleId("0.0.7777")), ctx);
    expect(d.title).toBe("Approve scheduled: send 4 HBAR to 0.0.1234");
    expect(d.blind).toBe(false);
  });

  it("unknown schedule → blind", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(signAndExec(new ScheduleSignTransaction().setScheduleId("0.0.4040")), ctx);
    expect(d.blind).toBe(true);
  });

  it("rejects a request for another account or another network", async () => {
    const { m, ctx } = setup();
    const tx = () => new TransferTransaction().addHbarTransfer(ME, new Hbar(-1)).addHbarTransfer(BOB, new Hbar(1));
    await expect(m.decode(req("hedera_signAndExecuteTransaction", { signerAccountId: `hedera:testnet:${BOB}`, transactionList: frozen(tx()) }), ctx)).rejects.toBeInstanceOf(ClipError);
    await expect(m.decode(req("hedera_signAndExecuteTransaction", { signerAccountId: `hedera:mainnet:${ME}`, transactionList: frozen(tx()) }), ctx)).rejects.toThrow(/different Hedera network/);
  });
});

describe("prepare / finalize", () => {
  const setup = () => {
    const submitted: Transaction[] = [];
    const m = createHederaModule({
      submit: async (bytes) => {
        const tx = Transaction.fromBytes(bytes);
        submitted.push(tx);
        return { nodeId: "0.0.3", transactionHash: "00", transactionId: tx.transactionId!.toString() };
      },
    });
    const { fetch } = mockFetch(baseRoutes());
    const ctx = ctxFor(makeAccount(signer.publicKeyHex, ME), fetch);
    return { m, ctx, submitted };
  };

  it("signAndExecute: one keccak256 digest per node body; signatures attached and verified; submitted", async () => {
    const { m, ctx, submitted } = setup();
    const request = req("hedera_signAndExecuteTransaction", { signerAccountId: `hedera:testnet:${ME}`, transactionList: FIX.transferList });
    const payloads = await m.prepare(request, ctx, "approval-1");
    expect(payloads).toHaveLength(3); // nodes 0.0.3, 0.0.4, 0.0.5
    for (const p of payloads) {
      expect(p).toMatchObject({ accountId: "hedera:0", scheme: "ecdsa-secp256k1", approvalId: "approval-1" });
      expect(p.bytes).toHaveLength(32);
    }
    const result = await m.finalize(request, payloads.map((p) => signer.sign(p)).reverse(), ctx);
    expect(result).toMatchObject({ nodeId: "0.0.3" });
    expect(submitted).toHaveLength(1);
    expect(PublicKey.fromStringECDSA(signer.publicKeyHex).verifyTransaction(submitted[0]!)).toBe(true);
  });

  it("refuses to submit with a signature that doesn't match", async () => {
    const { m, ctx, submitted } = setup();
    const request = req("hedera_signAndExecuteTransaction", { signerAccountId: `hedera:testnet:${ME}`, transactionList: FIX.transferList });
    const payloads = await m.prepare(request, ctx, "a");
    const other = fixtureSigner(FIX.bobPublicKey, FIX.transferSigsBob);
    await expect(m.finalize(request, payloads.map((p) => other.sign(p)), ctx)).rejects.toThrow(/didn't match/);
    expect(submitted).toHaveLength(0);
  });

  it("HIP-745: an unfrozen transaction is frozen once and stays identical through finalize", async () => {
    const { m, ctx, submitted } = setup();
    const unfrozen = new TransferTransaction().addHbarTransfer(ME, new Hbar(-3)).addHbarTransfer(BOB, new Hbar(3));
    const request = req("hedera_signAndExecuteTransaction", { signerAccountId: `hedera:testnet:${ME}`, transactionList: b64encode(unfrozen.toBytes()) });
    const d = await m.decode(request, ctx);
    expect(d.title).toBe("Send 3 HBAR to 0.0.1234");
    const payloads = await m.prepare(request, ctx, "a");
    expect(payloads.length).toBeGreaterThan(0);
    // Same bytes on every call: the frozen copy is cached per request id.
    expect((await m.prepare(request, ctx, "a")).map((p) => hex(p.bytes))).toEqual(payloads.map((p) => hex(p.bytes)));
    const bogus = payloads.map(() => ({ scheme: "ecdsa-secp256k1" as const, bytes: new Uint8Array(64).fill(1), publicKey: signer.publicKeyHex }));
    await expect(m.finalize(request, bogus, ctx)).rejects.toThrow(/didn't match/);
    expect(submitted).toHaveLength(0);
  });

  it("hedera_signTransaction: signs keccak256(transactionBody), returns a SignatureMap", async () => {
    const { m, ctx } = setup();
    const bodyBytes = firstBody(FIX.transferList);
    const request = req("hedera_signTransaction", { signerAccountId: `hedera:testnet:${ME}`, transactionBody: b64encode(bodyBytes) });
    const d = await m.decode(request, ctx);
    expect(d.title).toBe("Send 1 HBAR to 0.0.1234");
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "network-matters" }));
    const [p] = await m.prepare(request, ctx, "a");
    expect(hex(p!.bytes)).toBe(hex(keccak_256(bodyBytes)));
    const out = (await m.finalize(request, [signer.sign(p!)], ctx)) as { signatureMap: string };
    const map = proto.SignatureMap.decode(b64decode(out.signatureMap));
    const pair = map.sigPair[0]!;
    expect(hex(pair.pubKeyPrefix!)).toBe(signer.publicKeyHex);
    expect(PublicKey.fromStringECDSA(signer.publicKeyHex).verify(bodyBytes, pair.ECDSASecp256k1!)).toBe(true);
  });

  it("hedera_signMessage: signs the prefixed message", async () => {
    const { m, ctx } = setup();
    const request = req("hedera_signMessage", { signerAccountId: `hedera:testnet:${ME}`, message: "Hello Hedera" });
    const d = await m.decode(request, ctx);
    expect(d.title).toBe("Sign a message for app.example");
    expect(d.lines).toEqual([{ label: "Message", value: "Hello Hedera" }]);
    const [p] = await m.prepare(request, ctx, "a");
    expect(new TextDecoder().decode(prefixMessage("Hello Hedera"))).toBe("\x19Hedera Signed Message:\n12Hello Hedera");
    const out = (await m.finalize(request, [signer.sign(p!)], ctx)) as { signatureMap: string };
    const sig = proto.SignatureMap.decode(b64decode(out.signatureMap)).sigPair[0]!.ECDSASecp256k1!;
    expect(PublicKey.fromStringECDSA(signer.publicKeyHex).verify(prefixMessage("Hello Hedera"), sig)).toBe(true);
  });

  it("hedera_executeTransaction needs no signature from us", async () => {
    const { m, ctx, submitted } = setup();
    const tx = new TransferTransaction().addHbarTransfer(BOB, new Hbar(-1)).addHbarTransfer(ME, new Hbar(1));
    const request = req("hedera_executeTransaction", { transactionList: frozen(tx, BOB) });
    const d = await m.decode(request, ctx);
    expect(d.title).toBe("Receive 1 HBAR from 0.0.1234");
    expect(d.fee).toBeUndefined();
    expect(await m.prepare(request, ctx, "a")).toEqual([]);
    await m.finalize(request, [], ctx);
    expect(submitted).toHaveLength(1);
  });

  it("paid queries are refused in prepare (not supported yet)", async () => {
    const { m, ctx } = setup();
    await expect(m.prepare(req("hedera_signAndExecuteQuery", { signerAccountId: `hedera:testnet:${ME}`, query: "" }), ctx, "a")).rejects.toThrow(/aren't supported/);
  });
});

describe("builders", () => {
  const setup = (routes: [RegExp, unknown][] = []) => {
    const { fetch } = mockFetch([...routes, ...baseRoutes()]);
    return { m: createHederaModule({ submit: async () => ({ nodeId: "0.0.3", transactionHash: "", transactionId: "" }) }), ctx: ctxFor(makeAccount(signer.publicKeyHex, ME), fetch) };
  };

  it("buildTransfer HBAR and token, decoded through the same approval path", async () => {
    const { m, ctx } = setup();
    const hbar = await m.buildTransfer({ asset: hbarAsset("hedera:testnet"), to: BOB, amount: "1000000000" }, ctx);
    expect(hbar).toMatchObject({ family: "hedera", method: "hedera_signAndExecuteTransaction", params: { signerAccountId: `hedera:testnet:${ME}` } });
    expect((await m.decode(hbar, ctx)).title).toBe("Send 10 HBAR to 0.0.1234");

    const sauce = { key: "hts:0.0.731861", symbol: "SAUCE", name: "SAUCE", decimals: 6, networkId: "hedera:testnet", address: "0.0.731861" };
    const tok = await m.buildTransfer({ asset: sauce, to: BOB, amount: "3000000" }, ctx);
    const d = await m.decode(tok, ctx);
    expect(d.title).toBe("Send 3 SAUCE to 0.0.1234");
    expect(d.warnings[0]!.message).toMatch(/hasn't added the SAUCE token/);
  });

  it("buildTransfer to a brand-new EVM address uses the alias (HIP-583)", async () => {
    const { m, ctx } = setup();
    const to = "0x1111111111111111111111111111111111111111";
    const d = await m.decode(await m.buildTransfer({ asset: hbarAsset("hedera:testnet"), to, amount: "100000000" }, ctx), ctx);
    expect(d.title).toBe(`Send 1 HBAR to ${to}`);
  });

  it("buildTransfer before the account exists → plain error", async () => {
    const { fetch } = mockFetch([]);
    const ctx = ctxFor(makeAccount(signer.publicKeyHex), fetch);
    await expect(createHederaModule().buildTransfer({ asset: hbarAsset("hedera:testnet"), to: BOB, amount: "1" }, ctx)).rejects.toThrow(/opens when it first receives HBAR/);
  });

  it("associate / dissociate / stake helpers", async () => {
    const { m, ctx } = setup();
    expect((await m.decode(await m.buildAssociate("0.0.731861", ctx), ctx)).title).toBe("Add the SAUCE token to your account");
    expect((await m.decode(await m.buildDissociate(["0.0.731861"], ctx), ctx)).title).toBe("Remove the SAUCE token from your account");
    expect((await m.decode(await m.buildStakeUpdate({ nodeId: 3 }, ctx), ctx)).title).toBe("Stake HBAR with node 3");
    expect((await m.decode(await m.buildStakeUpdate({ stop: true }, ctx), ctx)).title).toBe("Stop staking HBAR");
    const d = await m.decode(await m.buildStakeUpdate({ nodeId: 5 }, ctx, true), ctx);
    expect(d.lines).toContainEqual({ label: "Staking rewards", value: "Off" });
  });

  it("Secure Trade (direct): builder output decodes as one trade", async () => {
    const { m, ctx } = setup([[r(`/accounts/${ME}/tokens?token.id=`), { tokens: [{ token_id: "0.0.731861" }] }]]);
    const sauce = { key: "hts:0.0.731861", symbol: "SAUCE", name: "SAUCE", decimals: 6, networkId: "hedera:testnet", address: "0.0.731861" };
    const request = await m.buildAtomicSwap({ give: { asset: hbarAsset("hedera:testnet"), amount: "1000000000" }, get: { asset: sauce, amount: "5000000" }, counterparty: BOB }, ctx);
    expect(request.method).toBe(SIGN_TRANSACTION_BYTES);
    const d = await m.decode(request, ctx);
    expect(d.title).toBe("Trade 10 HBAR for 5 SAUCE with 0.0.1234");
    expect((await m.prepare(request, ctx, "a")).length).toBeGreaterThan(0);
  });

  it("Secure Trade (direct): maker signs bytes, taker's wallet sees both legs, adds its signature", async () => {
    const { m, ctx } = setup([[r(`/accounts/${ME}/tokens?token.id=`), { tokens: [{ token_id: "0.0.731861" }] }]]);
    // The builder's own origin (builders.ts requestFor): sites can't call this method (audit HED-03).
    const request = { ...req(SIGN_TRANSACTION_BYTES, { signerAccountId: `hedera:testnet:${ME}`, transactionList: FIX.tradeList }), origin: "clip-wallet" };
    expect((await m.decode(request, ctx)).title).toBe("Trade 10 HBAR for 5 SAUCE with 0.0.1234");
    const payloads = await m.prepare(request, ctx, "a");
    const out = (await m.finalize(request, payloads.map((p) => signer.sign(p)), ctx)) as { transactionList: string };

    // The counterparty's wallet
    const bob = fixtureSigner(FIX.bobPublicKey, FIX.tradeSigsBob);
    const submitted: Transaction[] = [];
    const bobModule = createHederaModule({ submit: async (bytes) => (submitted.push(Transaction.fromBytes(bytes)), { nodeId: "0.0.3", transactionHash: "", transactionId: "" }) });
    const { fetch } = mockFetch([[r(`/accounts/${BOB}/tokens?token.id=`), { tokens: [{ token_id: "0.0.731861" }] }], ...baseRoutes()]);
    const bobCtx = ctxFor({ ...makeAccount(bob.publicKeyHex, BOB) }, fetch);
    const bobReq = req("hedera_signAndExecuteTransaction", { signerAccountId: `hedera:testnet:${BOB}`, transactionList: out.transactionList });
    expect((await bobModule.decode(bobReq, bobCtx)).title).toBe("Trade 5 SAUCE for 10 HBAR with 0.0.1001");
    const bobPayloads = await bobModule.prepare(bobReq, bobCtx, "b");
    await bobModule.finalize(bobReq, bobPayloads.map((p) => bob.sign(p)), bobCtx);
    expect(PublicKey.fromStringECDSA(signer.publicKeyHex).verifyTransaction(submitted[0]!)).toBe(true);
    expect(PublicKey.fromStringECDSA(bob.publicKeyHex).verifyTransaction(submitted[0]!)).toBe(true);
  });

  it("Secure Trade (scheduled): ScheduleCreate wrapping both legs", async () => {
    const { m, ctx } = setup();
    const request = await m.buildAtomicSwap(
      { give: { nft: { tokenId: "0.0.8888", serial: 7 } }, get: { asset: hbarAsset("hedera:testnet"), amount: "2500000000" }, counterparty: BOB, schedule: { memo: "trade" } },
      ctx,
    );
    expect(request.method).toBe("hedera_signAndExecuteTransaction");
    expect((await m.decode(request, ctx)).title).toBe("Schedule: trade Hedera Apes #7 for 25 HBAR with 0.0.1234");
  });
});

describe("balances & NFTs", () => {
  it("HBAR, fungible HTS tokens (incl. zero-balance associations), NFTs with HIP-412 metadata", async () => {
    const meta = b64encode(new TextEncoder().encode("ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/7.json"));
    const { fetch, calls } = mockFetch([
      [r(`/accounts/${ME}?`), mirrorAccount(ME, { balance: { balance: 123456789, timestamp: "1", tokens: [] }, max_automatic_token_associations: 10 })],
      [r(`/accounts/${ME}/tokens`), { tokens: [
        { token_id: "0.0.429274", balance: 2500000, decimals: 6, automatic_association: true, freeze_status: "UNFROZEN", kyc_status: "NOT_APPLICABLE" },
        { token_id: "0.0.731861", balance: 0, decimals: 6, automatic_association: false, freeze_status: "UNFROZEN", kyc_status: "NOT_APPLICABLE" },
        { token_id: "0.0.8888", balance: 1, decimals: 0, automatic_association: false, freeze_status: "UNFROZEN", kyc_status: "NOT_APPLICABLE" },
      ], links: { next: null } }],
      [r(`/accounts/${ME}/nfts`), { nfts: [{ token_id: "0.0.8888", serial_number: 7, account_id: ME, metadata: meta, deleted: false }], links: { next: null } }],
      [/^https:\/\/ipfs\.io\/ipfs\/bafy.*\/7\.json$/, { name: "Ape #7", image: "ipfs://bafyimage/7.png", attributes: [{ trait_type: "Fur", value: "Gold" }] }],
      ...baseRoutes(),
    ]);
    const m = createHederaModule();
    const ctx = ctxFor(makeAccount(signer.publicKeyHex, ME), fetch);
    const balances = await m.getBalances(ctx);
    expect(balances.map((b) => [b.asset.key, b.asset.symbol, b.amount])).toEqual([
      ["hbar", "HBAR", "123456789"],
      ["usdc", "USDC", "2500000"],
      ["hts:0.0.731861", "SAUCE", "0"],
    ]);
    const nfts = await m.getNfts(ctx);
    expect(nfts).toEqual([
      {
        networkId: "hedera:testnet",
        standard: "hts-nft",
        collection: { address: "0.0.8888", name: "Hedera Apes" },
        tokenId: "7",
        name: "Ape #7",
        mediaUrl: "https://ipfs.io/ipfs/bafyimage/7.png",
        attributes: [{ trait: "Fur", value: "Gold" }],
      },
    ]);
    const state = await m.getAccountState(ctx);
    expect(state).toMatchObject({ accountId: ME, maxAutoAssociations: 10, usedAutoAssociations: 1, freeAutoAssociationSlots: 9 });
    expect(calls.some((u) => u.includes("transactions=false"))).toBe(true);
  });

  it("an alias that hasn't received anything yet → zero HBAR, no NFTs", async () => {
    const { fetch } = mockFetch([]);
    const m = createHederaModule();
    const ctx = ctxFor(makeAccount(signer.publicKeyHex), fetch);
    expect(await m.getBalances(ctx)).toEqual([{ asset: hbarAsset("hedera:testnet"), amount: "0" }]);
    expect(await m.getNfts(ctx)).toEqual([]);
  });

  it("metadata URIs: ipfs, bare CID, https ok; anything else refused", () => {
    expect(metadataUri(b64encode(new TextEncoder().encode("ipfs://Qm123")))).toBe("ipfs://Qm123");
    expect(resolveUri("ipfs://ipfs/bafyabc/1.json")).toBe("https://ipfs.io/ipfs/bafyabc/1.json");
    expect(resolveUri("https://x.example/1.json")).toBe("https://x.example/1.json");
    expect(resolveUri("javascript:alert(1)")).toBeNull();
    expect(resolveUri("data:application/json,{}")).toBeNull();
  });
});

describe.runIf(process.env.LIVE === "1")("live testnet (read-only)", () => {
  it("reads the testnet USDC treasury balance through the public mirror node", async () => {
    const m = createHederaModule();
    const ctx = { network: HEDERA_TESTNET, account: { ...makeAccount(signer.publicKeyHex), hederaAccountId: "0.0.5176" }, fetch };
    const balances = await m.getBalances(ctx);
    expect(balances[0]!.asset.key).toBe("hbar");
    expect(balances.some((b) => b.asset.key === "usdc")).toBe(true);
  }, 30_000);
});

function hexBytes(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
}
