import { ClipError, WALLET_ORIGIN } from "@clip-wallet/core";
import { InputType, OutputType, ScriptTransactionRequest, Signer, hashMessage as fuelsHashMessage, transactionRequestify } from "fuels";
import { describe, expect, it } from "vitest";
import { FUEL_MAINNET, FUEL_METHODS, createFuelModule, encodeScriptTx, parseTransactionRequest, requiredMaxFee } from "../src/index.js";
import { gqlFor } from "../src/gql.js";
import { hex } from "../src/util.js";
import { ACCOUNT0, CHAIN, CONTRACT, ETH, ME, OTHER, SIG, TEXT_MESSAGE, TRANSFER_ID, TRANSFER_TX, USDC_TESTNET } from "./fixtures.js";
import { ctxFor, fakeNode, req, sig } from "./helpers.js";

const mod = createFuelModule({ pollMs: 0 });
const send = (tx: unknown, over = {}) => req(FUEL_METHODS.sendTransaction, { address: ACCOUNT0.address, transaction: tx, ...over });
const clip = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ClipError);
  expect((e as ClipError).code).toBe(code);
  return e as ClipError;
};

/** A script that calls a contract, forwarding 1000 ETH units (fuels-ts ScriptTransactionRequest, JSON as sent). */
function contractCall(over: { changeTo?: string; predicate?: boolean } = {}) {
  const r = new ScriptTransactionRequest({ gasLimit: 250_000, maxFee: 9_000, script: "0x724028c0724428985d451000724828a02d41148a24040000", scriptData: "0x00000000000003e8" });
  r.inputs.push({
    type: InputType.Coin,
    id: `0x${"33".repeat(32)}0001`,
    owner: over.predicate ? OTHER : ME,
    amount: 1_669_864,
    assetId: ETH,
    txPointer: "0x00000000000000000000000000000000",
    witnessIndex: 0,
    ...(over.predicate ? { predicate: "0x1a40500091000020", predicateData: "0x" } : {}),
  } as never);
  if (over.predicate) {
    r.inputs.push({ type: InputType.Coin, id: `0x${"34".repeat(32)}0000`, owner: ME, amount: 10, assetId: ETH, txPointer: "0x00", witnessIndex: 0 } as never);
  }
  r.inputs.push({ type: InputType.Contract, contractId: CONTRACT, txPointer: "0x00000000000000000000000000000000" } as never);
  r.outputs.push({ type: OutputType.Contract, inputIndex: over.predicate ? 2 : 1 } as never);
  r.outputs.push({ type: OutputType.Variable } as never);
  r.outputs.push({ type: OutputType.Change, to: over.changeTo ?? ME, assetId: ETH } as never);
  r.witnesses.push(new Uint8Array(64));
  return JSON.parse(JSON.stringify(r));
}

const receipts = [
  { receiptType: "CALL", id: null, to: CONTRACT, amount: "1000", assetId: ETH },
  { receiptType: "TRANSFER_OUT", id: CONTRACT, toAddress: ME, amount: "5000000", assetId: USDC_TESTNET },
  { receiptType: "RETURN", id: CONTRACT },
  { receiptType: "SCRIPT_RESULT", result: "0", gasUsed: "41000" },
];
const dryOk = (r = receipts) => ({ dryRun: [{ id: "0x01", status: { type: "DryRunSuccessStatus", totalGas: "50000", totalFee: "100" }, receipts: r }] });

