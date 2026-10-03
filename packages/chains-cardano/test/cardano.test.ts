import type { DappRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import {
  CARDANO_METHODS,
  CARDANO_NETWORKS,
  CARDANO_PREPROD,
  CborMap,
  PROOF_GENERATION_MESSAGE,
  addressToBytes,
  createCardanoModule,
  decodeCbor,
  encodeCbor,
  feeFor,
  parseTransaction,
  sigStructure,
  splitArray,
} from "../src/index.js";
import { addWitnesses } from "../src/tx.js";
import { fromHex, hex } from "../src/util.js";
import { NFT_NAME, PARAMS, TOKEN_NAME, TX_A, ctxFor, dappTx, fixtureSigner, koiosUtxo, makeAccount, mockKoios, standardRoutes } from "./helpers.js";
import { FIX, SIGS } from "./signatures.js";

const account = makeAccount(FIX);
const ALL_SIGS = Object.values(SIGS);

function setup(extra: Parameters<typeof standardRoutes>[1] = []) {
  const k = mockKoios(standardRoutes(FIX, extra));
  return { m: createCardanoModule(), ctx: ctxFor(account, k.fetch), calls: k.calls };
}

const req = (method: string, params: unknown, id = "r1", origin = "https://dapp.example"): DappRequest => ({
  id,
  origin,
  via: "injected",
  family: "cardano",
  networkId: CARDANO_PREPROD.id,
  method,
  params,
});

describe("networks and addresses", () => {
  it("uses CIP-34 chain ids", () => {
    expect(CARDANO_NETWORKS.map((n) => n.id).sort()).toEqual(["cip34:0-1", "cip34:0-2", "cip34:1-764824073"]);
    expect(CARDANO_PREPROD.testnet).toBe(true);
    expect(CARDANO_PREPROD.nativeAsset).toMatchObject({ key: "ada", decimals: 6 });
  });

  it("derives the base address from payment ‖ stake keys and an enterprise address from the payment key alone", () => {
    const { m } = setup();
    const both = new Uint8Array([...fromHex(FIX.paymentPub), ...fromHex(FIX.stakePub)]);
    expect(m.addressFromPublicKey(both, CARDANO_PREPROD)).toBe(FIX.address);
    expect(m.addressFromPublicKey(fromHex(FIX.paymentPub), CARDANO_PREPROD)).toMatch(/^addr_test1v/);
    expect(m.derivationPath(3)).toBe("m/1852'/1815'/3'/0/0");
    expect(m.curve).toBe("bip32-ed25519");
  });

  it("recognises payment addresses and picks networks by address network id", () => {
    const { m } = setup();
    expect(m.isAddress(FIX.address)).toBe(true);
    expect(m.isAddress(FIX.bob)).toBe(true);
    expect(m.isAddress(FIX.rewardAddress)).toBe(false);
    expect(m.isAddress("DQiaMPLWF8392SQYSLxXziw4UXBotXwPg6we92KacyEM")).toBe(false);
    expect(m.networksForAddress(FIX.address, CARDANO_NETWORKS).map((n) => n.id).sort()).toEqual(["cip34:0-1", "cip34:0-2"]);
  });
});

describe("CBOR", () => {
  it("round-trips Cardano shapes, bignums and keeps raw spans", () => {
    const v = [1n, -5n, 2n ** 70n, new Uint8Array([1, 2]), "hi", new CborMap([[0, true]]), null];
    const bytes = encodeCbor(v);
    const back = decodeCbor(bytes) as unknown[];
    expect(back[0]).toBe(1);
    expect(back[1]).toBe(-5);
    expect(back[2]).toBe(2n ** 70n);
    expect(splitArray(bytes).items.map(hex)[4]).toBe("626869");
    // indefinite array of indefinite bytes
    expect(decodeCbor(fromHex("9f5f4201024103ff80ff"))).toEqual([new Uint8Array([1, 2, 3]), []]);
    expect(() => decodeCbor(fromHex("8201"))).toThrow();
  });
});

describe("signTx (CIP-30)", () => {
  const txHex = hex(dappTx(FIX, addressToBytes));

  it("refuses when other signatures are needed and partialSign is false (TxSignError.ProofGeneration)", async () => {
    const { m, ctx } = setup();
    await expect(m.decode(req(CARDANO_METHODS.signTx, [txHex, false]), ctx)).rejects.toMatchObject({ userMessage: PROOF_GENERATION_MESSAGE, code: "cardano/proof-generation" });
  });

  it("describes inputs, outputs, mint and metadata in plain words with partialSign", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(req(CARDANO_METHODS.signTx, { tx: txHex, partialSign: true }), ctx);
    expect(d.title).toBe(`Send 4 ADA and 2 CLIP to ${FIX.bob.slice(0, 12)}…${FIX.bob.slice(-6)}`);
    const lines = Object.fromEntries(d.lines.map((l) => [l.label, l.value]));
    expect(lines["Creates"]).toBe("1 Clip #1");
    expect(lines["Message"]).toBe("Thanks for the coffee");
    expect(lines["Network fee"]).toBe("0.2 ADA");
    expect(lines["Also needs"]).toBe("1 other signature");
    expect(d.fee).toMatchObject({ amount: "200000" });
    const deltas = Object.fromEntries(d.balanceChanges.map((c) => [c.asset.symbol, c.delta]));
    expect(deltas).toEqual({ ADA: "-3000000", CLIP: "-2", "Clip #1": "1" });
    expect(d.balanceChanges.find((c) => c.asset.symbol === "CLIP")!.asset).toMatchObject({ key: `cnt:${FIX.policy}${TOKEN_NAME}`, address: FIX.policy + TOKEN_NAME });
    expect(d.blind).toBe(false);
    expect(d.simulated).toBe(true);
  });

  it("signs the body hash with the payment key and returns only its witness set", async () => {
    const { m, ctx } = setup();
    const r = req(CARDANO_METHODS.signTx, [txHex, true]);
    await m.decode(r, ctx);
    const payloads = await m.prepare(r, ctx, "a1");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ scheme: "ed25519", approvalId: "a1", accountId: "cardano:0" });
    expect(payloads[0]!.derivationSubPath).toBeUndefined();
    expect(hex(payloads[0]!.bytes)).toBe(hex(parseTransaction(fromHex(txHex)).bodyHash));
    const signer = fixtureSigner(FIX, ALL_SIGS);
    const ws = (await m.finalize(r, payloads.map((p) => signer.sign(p)), ctx)) as string;
    const decoded = decodeCbor(fromHex(ws)) as CborMap;
    const vkeys = decoded.get(0) as Uint8Array[][];
    expect(vkeys).toHaveLength(1);
    expect(hex(vkeys[0]![0]!)).toBe(FIX.paymentPub);
    expect(hex(vkeys[0]![1]!)).toBe(SIGS.dappTxSig);
  });

  it("rejects a signature from the wrong key", async () => {
    const { m, ctx } = setup();
    const r = req(CARDANO_METHODS.signTx, [txHex, true]);
    const [p] = await m.prepare(r, ctx, "a1");
    await expect(m.finalize(r, [{ scheme: "ed25519", bytes: fromHex(SIGS.transferSig), publicKey: FIX.paymentPub }], ctx)).rejects.toMatchObject({ code: "cardano/bad-signature" });
    expect(p).toBeDefined();
  });

  it("adds witnesses without touching the body or auxiliary data bytes", () => {
    const tx = parseTransaction(dappTx(FIX, addressToBytes));
    const signed = parseTransaction(addWitnesses(tx, [{ publicKey: fromHex(FIX.paymentPub), signature: fromHex(SIGS.dappTxSig) }]));
    expect(hex(signed.bodyRaw)).toBe(hex(tx.bodyRaw));
    expect(hex(signed.auxRaw!)).toBe(hex(tx.auxRaw!));
    expect((signed.witness.get(0) as unknown[]).length).toBe(1);
  });

  it("flags a transaction for another Cardano network", async () => {
    const { m, ctx } = setup();
    const mainnetCtx = { ...ctx, network: CARDANO_NETWORKS.find((n) => n.id === "cip34:1-764824073")! };
    await expect(m.decode(req(CARDANO_METHODS.signTx, [txHex, true]), mainnetCtx)).resolves.toMatchObject({
      warnings: expect.arrayContaining([expect.objectContaining({ code: "network-matters", level: "danger" })]),
    });
  });

  it("refuses a transaction that doesn't need this wallet", async () => {
    const { m, ctx } = setup([["POST", "/utxo_info", () => [koiosUtxo(TX_A, 0, FIX.otherAddress, 10_000_000n)]]]);
    await expect(m.decode(req(CARDANO_METHODS.signTx, [txHex, true]), ctx)).rejects.toMatchObject({ code: "cardano/proof-generation" });
  });
});

