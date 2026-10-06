/**
 * Hand-written serialization, ids, fees, addresses and message hashes, each cross-checked against fuels-ts
 * (devDependency only).
 */
import {
  Address,
  InputType,
  OutputType,
  ScriptTransactionRequest,
  Signer,
  bn,
  getMaxGas,
  getMinGas,
  calculateMetadataGasForTxScript,
  hashMessage as fuelsHashMessage,
  hexlify,
  transactionRequestify,
} from "fuels";
import { describe, expect, it } from "vitest";
import {
  FUEL_MAINNET,
  FUEL_TESTNET,
  assetFor,
  createFuelModule,
  encodeScriptTx,
  fuelAddressFromPublicKey,
  fuelNetOf,
  hashMessage,
  isFuelAddress,
  maxGas,
  minGas,
  parseTransactionRequest,
  toChecksum,
  toTransactionRequestJson,
  transactionId,
  type ScriptTx,
} from "../src/index.js";
import { gqlFor } from "../src/gql.js";
import { fromHex, hex } from "../src/util.js";
import { ACCOUNT0, ACCOUNT1, CHAIN, CONTRACT, ETH, ME, OTHER, TRANSFER_ID, TRANSFER_TX, USDC_TESTNET } from "./fixtures.js";
import { ctxFor, fakeNode } from "./helpers.js";

const script = (json: unknown): ScriptTx => {
  const p = parseTransactionRequest(json);
  if (p.kind !== "script") throw new Error("not a script");
  return p.tx;
};

/** Requests built with fuels-ts itself, then serialized to JSON the way the Fuel connector sends them. */
function fuelsRequests(): Record<string, unknown> {
  const coin = (id: string, assetId: string, amount: number, owner = ME, witnessIndex = 0) => ({
    type: InputType.Coin,
    id,
    owner,
    amount: bn(amount),
    assetId,
    txPointer: "0x00000000000000000000000000000000",
    witnessIndex,
  });
  const token = new ScriptTransactionRequest({ gasLimit: 64, maxFee: 200 });
  token.inputs.push(coin(`0x${"11".repeat(32)}0002`, USDC_TESTNET, 5_000_000) as never, coin(`0x${"22".repeat(32)}0000`, ETH, 1_000_000) as never);
  token.addCoinOutput(new Address(OTHER), 1_500_000, USDC_TESTNET);
  token.addChangeOutput(new Address(ME), USDC_TESTNET);
  token.addChangeOutput(new Address(ME), ETH);
  token.witnesses.push(new Uint8Array(64));

  const call = new ScriptTransactionRequest({
    gasLimit: 250_000,
    maxFee: 9_000,
    tip: 7,
    maturity: 12,
    expiration: 99_999_999,
    witnessLimit: 4_096,
    script: "0x724028c0724428985d451000724828a02d41148a24040000",
    scriptData: "0x00000000000003e8f8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07aa",
  });
  call.inputs.push(coin(`0x${"33".repeat(32)}0001`, ETH, 1_669_864) as never);
  call.inputs.push({ type: InputType.Contract, contractId: CONTRACT, txPointer: "0x00000000000000000000000000000000" } as never);
  call.outputs.push({ type: OutputType.Contract, inputIndex: 1 } as never);
  call.outputs.push({ type: OutputType.Variable } as never);
  call.addChangeOutput(new Address(ME), ETH);
  call.witnesses.push(new Uint8Array(64));

  const message = new ScriptTransactionRequest({ gasLimit: 64, maxFee: 50 });
  message.inputs.push({
    type: InputType.Message,
    sender: `0x${"44".repeat(32)}`,
    recipient: ME,
    amount: bn(42_000),
    nonce: `0x${"55".repeat(32)}`,
    witnessIndex: 0,
  } as never);
  message.addCoinOutput(new Address(OTHER), 1_000, ETH);
  message.addChangeOutput(new Address(ME), ETH);
  message.witnesses.push(new Uint8Array(64));

  return {
    transfer: TRANSFER_TX,
    token: JSON.parse(JSON.stringify(token)),
    call: JSON.parse(JSON.stringify(call)),
    message: JSON.parse(JSON.stringify(message)),
  };
}