describe("decode", () => {
  it("reads a wallet-built ETH transfer without touching the network", async () => {
    const node = fakeNode({});
    const d = await mod.decode(send(TRANSFER_TX, {}), ctxFor(node.fetch));
    expect(node.calls).toEqual([]);
    expect(d.title).toBe("Send 0.000000001 ETH to 0x033d…5e17");
    expect(d.titleMsg?.id).toBe("bg.req.sendTo");
    expect(d.lines).toEqual([
      { label: "To", value: `${OTHER} (0.000000001 ETH)` },
      { label: "Network fee at most", value: "0.000000168 ETH" },
    ]);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "eth-testnet", symbol: "ETH" }), delta: "-1" }]);
    expect(d.fee).toMatchObject({ amount: "168", asset: { symbol: "ETH" } });
    expect(d).toMatchObject({ blind: false, simulated: false, warnings: [] });
  });

  it("dry-runs a contract call and shows what moves from the receipts", async () => {
    const node = fakeNode({ dryRun: (v) => (expect(v.v).toBe(false), expect(v.p).toBe("0"), dryOk()) });
    const d = await mod.decode(send(contractCall()), ctxFor(node.fetch));
    expect(node.calls.map((c) => c.op)).toEqual(["dryRun"]);
    expect(d.title).toBe("Approve a smart contract action for app.example");
    expect(d.simulated).toBe(true);
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([
      { asset: expect.objectContaining({ key: "eth-testnet" }), delta: "-1000" },
      { asset: expect.objectContaining({ key: "usdc.e", symbol: "USDC" }), delta: "5000000" },
    ]);
    expect(d.lines).toContainEqual({ label: "Contract", value: CONTRACT });
    expect(d.warnings.map((w) => w.code)).toEqual(["unknown-call"]);
  });

  it("is blind when the dry run fails, and when it can't run", async () => {
    const failed = fakeNode({ dryRun: { dryRun: [{ id: "0x01", status: { type: "DryRunFailureStatus", totalGas: "1", totalFee: "1", reason: "Revert(123)" }, receipts: [] }] } });
    const d = await mod.decode(send(contractCall()), ctxFor(failed.fetch));
    expect(d).toMatchObject({ blind: true, simulated: false, balanceChanges: [] });
    expect(d.warnings[0]).toMatchObject({ code: "simulation-failed", level: "danger" });
    expect(d.warnings[0]!.message).not.toContain("Revert");
    const offline = fakeNode({ dryRun: { errors: [{ message: "boom" }] } });
    expect((await mod.decode(send(contractCall()), ctxFor(offline.fetch))).blind).toBe(true);
    expect((await createFuelModule({ simulate: false }).decode(send(contractCall()), ctxFor(offline.fetch))).blind).toBe(true);
  });

  it("is blind for predicates and for transactions that aren't scripts", async () => {
    const node = fakeNode({ dryRun: dryOk() });
    const p = await mod.decode(send(contractCall({ predicate: true })), ctxFor(node.fetch));
    expect(p.blind).toBe(true);
    expect(p.warnings[0]!.code).toBe("blind-signing");
    const create = await mod.decode(send({ type: 1, bytecodeWitnessIndex: 0, inputs: [], outputs: [], witnesses: [] }), ctxFor(node.fetch));
    expect(create).toMatchObject({ blind: true, title: "Approve a transaction for app.example" });
  });

  it("warns in red when the change goes to someone else", async () => {
    const node = fakeNode({ dryRun: dryOk() });
    const d = await mod.decode(send(contractCall({ changeTo: OTHER })), ctxFor(node.fetch));
    const w = d.warnings.find((x) => x.msg?.id === "bg.fuel.changeToOther");
    expect(w).toMatchObject({ level: "danger", message: "Everything left of your ETH after this goes to 0x033d…5e17, not back to you." });
    expect(d.balanceChanges.find((c) => c.asset.symbol === "ETH")?.delta).toBe("-1669864");
  });

  it("warns when nothing returns the leftover", async () => {
    const tx = { ...TRANSFER_TX, outputs: [TRANSFER_TX.outputs[0]] };
    const d = await mod.decode(send(tx), ctxFor(fakeNode({}).fetch));
    expect(d.warnings.find((w) => w.msg?.id === "bg.fuel.leftoverLost")?.message).toBe("0.001669695 ETH isn't sent anywhere by this transaction and would be lost.");
  });

  it("refuses the wrong network, another account, other signers and junk", async () => {
    const ctx = ctxFor(fakeNode({}).fetch);
    await clip(mod.decode(send(TRANSFER_TX, {}), ctxFor(fakeNode({}).fetch, FUEL_MAINNET)), "fuel/network-mismatch");
    await clip(mod.decode(req(FUEL_METHODS.sendTransaction, { transaction: TRANSFER_TX }, { networkId: "fuel:9889" }), ctx), "fuel/network-mismatch");
    await clip(mod.decode(send(TRANSFER_TX, { provider: { url: "https://mainnet.fuel.network/v1/graphql" } }), ctx), "fuel/network-mismatch");
    await clip(mod.decode(req(FUEL_METHODS.sendTransaction, { address: OTHER, transaction: TRANSFER_TX }), ctx), "fuel/not-your-account");
    const theirs = { ...TRANSFER_TX, inputs: [{ ...TRANSFER_TX.inputs[0], owner: OTHER }] };
    await clip(mod.decode(send(theirs), ctx), "fuel/not-a-signer");
    await clip(mod.decode(send({ ...TRANSFER_TX, witnesses: [] }), ctx), "fuel/malformed");
    await clip(mod.decode(send("{"), ctx), "fuel/malformed");
    await clip(mod.decode(req("fuel_signTypedData", {}), ctx), "fuel/unsupported-method");
  });

  it("says who gets a transaction that is only signed", async () => {
    const d = await mod.decode(req(FUEL_METHODS.signTransaction, { address: ACCOUNT0.address, transaction: TRANSFER_TX }), ctxFor(fakeNode({}).fetch));
    expect(d.lines.at(-1)).toEqual({ label: "Sent by", value: "app.example (it gets the signed transaction)" });
  });

  it("shows messages as text, and refuses unreadable plain strings", async () => {
    const ctx = ctxFor(fakeNode({}).fetch);
    const t = await mod.decode(req(FUEL_METHODS.signMessage, { address: ACCOUNT0.address, message: { text: TEXT_MESSAGE } }), ctx);
    expect(t).toMatchObject({ title: "Sign a message for app.example", lines: [{ label: "Message", value: TEXT_MESSAGE }], blind: false, warnings: [] });
    const raw = await mod.decode(req(FUEL_METHODS.signMessage, { message: { text: "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tx" } }), ctx);
    expect(raw.blind).toBe(true);
    const bytes = await mod.decode(req(FUEL_METHODS.signMessage, { message: { personalSignHex: "0xdeadbeef" } }), ctx);
    expect(bytes).toMatchObject({ blind: false, lines: [{ label: "Message (not text)", value: "0xdeadbeef" }] });
    expect(bytes.warnings[0]!.code).toBe("blind-signing");
  });
});