describe("signData (CIP-8 / CIP-30)", () => {
  const payload = hex(new TextEncoder().encode("Sign in to example.org"));

  it("shows the text and returns COSE_Sign1 + COSE_Key signed by the payment key", async () => {
    const { m, ctx } = setup();
    const r = req(CARDANO_METHODS.signData, [FIX.address, payload]);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Sign a message for dapp.example");
    expect(d.lines[0]).toEqual({ label: "Message", value: "Sign in to example.org" });
    const [p] = await m.prepare(r, ctx, "a2");
    expect(p!.derivationSubPath).toBeUndefined();
    expect(hex(p!.bytes)).toBe(hex(sigStructure(addressToBytes(FIX.address), fromHex(payload))));
    const out = (await m.finalize(r, [fixtureSigner(FIX, ALL_SIGS).sign(p!)], ctx)) as { signature: string; key: string };
    const sign1 = decodeCbor(fromHex(out.signature)) as unknown[];
    expect(sign1).toHaveLength(4);
    const prot = decodeCbor(sign1[0] as Uint8Array) as CborMap;
    expect(prot.get(1)).toBe(-8);
    expect(hex(prot.get("address") as Uint8Array)).toBe(hex(addressToBytes(FIX.address)));
    expect((sign1[1] as CborMap).get("hashed")).toBe(false);
    expect(hex(sign1[3] as Uint8Array)).toBe(SIGS.dataSig);
    const key = decodeCbor(fromHex(out.key)) as CborMap;
    expect([key.get(1), key.get(3), key.get(-1), hex(key.get(-2) as Uint8Array)]).toEqual([1, -8, 6, FIX.paymentPub]);
  });

  it("uses the stake key for the reward address (hex or bech32)", async () => {
    const { m, ctx } = setup();
    const r = req(CARDANO_METHODS.signData, { address: hex(addressToBytes(FIX.rewardAddress)), payload });
    const [p] = await m.prepare(r, ctx, "a3");
    expect(p).toMatchObject({ derivationSubPath: "2/0" });
    const out = (await m.finalize(r, [fixtureSigner(FIX, ALL_SIGS).sign(p!)], ctx)) as { signature: string; key: string };
    expect(hex((decodeCbor(fromHex(out.key)) as CborMap).get(-2) as Uint8Array)).toBe(FIX.stakePub);
  });

  it("refuses foreign addresses and transactions disguised as messages", async () => {
    const { m, ctx } = setup();
    await expect(m.decode(req(CARDANO_METHODS.signData, [FIX.bob, payload]), ctx)).rejects.toMatchObject({ code: "cardano/proof-generation" });
    const tx = hex(dappTx(FIX, addressToBytes));
    await expect(m.decode(req(CARDANO_METHODS.signData, [FIX.address, tx]), ctx)).rejects.toMatchObject({ code: "cardano/message-is-transaction" });
  });

  it("marks binary payloads blind", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(req(CARDANO_METHODS.signData, [FIX.address, "00ff10"]), ctx);
    expect(d.blind).toBe(true);
    expect(d.warnings[0]!.code).toBe("blind-signing");
  });
});