describe("transactions (cross-checked with fuels-ts TransactionCoder and hashTransaction)", () => {
  const cases = Object.entries(fuelsRequests());

  it.each(cases)("%s: same bytes and id on both networks", (_name, json) => {
    const ours = script(json);
    const theirs = transactionRequestify(json as never);
    expect(hex(encodeScriptTx(ours))).toBe(hexlify(theirs.toTransactionBytes()).slice(2));
    for (const chainId of [0, 9889]) expect(`0x${hex(transactionId(ours, chainId))}`).toBe(theirs.getTransactionId(chainId));
  });

  it.each(cases)("%s: round-trips through toTransactionRequestJson (and fuels reads it back)", (_name, json) => {
    const ours = script(json);
    const back = toTransactionRequestJson(ours);
    expect(hex(encodeScriptTx(script(back)))).toBe(hex(encodeScriptTx(ours)));
    expect(transactionRequestify(back as never).getTransactionId(0)).toBe(`0x${hex(transactionId(ours, 0))}`);
  });

  it("the live transfer fixture has the id fuels-ts and the testnet computed", () => {
    expect(`0x${hex(transactionId(script(TRANSFER_TX), 0))}`).toBe(TRANSFER_ID);
  });

  it("accepts a JSON string and Uint8Array-shaped objects, and refuses junk", () => {
    const asText = script(JSON.stringify(TRANSFER_TX));
    expect(hex(encodeScriptTx(asText))).toBe(hex(encodeScriptTx(script(TRANSFER_TX))));
    const objScript = script({ ...TRANSFER_TX, script: { 0: 0x24, 1: 0, 2: 0, 3: 0 } });
    expect(hex(objScript.script)).toBe("24000000");
    expect(() => parseTransactionRequest({ ...TRANSFER_TX, maxFee: -1 })).toThrow();
    expect(() => parseTransactionRequest({ ...TRANSFER_TX, inputs: [{ type: 0, id: "0x12" }] })).toThrow();
    expect(() => parseTransactionRequest("{not json")).toThrow();
    expect(parseTransactionRequest({ type: 1 })).toEqual({ kind: "other", type: 1 });
  });
});

describe("fees (fuels-ts getMinGas / getMaxGas)", () => {
  it.each(Object.entries(fuelsRequests()))("%s: same min and max gas", async (_name, json) => {
    const { fetch } = fakeNode({ getChain: CHAIN(0) });
    const chain = await gqlFor(ctxFor(fetch)).chainInfo();
    const tx = script(json);
    const req = transactionRequestify(json as never);
    const gasCosts = {
      ecr1: bn(chain.gasCosts.ecr1.toString()),
      vmInitialization: chain.gasCosts.vmInitialization,
      s256: chain.gasCosts.s256,
      contractRoot: chain.gasCosts.contractRoot,
    } as never;
    const size = req.toTransactionBytes().length;
    const theirMin = getMinGas({
      gasCosts,
      gasPerByte: bn(1),
      inputs: req.inputs,
      txBytesSize: size,
      metadataGas: calculateMetadataGasForTxScript({ gasCosts, txBytesSize: size }),
    });
    expect(minGas(tx, chain).toString()).toBe(theirMin.toString());
    const witnessesLength = req.toTransaction().witnesses.reduce((a, w) => a + w.dataLength, 0);
    const theirMax = getMaxGas({ gasPerByte: bn(1), witnessesLength, witnessLimit: req.witnessLimit, minGas: theirMin, gasLimit: (req as ScriptTransactionRequest).gasLimit, maxGasPerTx: bn(30_000_000) });
    expect(maxGas(tx, chain).toString()).toBe(theirMax.toString());
  });
});