describe("prepare", () => {
  it("signs the transaction id and fuels-ts' message hash", async () => {
    const ctx = ctxFor(fakeNode({}).fetch);
    const [p] = await mod.prepare(send(TRANSFER_TX), ctx, "ap1");
    expect(p).toMatchObject({ accountId: "fuel:0", scheme: "ecdsa-secp256k1", approvalId: "ap1" });
    expect(`0x${hex(p!.bytes)}`).toBe(transactionRequestify(TRANSFER_TX as never).getTransactionId(0));
    const [m] = await mod.prepare(req(FUEL_METHODS.signMessage, { message: TEXT_MESSAGE }), ctx, "ap2");
    expect(`0x${hex(m!.bytes)}`).toBe(fuelsHashMessage(TEXT_MESSAGE));
  });
});

describe("finalize", () => {
  const status = (s: unknown) => [{ data: { submitAndAwaitStatus: { type: "SubmittedStatus" } } }, { data: { submitAndAwaitStatus: s } }];

  it("puts a fuels-ts compact signature in the witness and submits", async () => {
    let submitted = "";
    const node = fakeNode({}, (v) => ((submitted = v.tx), status({ type: "SuccessStatus", transactionId: TRANSFER_ID })));
    const id = await mod.finalize(send(TRANSFER_TX), [sig(SIG.transfer)], ctxFor(node.fetch));
    expect(id).toBe(TRANSFER_ID);
    expect(node.calls.map((c) => c.url)).toEqual(["https://testnet.fuel.network/v1/graphql-sub"]);
    const witness = submitted.slice(-128);
    expect(Signer.recoverAddress(TRANSFER_ID, `0x${witness}`).toString()).toBe(ACCOUNT0.address);
    const p = parseTransactionRequest(TRANSFER_TX);
    if (p.kind !== "script") throw new Error();
    expect(submitted.slice(0, -128)).toBe(`0x${hex(encodeScriptTx(p.tx)).slice(0, -128)}`);
  });

  it("refuses a bad signature before anything is sent", async () => {
    const node = fakeNode({}, status({ type: "SuccessStatus" }));
    const ctx = ctxFor(node.fetch);
    await clip(mod.finalize(send(TRANSFER_TX), [sig(SIG.other)], ctx), "fuel/bad-signature");
    await clip(mod.finalize(send(TRANSFER_TX), [sig(SIG.transfer, 0)], ctx), "fuel/bad-signature");
    await clip(mod.finalize(send(TRANSFER_TX), [{ ...sig(SIG.transfer), scheme: "ed25519" }], ctx), "fuel/bad-signature");
    await clip(mod.finalize(send(TRANSFER_TX), [], ctx), "fuel/bad-signature");
    expect(node.calls).toEqual([]);
  });

  it("finds the recovery id when the signer leaves it out", async () => {
    const node = fakeNode({}, status({ type: "SuccessStatus" }));
    expect(await mod.finalize(send(TRANSFER_TX), [sig(SIG.transfer, undefined)], ctxFor(node.fetch))).toBe(TRANSFER_ID);
  });

  it("returns the signed request for fuel_signTransaction", async () => {
    const node = fakeNode({});
    const out = (await mod.finalize(req(FUEL_METHODS.signTransaction, { transaction: TRANSFER_TX }), [sig(SIG.transfer)], ctxFor(node.fetch))) as Record<string, unknown>;
    expect(node.calls).toEqual([]);
    const signed = transactionRequestify(out as never);
    expect(signed.getTransactionId(0)).toBe(TRANSFER_ID);
    expect(Signer.recoverAddress(TRANSFER_ID, signed.witnesses[0] as string).toString()).toBe(ACCOUNT0.address);
  });

  it("returns a message signature that fuels-ts Signer.recoverAddress accepts", async () => {
    const ctx = ctxFor(fakeNode({}).fetch);
    const cases: [unknown, { rs: string; recovery: number }, string][] = [
      [TEXT_MESSAGE, SIG.text, fuelsHashMessage(TEXT_MESSAGE)],
      [{ personalSign: "Hello Fuel" }, SIG.personal, fuelsHashMessage({ personalSign: "Hello Fuel" })],
      [{ personalSignHex: "0xdeadbeef" }, SIG.personalHex, fuelsHashMessage({ personalSign: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) })],
    ];
    for (const [message, s, digest] of cases) {
      const out = (await mod.finalize(req(FUEL_METHODS.signMessage, { message }), [sig(s)], ctx)) as string;
      expect(out).toMatch(/^0x[0-9a-f]{128}$/);
      expect(Signer.recoverAddress(digest, out).toString()).toBe(ACCOUNT0.address);
    }
  });

  it("says in plain words when the network refuses or the transaction fails", async () => {
    const failed = fakeNode({}, status({ type: "FailureStatus", reason: "Revert(0)" }));
    const e = await clip(mod.finalize(send(TRANSFER_TX), [sig(SIG.transfer)], ctxFor(failed.fetch)), "fuel/failed");
    expect(e.userMessage).toBe("This transaction failed on the Fuel network. Only the network fee was spent.");
    const fee = fakeNode({}, [{ data: null, errors: [{ message: "InsufficientMaxFee { max_fee_from_policies: 1, max_fee_from_gas_price: 28 }" }] }]);
    const e2 = await clip(mod.finalize(send(TRANSFER_TX), [sig(SIG.transfer)], ctxFor(fee.fetch)), "fuel/fee-too-low");
    expect(e2.userMessage).not.toContain("InsufficientMaxFee");
    const spent = fakeNode({}, [{ data: null, errors: [{ message: "Transaction validity: Validity(UtxoNotFound(0xb9…))" }] }]);
    await clip(mod.finalize(send(TRANSFER_TX), [sig(SIG.transfer)], ctxFor(spent.fetch)), "fuel/coins-spent");
  });

  it("polls when the status stream ends after the transaction was accepted", async () => {
    let polls = 0;
    const node = fakeNode({ getTransaction: () => ({ transaction: { status: { type: ++polls < 2 ? "SubmittedStatus" : "SuccessStatus" } } }) }, [{ data: { submitAndAwaitStatus: { type: "SubmittedStatus" } } }]);
    expect(await mod.finalize(send(TRANSFER_TX), [sig(SIG.transfer)], ctxFor(node.fetch))).toBe(TRANSFER_ID);
    expect(polls).toBe(2);
  });
});