describe("buildTransfer", () => {
  it("builds an ADA payment with change, a fee at least the ledger minimum, and submits after signing", async () => {
    const submitted: Uint8Array[] = [];
    const { m, ctx } = setup([
      [
        "POST",
        "/submittx",
        (b: Uint8Array) => {
          submitted.push(b);
          return hex(parseTransaction(b).bodyHash);
        },
      ],
    ]);
    const r = await m.buildTransfer({ asset: CARDANO_PREPROD.nativeAsset, to: FIX.bob, amount: "2000000" }, ctx);
    expect(r.method).toBe(CARDANO_METHODS.signAndSubmitTx);
    const tx = parseTransaction(fromHex((r.params as { tx: string }).tx));
    expect(tx.body.ttl).toBe(BigInt(FIX.slot + 7200));
    expect(tx.body.outputs).toHaveLength(2);
    expect(tx.body.outputs[1]!.value.assets.get(FIX.policy + TOKEN_NAME)).toBe(5n); // tokens stay in change
    const d = await m.decode(r, ctx);
    expect(d.title).toMatch(/^Send 2 ADA to addr_test1vz/);
    expect(d.balanceChanges).toEqual([expect.objectContaining({ delta: "-2000000" })]);
    const payloads = await m.prepare(r, ctx, "a4");
    const sigs = payloads.map((p) => fixtureSigner(FIX, ALL_SIGS).sign(p));
    const out = (await m.finalize(r, sigs, ctx)) as { txHash: string };
    expect(out.txHash).toBe(hex(tx.bodyHash));
    const signed = parseTransaction(submitted[0]!);
    expect(signed.bodyRaw).toEqual(tx.bodyRaw);
    expect(tx.body.fee).toBeGreaterThanOrEqual(feeFor(submitted[0]!.length, PARAMS));
    // value is conserved: inputs = outputs + fee
    const outSum = tx.body.outputs.reduce((a, o) => a + o.value.coin, 0n);
    expect(outSum + tx.body.fee).toBe(10_000_000n);
  });

  it("sends a native token with the minimum ADA attached", async () => {
    const { m, ctx } = setup();
    const asset = { key: "cnt:x", symbol: "CLIP", name: "Clip", decimals: 0, networkId: CARDANO_PREPROD.id, address: FIX.policy + TOKEN_NAME };
    const r = await m.buildTransfer({ asset, to: FIX.bob, amount: "2" }, ctx);
    const tx = parseTransaction(fromHex((r.params as { tx: string }).tx));
    const [toBob] = tx.body.outputs;
    expect(toBob!.value.assets.get(FIX.policy + TOKEN_NAME)).toBe(2n);
    expect(toBob!.value.coin).toBeGreaterThan(900_000n);
    expect(toBob!.value.coin).toBeLessThan(1_300_000n);
    const d = await m.decode(r, ctx);
    expect(d.title).toMatch(/ADA and 2 CLIP to addr_test1vz/);
    const sig = fixtureSigner(FIX, ALL_SIGS).sign((await m.prepare(r, ctx, "x"))[0]!);
    expect(hex(sig.bytes)).toBe(SIGS.tokenTransferSig);
  });

  it("refuses amounts below the minimum, other networks and bad addresses", async () => {
    const { m, ctx } = setup();
    await expect(m.buildTransfer({ asset: CARDANO_PREPROD.nativeAsset, to: FIX.bob, amount: "1" }, ctx)).rejects.toMatchObject({ code: "cardano/below-min-utxo" });
    await expect(m.buildTransfer({ asset: CARDANO_PREPROD.nativeAsset, to: FIX.rewardAddress, amount: "2000000" }, ctx)).rejects.toMatchObject({ code: "cardano/bad-address" });
    await expect(m.buildTransfer({ asset: CARDANO_PREPROD.nativeAsset, to: FIX.bob, amount: "99000000" }, ctx)).rejects.toMatchObject({ code: "cardano/insufficient-funds" });
  });
});