describe("addresses (fuels-ts Address / Signer)", () => {
  it("derives the Fuel Wallet addresses of the abandon … about accounts 0 and 1", () => {
    for (const a of [ACCOUNT0, ACCOUNT1]) {
      const pub = fromHex(a.publicKey);
      expect(fuelAddressFromPublicKey(pub)).toBe(a.address);
      expect(new Address(Signer.extendPublicKey(`0x${a.publicKey}`)).toString()).toBe(a.address);
      expect(createFuelModule().addressFromPublicKey(pub, FUEL_TESTNET)).toBe(a.address);
    }
  });

  it("verifies checksums: exact checksum, one case, or refused", () => {
    expect(isFuelAddress(ACCOUNT0.address)).toBe(true);
    expect(isFuelAddress(ACCOUNT0.address.toLowerCase())).toBe(true);
    expect(isFuelAddress(`0x${ACCOUNT0.address.slice(2).toUpperCase()}`)).toBe(true);
    const typo = ACCOUNT0.address.replace("EC", "Ec");
    expect(typo).not.toBe(ACCOUNT0.address);
    expect(isFuelAddress(typo)).toBe(false);
    expect(isFuelAddress(ACCOUNT0.address.slice(0, -1))).toBe(false);
    expect(isFuelAddress("fuel1sphvdxsmcyuc3pa8xfaywlhqj5gm8un9e76kkvzc35ze65ec6s3w5f4pkq")).toBe(false);
    expect(toChecksum(ACCOUNT1.address.toLowerCase())).toBe(new Address(ACCOUNT1.address.toLowerCase()).toChecksum());
  });

  it("uses the Fuel Wallet derivation path", () => {
    const m = createFuelModule();
    expect(m.derivationPath(0)).toBe("m/44'/1179993420'/0'/0/0");
    expect(m.derivationPath(3)).toBe("m/44'/1179993420'/3'/0/0");
    expect(m.curve).toBe("secp256k1");
    expect(m.networksForAddress(ACCOUNT0.address, [FUEL_TESTNET, FUEL_MAINNET]).map((n) => n.id)).toEqual(["fuel:0", "fuel:9889"]);
    expect(m.networksForAddress("0x12", [FUEL_TESTNET])).toEqual([]);
  });
});

describe("messages (fuels-ts hashMessage)", () => {
  it("hashes plain strings, personalSign text and personalSign bytes the same way", () => {
    expect(`0x${hex(hashMessage({ text: "hello" }))}`).toBe(fuelsHashMessage("hello"));
    expect(`0x${hex(hashMessage({ personalSign: "Hello Fuel" }))}`).toBe(fuelsHashMessage({ personalSign: "Hello Fuel" }));
    expect(`0x${hex(hashMessage({ personalSignHex: "0xdeadbeef" }))}`).toBe(fuelsHashMessage({ personalSign: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) }));
  });
});

describe("networks", () => {
  it("names the testnet and mainnet by the connector chain ids", () => {
    expect(FUEL_TESTNET).toMatchObject({ id: "fuel:0", family: "fuel", testnet: true, rpcUrls: ["https://testnet.fuel.network/v1/graphql"] });
    expect(FUEL_MAINNET).toMatchObject({ id: "fuel:9889", testnet: false, rpcUrls: ["https://mainnet.fuel.network/v1/graphql"] });
    expect(fuelNetOf(0)).toBe("testnet");
    expect(fuelNetOf("9889")).toBe("mainnet");
    expect(fuelNetOf("https://mainnet.fuel.network/v1/graphql/")).toBe("mainnet");
    expect(fuelNetOf("https://evil.example/v1/graphql")).toBeNull();
  });

  it("knows ETH and the bridged tokens, and never merges an unknown asset", () => {
    expect(assetFor("fuel:9889", ETH)).toMatchObject({ key: "eth", symbol: "ETH", decimals: 9 });
    expect(assetFor("fuel:0", ETH)).toMatchObject({ key: "eth-testnet" });
    expect(assetFor("fuel:9889", "0x286c479da40dc953bddc3bb4c453b608bba2e0ac483b077bd475174115395e6b")).toMatchObject({ key: "usdc.e", symbol: "USDC", decimals: 6, bridged: true });
    expect(assetFor("fuel:9889", "0xa0265fb5c32f6e8db3197af3c7eb05c48ae373605b8165b6f4a51c5b0ba4812e")).toMatchObject({ key: "usdt.e", bridged: true });
    const unknown = assetFor("fuel:9889", `0x${"ab".repeat(32)}`);
    expect(unknown.key).toBe(`fuel-asset:0x${"ab".repeat(32)}`);
    expect(unknown.symbol).not.toBe("USDC");
  });
});