describe("buildTransfer", () => {
  const coin = (amount: string, assetId = ETH, n = 1) => ({ __typename: "Coin", utxoId: `0x${"b9".repeat(32)}000${n}`, amount, assetId, owner: ME });

  function node(coins: (v: Record<string, any>) => unknown) {
    return fakeNode({
      getChain: CHAIN(0),
      estimateGasPrice: { estimateGasPrice: { gasPrice: "5188" } },
      getCoinsToSpend: (v) => coins(v),
      dryRun: (v) => (expect(v.p).toBe("0"), dryOk([{ receiptType: "RETURN" }, { receiptType: "SCRIPT_RESULT", result: "0", gasUsed: "64" }] as never)),
    });
  }

  it("builds an ETH send from the account's coins with a fee the node accepts", async () => {
    const n = node((v) => (expect(v.owner).toBe(ME), { coinsToSpend: [[coin("1669864")]] }));
    const ctx = ctxFor(n.fetch);
    const r = await mod.buildTransfer({ asset: ctx.network.nativeAsset, to: OTHER, amount: "250" }, ctx);
    expect(r).toMatchObject({ origin: WALLET_ORIGIN, family: "fuel", networkId: "fuel:0", method: FUEL_METHODS.sendTransaction });
    const tx = (r.params as { transaction: Record<string, any> }).transaction;
    expect(tx.gasLimit).toBe("0x40");
    expect(tx.script).toBe("0x24000000");
    expect(tx.outputs).toEqual([
      { type: 0, to: OTHER, amount: "0xfa", assetId: ETH },
      { type: 2, to: ME, assetId: ETH },
    ]);
    const p = parseTransactionRequest(tx);
    if (p.kind !== "script") throw new Error();
    const chain = await gqlFor(ctx).chainInfo();
    expect(BigInt(tx.maxFee)).toBe(requiredMaxFee(p.tx, chain, 5188n) + 1n);
    const d = await mod.decode(r, ctx);
    expect(d.title).toBe("Send 0.00000025 ETH to 0x033d…5e17");
    expect(d.balanceChanges.map((c) => c.delta)).toEqual(["-250"]);
  });

  it("sends a token with change for the token and for ETH", async () => {
    const n = node((v) => {
      expect(v.q).toEqual([{ assetId: USDC_TESTNET, amount: "1500000" }, expect.objectContaining({ assetId: ETH })]);
      return { coinsToSpend: [[coin("5000000", USDC_TESTNET, 2)], [coin("1000000")]] };
    });
    const ctx = ctxFor(n.fetch);
    const usdc = { key: "usdc.e", symbol: "USDC", name: "Bridged USDC (Fuel)", decimals: 6, networkId: "fuel:0", address: USDC_TESTNET };
    const r = await mod.buildTransfer({ asset: usdc, to: OTHER, amount: "1500000" }, ctx);
    const tx = (r.params as { transaction: Record<string, any> }).transaction;
    expect(tx.outputs).toEqual([
      { type: 0, to: OTHER, amount: "0x16e360", assetId: USDC_TESTNET },
      { type: 2, to: ME, assetId: USDC_TESTNET },
      { type: 2, to: ME, assetId: ETH },
    ]);
    const d = await mod.decode(r, ctx);
    expect(d.title).toBe("Send 1.5 USDC to 0x033d…5e17");
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc.e" }), delta: "-1500000" }]);
  });

  it("refuses bad input and missing funds in plain words", async () => {
    const poor = node(() => ({ errors: [{ message: `the target cannot be met due to insufficient coins available for ${ETH.slice(2)}. Collected: 0.` }] }));
    const ctx = ctxFor(poor.fetch);
    const eth = ctx.network.nativeAsset;
    const e = await clip(mod.buildTransfer({ asset: eth, to: OTHER, amount: "1" }, ctx), "fuel/insufficient-funds");
    expect(e.userMessage).toBe("You don't have enough ETH to pay for this and its fee.");
    await clip(mod.buildTransfer({ asset: eth, to: "0x1234", amount: "1" }, ctx), "fuel/bad-address");
    await clip(mod.buildTransfer({ asset: eth, to: ACCOUNT0.address, amount: "1" }, ctx), "fuel/self-transfer");
    await clip(mod.buildTransfer({ asset: eth, to: OTHER, amount: "0" }, ctx), "fuel/bad-amount");
    const wrong = fakeNode({ getChain: CHAIN(9889), estimateGasPrice: { estimateGasPrice: { gasPrice: "1" } } });
    await clip(mod.buildTransfer({ asset: eth, to: OTHER, amount: "1" }, ctxFor(wrong.fetch)), "fuel/network-mismatch");
  });
});

describe("getBalances", () => {
  it("shows ETH and curated tokens, and leaves unknown assets out", async () => {
    const n = fakeNode({
      getBalances: {
        balances: {
          nodes: [
            { assetId: ETH, amount: "1669864" },
            { assetId: USDC_TESTNET, amount: "2500000" },
            { assetId: `0x${"ab".repeat(32)}`, amount: "999999999" },
          ],
        },
      },
    });
    const b = await mod.getBalances(ctxFor(n.fetch));
    expect(b.map((x) => [x.asset.key, x.amount])).toEqual([
      ["eth-testnet", "1669864"],
      ["usdc.e", "2500000"],
    ]);
    const empty = await mod.getBalances(ctxFor(fakeNode({ getBalances: { balances: { nodes: [] } } }).fetch));
    expect(empty).toEqual([{ asset: expect.objectContaining({ symbol: "ETH" }), amount: "0" }]);
    expect(await mod.getNfts(ctxFor(n.fetch))).toEqual([]);
  });
});