describe("staking", () => {
  it("reads delegation status and rewards", async () => {
    const { m, ctx } = setup([
      ["POST", "/account_info", () => [{ stake_address: FIX.rewardAddress, status: "registered", delegated_pool: FIX.pool, delegated_drep: "drep_always_abstain", total_balance: "1", rewards_available: "4200000" }]],
    ]);
    await expect(m.getStaking(ctx)).resolves.toEqual({
      rewardAddress: FIX.rewardAddress,
      registered: true,
      pool: { id: FIX.pool, ticker: "CLIP", name: "Clip Pool" },
      rewardsAvailable: "4200000",
      drep: "drep_always_abstain",
    });
  });

  it("builds registration + delegation, describes it, and needs both payment and stake signatures", async () => {
    const { m, ctx } = setup([["POST", "/submittx", (b: Uint8Array) => hex(parseTransaction(b).bodyHash)]]);
    const r = await m.buildDelegate({ poolId: FIX.pool }, ctx);
    const tx = parseTransaction(fromHex((r.params as { tx: string }).tx));
    expect(tx.body.certs.map((c) => c.type)).toEqual([0, 2]);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Stake your ADA with [CLIP]");
    expect(d.lines).toContainEqual({ label: "Deposit", value: "2 ADA (you get it back when you stop staking)" });
    const payloads = await m.prepare(r, ctx, "a5");
    expect(payloads.map((p) => p.derivationSubPath)).toEqual([undefined, "2/0"]);
    const sigs = payloads.map((p) => fixtureSigner(FIX, ALL_SIGS).sign(p));
    expect(sigs.map((s) => hex(s.bytes))).toEqual([SIGS.delegatePaymentSig, SIGS.delegateStakeSig]);
    await expect(m.finalize(r, sigs, ctx)).resolves.toEqual({ txHash: hex(tx.bodyHash) });
    // swapped roles are rejected
    await expect(m.finalize(r, [sigs[1]!, sigs[0]!], ctx)).rejects.toMatchObject({ code: "cardano/bad-signature" });
  });
});

describe("balances, NFTs and CIP-30 reads", () => {
  const nftRoutes: Parameters<typeof standardRoutes>[1] = [
    ["POST", "/address_utxos", () => [koiosUtxo(TX_A, 0, FIX.address, 10_000_000n, [[FIX.policy, TOKEN_NAME, 5n], [FIX.policy, NFT_NAME, 1n]])]],
  ];

  it("returns ADA and fungible tokens; NFTs (CIP-68) separately with untrusted media", async () => {
    const { m, ctx } = setup(nftRoutes);
    const b = await m.getBalances(ctx);
    expect(b.map((x) => [x.asset.symbol, x.amount])).toEqual([
      ["ADA", "10000000"],
      ["CLIP", "5"],
    ]);
    const nfts = await m.getNfts(ctx);
    expect(nfts).toEqual([
      {
        networkId: CARDANO_PREPROD.id,
        standard: "cip68",
        collection: { address: FIX.policy, name: `Policy ${FIX.policy.slice(0, 8)}…` },
        tokenId: FIX.policy + NFT_NAME,
        name: "Clip #1",
        mediaUrl: "ipfs://QmClip",
        attributes: [{ trait: "rarity", value: "rare" }],
      },
    ]);
  });

  it("answers getBalance, getUtxos (amount + paginate), addresses and network id", async () => {
    const { m, ctx } = setup();
    const bal = decodeCbor(fromHex((await m.read("cardano_getBalance", [], ctx)) as string)) as unknown[];
    expect(bal[0]).toBe(13_000_000);
    const all = (await m.read("cardano_getUtxos", [], ctx)) as string[];
    expect(all).toHaveLength(2);
    const [input] = decodeCbor(fromHex(all[0]!)) as unknown[][];
    expect(hex(input![0] as Uint8Array)).toBe(TX_A);
    const amount = hex(encodeCbor(12_000_000));
    expect(await m.read("cardano_getUtxos", [amount], ctx)).toHaveLength(2);
    expect(await m.read("cardano_getUtxos", [hex(encodeCbor(50_000_000))], ctx)).toBeNull();
    expect(await m.read("cardano_getUtxos", [undefined, { page: 1, limit: 1 }], ctx)).toHaveLength(1);
    expect(await m.read("cardano_getChangeAddress", [], ctx)).toBe(hex(addressToBytes(FIX.address)));
    expect(await m.read("cardano_getUsedAddresses", [], ctx)).toEqual([hex(addressToBytes(FIX.address))]);
    expect(await m.read("cardano_getUnusedAddresses", [], ctx)).toEqual([]);
    expect(await m.read("cardano_getRewardAddresses", [], ctx)).toEqual([hex(addressToBytes(FIX.rewardAddress))]);
    expect(await m.read("cardano_getNetworkId", [], ctx)).toBe(0);
    expect(await m.read("cardano_getCollateral", [{ amount: "3000000" }], ctx)).toHaveLength(1);
  });

  it("submitTx forwards raw CBOR and maps ledger errors to plain words", async () => {
    const { m, ctx } = setup([["POST", "/submittx", () => new Response("ConwayUtxowFailure (BadInputsUTxO ...)", { status: 400 })]]);
    const tx = hex(dappTx(FIX, addressToBytes));
    await expect(m.read("cardano_submitTx", [tx], ctx)).rejects.toMatchObject({ userMessage: expect.stringMatching(/already spent/) });
  });
});
