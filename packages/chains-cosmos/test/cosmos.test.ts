import { ClipError, WALLET_ORIGIN, type DappRequest } from "@clip-wallet/core";
import { makeSignDoc, pubkeyToAddress, serializeSignDoc as cosmjsSerialize } from "@cosmjs/amino";
import { Secp256k1, Secp256k1Signature, keccak256, sha256 } from "@cosmjs/crypto";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { AuthInfo, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { bech32 } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  COSMOS_CHAINS,
  COSMOS_METHODS,
  COSMOS_NETWORKS,
  DYDX_TESTNET,
  INITIA_TESTNET,
  OSMOSIS_MAINNET,
  OSMOSIS_TESTNET,
  PROVENANCE_MAINNET,
  PROVENANCE_TESTNET,
  THORCHAIN_MAINNET,
  ZIGCHAIN_TESTNET,
  createCosmosModule,
  nativeAsset,
  specOf,
} from "../src/index.js";
import { TYPE, decodeAuthInfo, decodeThorMsgSend, decodeTxBody } from "../src/proto.js";
import { b64decode, fromHex, hex } from "../src/util.js";
import { ADDR, NOT_FOUND, PUB, VAULT_ADDRESS, accountInfo, balances, broadcastFail, ctxFor, fixtureSigner, makeAccount, mockFetch, reply, simulated } from "./helpers.js";
import { MESSAGE, TXHASH, chainRoutes, dappAminoDoc, dappDirectDoc, dappRequest, initiaTransfer, opts, osmoTransfer, provenanceTransfer, thorTransfer } from "./scenarios.js";

const cosmos = createCosmosModule({ family: "cosmos", ...opts });
const initia = createCosmosModule({ family: "initia", ...opts });
const thor = createCosmosModule({ family: "thorchain", ...opts });
const prov = createCosmosModule({ family: "provenance", ...opts });

async function sign(mod: ReturnType<typeof createCosmosModule>, req: DappRequest, ctx: ReturnType<typeof ctxFor>) {
  const payloads = await mod.prepare(req, ctx, "approval-1");
  return mod.finalize(req, payloads.map((p) => fixtureSigner(mod.family as "cosmos").sign(p)), ctx);
}

describe("families, derivation, addresses", () => {
  it("matches the vault's paths and curve per family", () => {
    expect(cosmos.derivationPath(0)).toBe("m/44'/118'/0'/0/0");
    expect(prov.derivationPath(3)).toBe("m/44'/505'/0'/0/3");
    expect(thor.derivationPath(1)).toBe("m/44'/931'/0'/0/1");
    expect(initia.derivationPath(2)).toBe("m/44'/60'/0'/0/2");
    for (const m of [cosmos, initia, thor, prov]) expect(m.curve).toBe("secp256k1");
    expect(() => createCosmosModule({ family: "evm" as never })).toThrow();
  });

  it("each instance answers only its family's networks", () => {
    expect(cosmos.networks.map((n) => n.id)).toEqual(["cosmos:osmo-test-5", "cosmos:osmosis-1", "cosmos:dydx-testnet-4", "cosmos:dydx-mainnet-1", "cosmos:zig-test-2", "cosmos:zigchain-1"]);
    expect(prov.networks.map((n) => n.id)).toEqual(["cosmos:pio-testnet-1", "cosmos:pio-mainnet-1"]);
    expect(thor.networks.map((n) => n.id)).toEqual(["cosmos:thorchain-1"]);
    expect(initia.networks.map((n) => n.id)).toEqual(["cosmos:initiation-2", "cosmos:interwoven-1"]);
    expect(COSMOS_NETWORKS.every((n) => n.id === `cosmos:${specOf(n.id)!.chainId}` && n.rpcUrls.length >= 1)).toBe(true);
    expect(() => cosmos.addressFromPublicKey(fromHex(PUB.cosmos), INITIA_TESTNET)).toThrow();
  });

  it("known answers for the abandon … about account, cross-checked with cosmjs pubkeyToAddress", () => {
    const key = (f: keyof typeof PUB) => ({ type: "tendermint/PubKeySecp256k1", value: Buffer.from(fromHex(PUB[f])).toString("base64") });
    expect(cosmos.addressFromPublicKey(fromHex(PUB.cosmos), OSMOSIS_TESTNET)).toBe(ADDR.osmo);
    expect(pubkeyToAddress(key("cosmos"), "osmo")).toBe(ADDR.osmo);
    expect(cosmos.addressFromPublicKey(fromHex(PUB.cosmos), DYDX_TESTNET)).toBe(pubkeyToAddress(key("cosmos"), "dydx"));
    expect(cosmos.addressFromPublicKey(fromHex(PUB.cosmos), ZIGCHAIN_TESTNET)).toBe(pubkeyToAddress(key("cosmos"), "zig"));
    expect(prov.addressFromPublicKey(fromHex(PUB.provenance), PROVENANCE_TESTNET)).toBe(ADDR.tp);
    expect(prov.addressFromPublicKey(fromHex(PUB.provenance), PROVENANCE_MAINNET)).toBe(pubkeyToAddress(key("provenance"), "pb"));
    expect(prov.addressFromPublicKey(fromHex(PUB.provenance), PROVENANCE_MAINNET)).toBe(VAULT_ADDRESS.provenance);
    expect(thor.addressFromPublicKey(fromHex(PUB.thorchain), THORCHAIN_MAINNET)).toBe(pubkeyToAddress(key("thorchain"), "thor"));
    expect(thor.addressFromPublicKey(fromHex(PUB.thorchain), THORCHAIN_MAINNET)).toBe(VAULT_ADDRESS.thorchain);
    // Initia: the EVM address of m/44'/60'/0'/0/0 of this phrase is the well-known 0x9858EfFD232B4033E47d90003D41EC34EcaEda94.
    expect(initia.addressFromPublicKey(fromHex(PUB.initia), INITIA_TESTNET)).toBe(ADDR.init);
    const evm = Buffer.from(keccak256(Secp256k1.uncompressPubkey(fromHex(PUB.initia)).slice(1)).slice(12)).toString("hex");
    expect(evm).toBe("9858effd232b4033e47d90003d41ec34ecaeda94");
    expect(hex(bech32.fromWords(bech32.decode(ADDR.init as `${string}1${string}`).words))).toBe(evm);
  });

  it("receiveAddress spells the account per network", async () => {
    const f = mockFetch([]).fetch;
    expect(await cosmos.receiveAddress(ctxFor(OSMOSIS_TESTNET, f))).toBe(ADDR.osmo);
    expect(await cosmos.receiveAddress(ctxFor(DYDX_TESTNET, f))).toBe(ADDR.dydx);
    expect(await cosmos.receiveAddress(ctxFor(ZIGCHAIN_TESTNET, f))).toBe(ADDR.zig);
    expect(await prov.receiveAddress(ctxFor(PROVENANCE_TESTNET, f))).toBe(ADDR.tp);
    expect(await prov.receiveAddress(ctxFor(PROVENANCE_MAINNET, f))).toBe(ADDR.pb);
    expect(await initia.receiveAddress(ctxFor(INITIA_TESTNET, f))).toBe(ADDR.init);
  });

  it("isAddress checks the bech32 checksum and the family's prefixes; networksForAddress goes by prefix", () => {
    expect(cosmos.isAddress(ADDR.osmo)).toBe(true);
    expect(cosmos.isAddress(ADDR.dydx)).toBe(true);
    expect(cosmos.isAddress(ADDR.zig)).toBe(true);
    expect(cosmos.isAddress(ADDR.osmo.slice(0, -1) + "9")).toBe(false); // checksum
    expect(cosmos.isAddress(ADDR.osmo.toUpperCase())).toBe(false);
    expect(cosmos.isAddress(ADDR.tp)).toBe(false); // another family
    expect(cosmos.isAddress(VAULT_ADDRESS.cosmos)).toBe(false); // cosmoshub isn't shipped
    expect(prov.isAddress(ADDR.tp) && prov.isAddress(ADDR.pb)).toBe(true);
    expect(thor.isAddress(ADDR.thor)).toBe(true);
    expect(initia.isAddress(ADDR.init)).toBe(true);
    // 32-byte contract addresses are accounts too (CosmWasm, Initia objects).
    expect(cosmos.isAddress("osmo1nc5tatafv6eyq7llkr2gv50ff9e22mnf70qgjlv737ktmt4eswrqvlx82r")).toBe(true);
    expect(cosmos.networksForAddress(ADDR.osmo, COSMOS_NETWORKS).map((n) => n.id)).toEqual(["cosmos:osmo-test-5", "cosmos:osmosis-1"]);
    expect(cosmos.networksForAddress(ADDR.dydx, COSMOS_NETWORKS).map((n) => n.id)).toEqual(["cosmos:dydx-testnet-4", "cosmos:dydx-mainnet-1"]);
    expect(prov.networksForAddress(ADDR.tp, COSMOS_NETWORKS).map((n) => n.id)).toEqual(["cosmos:pio-testnet-1"]);
    expect(cosmos.networksForAddress(ADDR.init, COSMOS_NETWORKS)).toEqual([]);
  });
});

describe("balances", () => {
  it("native + canonical USDC; unknown denoms hidden", async () => {
    const usdc = "ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5";
    const m = mockFetch([[/balances\/dydx1/, balances([{ denom: "adv4tnt", amount: "5000000000000000000" }, { denom: "ibc/DEADBEEF", amount: "99" }])]]);
    const out = await cosmos.getBalances(ctxFor(DYDX_TESTNET, m.fetch));
    expect(out).toEqual([
      { asset: nativeAsset(specOf(DYDX_TESTNET.id)!), amount: "5000000000000000000" },
      { asset: { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: DYDX_TESTNET.id, address: usdc }, amount: "0" },
    ]);
    expect(m.calls[0]!.url).toContain(`/cosmos/bank/v1beta1/balances/${ADDR.dydx}`);
  });

  it("an account that never received anything has 0; endpoints fail over", async () => {
    const m = mockFetch([
      [/lcd\.osmotest5/, reply(503, "down")],
      [/balances/, balances([])],
    ]);
    expect(await cosmos.getBalances(ctxFor(OSMOSIS_TESTNET, m.fetch))).toEqual([{ asset: nativeAsset(specOf(OSMOSIS_TESTNET.id)!), amount: "0" }]);
    expect(m.calls.map((c) => new URL(c.url).host)).toEqual(["lcd.osmotest5.osmosis.zone", "lcd.testnet.osmosis.zone"]);
  });
});

describe("wallet transfers: build → decode → prepare → finalize", () => {
  it("osmo-test-5: MsgSend, simulated gas × 1.4, fee from the txfees base fee × 1.65, sync broadcast, polled", async () => {
    const s = await osmoTransfer();
    expect(s.request).toMatchObject({ origin: WALLET_ORIGIN, family: "cosmos", networkId: "cosmos:osmo-test-5", method: COSMOS_METHODS.signAndBroadcast });
    const doc = (s.request.params as { signDoc: { bodyBytes: string; authInfoBytes: string; chainId: string; accountNumber: string } }).signDoc;
    expect(doc.chainId).toBe("osmo-test-5");
    expect(doc.accountNumber).toBe("4242");
    const body = TxBody.decode(b64decode(doc.bodyBytes));
    expect(MsgSend.decode(body.messages[0]!.value)).toEqual({ fromAddress: ADDR.osmo, toAddress: ADDR.osmoBob, amount: [{ denom: "uosmo", amount: "1500000" }] });
    const auth = AuthInfo.decode(b64decode(doc.authInfoBytes));
    expect(auth.fee!.gasLimit).toBe(112000n); // 80 000 × 1.4
    expect(auth.fee!.amount).toEqual([{ denom: "uosmo", amount: "4620" }]); // 112 000 × 0.025 × 1.65
    expect(auth.signerInfos[0]!.sequence).toBe(7n);

    const d = await cosmos.decode(s.request, s.ctx);
    expect(d.title).toBe("Send 1.5 OSMO to osmo1jrkm…4pqs");
    expect(d.titleMsg?.id).toBe("bg.req.sendTo");
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([{ asset: nativeAsset(specOf(OSMOSIS_TESTNET.id)!), delta: "-1500000" }]);
    expect(d.fee).toEqual({ asset: nativeAsset(specOf(OSMOSIS_TESTNET.id)!), amount: "4620" });
    expect(d.lines).toContainEqual({ label: "To", value: ADDR.osmoBob });
    expect(d.lines).toContainEqual({ label: "Network fee", value: "0.00462 OSMO" });

    const [p] = await cosmos.prepare(s.request, s.ctx, "approval-1");
    expect(p!.scheme).toBe("ecdsa-secp256k1");
    expect(p!.bytes.length).toBe(32);
    const res = await sign(cosmos, s.request, s.ctx);
    expect(res).toEqual({ txhash: TXHASH, status: "success", height: "123456" });
    const sent = s.calls.find((c) => c.method === "POST" && c.url.endsWith("/cosmos/tx/v1beta1/txs"))!;
    const body2 = JSON.parse(sent.body!) as { tx_bytes: string; mode: string };
    expect(body2.mode).toBe("BROADCAST_MODE_SYNC");
    const raw = TxRaw.decode(b64decode(body2.tx_bytes));
    expect(raw.signatures[0]!.length).toBe(64);
    // The digest is sha256(SignDoc) and the signature verifies with cosmjs too.
    expect(await Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(raw.signatures[0]!), p!.bytes, fromHex(PUB.cosmos))).toBe(true);
  });

  it("initiation-2: ethsecp256k1 key type URL and a keccak256 digest", async () => {
    const s = await initiaTransfer();
    const doc = (s.request.params as { signDoc: { authInfoBytes: string; bodyBytes: string } }).signDoc;
    const auth = decodeAuthInfo(b64decode(doc.authInfoBytes));
    expect(auth.signerInfos[0]!.publicKey!.typeUrl).toBe("/initia.crypto.v1beta1.ethsecp256k1.PubKey");
    expect(auth.fee.amount).toEqual([{ denom: "uinit", amount: "1764" }]); // 112 000 × x/dynamicfee 0.015 × 1.05
    const d = await initia.decode(s.request, s.ctx);
    expect(d.title).toBe("Send 0.5 INIT to init1d7ky…4swa");
    const [p] = await initia.prepare(s.request, s.ctx, "a");
    const { encodeSignDoc } = await import("../src/proto.js");
    const signDoc = encodeSignDoc({ bodyBytes: b64decode(doc.bodyBytes), authInfoBytes: b64decode(doc.authInfoBytes), chainId: "initiation-2", accountNumber: 4242n });
    expect(hex(p!.bytes)).toBe(hex(keccak256(signDoc)));
    expect(await sign(initia, s.request, s.ctx)).toMatchObject({ txhash: TXHASH, status: "success" });
  });

  it("thorchain-1: types.MsgSend with raw address bytes, no fee coins (fixed native fee), checked against the balance", async () => {
    const s = await thorTransfer();
    const doc = (s.request.params as { signDoc: { authInfoBytes: string; bodyBytes: string } }).signDoc;
    const body = decodeTxBody(b64decode(doc.bodyBytes));
    expect(body.messages[0]!.typeUrl).toBe(TYPE.thorMsgSend);
    const m = decodeThorMsgSend(body.messages[0]!.value);
    expect(m.amount).toEqual([{ denom: "rune", amount: "100000000" }]);
    expect(decodeAuthInfo(b64decode(doc.authInfoBytes)).fee.amount).toEqual([]);
    const d = await thor.decode(s.request, s.ctx);
    expect(d.title).toBe("Send 1 RUNE to thor1lq2u…9g5j");
    expect(await sign(thor, s.request, s.ctx)).toMatchObject({ txhash: TXHASH });

    // 4.99 RUNE + 0.02 fixed fee > 5 RUNE.
    const m2 = mockFetch(chainRoutes(ADDR.thor, [{ denom: "rune", amount: "500000000" }]));
    await expect(thor.buildTransfer({ asset: nativeAsset(specOf(THORCHAIN_MAINNET.id)!), to: ADDR.thorBob, amount: "499000000" }, ctxFor(THORCHAIN_MAINNET, m2.fetch))).rejects.toMatchObject({
      code: "cosmos/insufficient-funds",
    });
  });

  it("pio-testnet-1: tp… addresses, the flat fee from x/flatfees calculate_flat_fee", async () => {
    const s = await provenanceTransfer();
    const doc = (s.request.params as { signDoc: { authInfoBytes: string } }).signDoc;
    expect(decodeAuthInfo(b64decode(doc.authInfoBytes)).fee).toMatchObject({ amount: [{ denom: "nhash", amount: "7799095305" }], gasLimit: 80304n });
    const calc = s.calls.find((c) => c.url.endsWith("/provenance/tx/v1/calculate_flat_fee"))!;
    expect(JSON.parse(calc.body!)).toMatchObject({ gas_adjustment: 1.4 });
    expect(s.calls.some((c) => c.url.endsWith("/cosmos/tx/v1beta1/simulate"))).toBe(false);
    const d = await prov.decode(s.request, s.ctx);
    expect(d.title).toBe("Send 2 HASH to tp1wqcz…nc8n");
    expect(d.lines).toContainEqual({ label: "Network fee", value: "7.799095305 HASH" });
    expect(await sign(prov, s.request, s.ctx)).toMatchObject({ txhash: TXHASH });
  });

  it("refuses bad sends in plain words", async () => {
    const m = mockFetch(chainRoutes(ADDR.osmo, [{ denom: "uosmo", amount: "1000" }]));
    const ctx = ctxFor(OSMOSIS_TESTNET, m.fetch);
    const osmo = nativeAsset(specOf(OSMOSIS_TESTNET.id)!);
    await expect(cosmos.buildTransfer({ asset: osmo, to: ADDR.dydx, amount: "1" }, ctx)).rejects.toMatchObject({ code: "cosmos/bad-address", userMessage: "That address is for another network. Addresses on Osmosis Testnet start with osmo1…." });
    await expect(cosmos.buildTransfer({ asset: osmo, to: ADDR.osmo, amount: "1" }, ctx)).rejects.toMatchObject({ code: "cosmos/self-transfer" });
    await expect(cosmos.buildTransfer({ asset: osmo, to: "osmo1nope", amount: "1" }, ctx)).rejects.toMatchObject({ code: "cosmos/bad-address" });
    await expect(cosmos.buildTransfer({ asset: osmo, to: ADDR.osmoBob, amount: "0" }, ctx)).rejects.toMatchObject({ code: "cosmos/bad-amount" });
    await expect(cosmos.buildTransfer({ asset: osmo, to: ADDR.osmoBob, amount: "2000" }, ctx)).rejects.toMatchObject({ code: "cosmos/insufficient-funds", userMessage: "You don't have enough OSMO." });
    await expect(cosmos.buildTransfer({ asset: osmo, to: ADDR.osmoBob, amount: "900" }, ctx)).rejects.toMatchObject({ code: "cosmos/insufficient-funds", userMessage: "You don't have enough OSMO to pay for this and its fee." });
    const fresh = mockFetch([[/account_info/, NOT_FOUND]]);
    await expect(cosmos.buildTransfer({ asset: osmo, to: ADDR.osmoBob, amount: "1" }, ctxFor(OSMOSIS_TESTNET, fresh.fetch))).rejects.toMatchObject({
      code: "cosmos/insufficient-funds",
      userMessage: "Your account isn't on Osmosis Testnet yet. Receive some OSMO first.",
    });
  });

  it("a broadcast the chain rejects becomes plain words", async () => {
    const s = await osmoTransfer();
    const m = mockFetch([[/\/cosmos\/tx\/v1beta1\/txs$/, broadcastFail(32, "account sequence mismatch, expected 8, got 7: incorrect account sequence")]]);
    const ctx = { ...s.ctx, fetch: m.fetch };
    await expect(sign(cosmos, s.request, ctx)).rejects.toMatchObject({ code: "cosmos/send-failed", userMessage: "Another transaction from this account went first. Try again." });
  });

  it("a signature that doesn't verify is refused before anything is broadcast", async () => {
    const s = await osmoTransfer();
    const other = await provenanceTransfer();
    const [p] = await prov.prepare(other.request, other.ctx, "x");
    const wrong = fixtureSigner("provenance").sign(p!); // a real signature, but by another key over another digest
    const before = s.calls.length;
    await expect(cosmos.finalize(s.request, [{ ...wrong, publicKey: PUB.cosmos }], s.ctx)).rejects.toMatchObject({ code: "cosmos/bad-signature" });
    await expect(cosmos.finalize(s.request, [], s.ctx)).rejects.toMatchObject({ code: "cosmos/missing-signature" });
    expect(s.calls.slice(before).some((c) => c.method === "POST")).toBe(false);
  });

  it("signAndBroadcast is the wallet's own: a site can't use it", async () => {
    const s = await osmoTransfer();
    await expect(cosmos.decode({ ...s.request, origin: "https://evil.example" }, s.ctx)).rejects.toMatchObject({ code: "cosmos/unsupported-method" });
  });
});

describe("dapp requests", () => {
  const ctx = () => ctxFor(OSMOSIS_TESTNET, mockFetch(chainRoutes(ADDR.osmo, [])).fetch);

  it("signDirect: decodes the cosmjs sign doc and returns { signed, signature } without broadcasting", async () => {
    const req = dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signDirect, { signerAddress: ADDR.osmo, signDoc: dappDirectDoc() });
    const c = ctx();
    const d = await cosmos.decode(req, c);
    expect(d.title).toBe("Send 0.000001 OSMO to osmo19rl4…7df8");
    expect(d.balanceChanges).toEqual([]); // to yourself
    expect(d.lines).toContainEqual({ label: "Memo", value: "matrix" });
    expect(d.lines.find((l) => l.label === "Sent by")?.value).toBe("app.osmosis.example (it gets the signed transaction)");
    const res = (await sign(cosmos, req, c)) as { signed: unknown; signature: { pub_key: { type: string; value: string }; signature: string } };
    expect(res.signed).toEqual(dappDirectDoc());
    expect(res.signature.pub_key).toEqual({ type: "tendermint/PubKeySecp256k1", value: Buffer.from(fromHex(PUB.cosmos)).toString("base64") });
    expect(b64decode(res.signature.signature).length).toBe(64);
  });

  it("signDirect simulates when asked and warns when the preview fails", async () => {
    const live = createCosmosModule({ family: "cosmos", simulate: true });
    const req = dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signDirect, { signerAddress: ADDR.osmo, signDoc: dappDirectDoc() });
    const ok = mockFetch([[/simulate$/, simulated("70000")]]);
    expect((await live.decode(req, ctxFor(OSMOSIS_TESTNET, ok.fetch))).simulated).toBe(true);
    const sent = JSON.parse(ok.calls[0]!.body!) as { tx_bytes: string };
    expect(TxRaw.decode(b64decode(sent.tx_bytes)).signatures).toEqual([new Uint8Array()]);
    const bad = mockFetch([[/simulate$/, reply(400, { code: 5, message: "0uosmo is smaller than 5000uosmo: insufficient funds" })]]);
    const d = await live.decode(req, ctxFor(OSMOSIS_TESTNET, bad.fetch));
    expect(d.simulated).toBe(false);
    expect(d.warnings).toContainEqual({ level: "danger", code: "simulation-failed", message: "This is expected to fail and would still cost a fee." });
  });

  it("signAmino: the cosmjs serialization is what gets hashed", async () => {
    const doc = dappAminoDoc();
    const req = dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signAmino, { signerAddress: ADDR.osmo, signDoc: doc });
    const c = ctx();
    const d = await cosmos.decode(req, c);
    expect(d.title).toBe("Send 0.25 OSMO to osmo1jrkm…4pqs");
    expect(d.fee).toEqual({ asset: nativeAsset(specOf(OSMOSIS_TESTNET.id)!), amount: "5000" });
    const [p] = await cosmos.prepare(req, c, "a");
    expect(hex(p!.bytes)).toBe(hex(sha256(cosmjsSerialize(doc))));
    const res = (await sign(cosmos, req, c)) as { signed: unknown };
    expect(res.signed).toEqual(doc);
  });

  it("ADR-36 signArbitrary: 'Sign a message for {host}', verifiable by cosmjs over Keplr's sign doc", async () => {
    const req = dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signArbitrary, { signer: ADDR.osmo, data: btoa(MESSAGE) });
    const c = ctx();
    const d = await cosmos.decode(req, c);
    expect(d.title).toBe("Sign a message for app.osmosis.example");
    expect(d.titleMsg?.id).toBe("bg.req.signMessage");
    expect(d.lines).toEqual([{ label: "Message", value: MESSAGE }]);
    expect(d.blind).toBe(false);
    const sig = (await sign(cosmos, req, c)) as { pub_key: { value: string }; signature: string };
    // Keplr makeADR36AminoSignDoc, rebuilt with cosmjs makeSignDoc: chain_id "", account 0, sequence 0, fee 0.
    const doc = makeSignDoc([{ type: "sign/MsgSignData", value: { signer: ADDR.osmo, data: btoa(MESSAGE) } }], { gas: "0", amount: [] }, "", "", 0, 0);
    expect(await Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(b64decode(sig.signature)), sha256(cosmjsSerialize(doc)), fromHex(PUB.cosmos))).toBe(true);
    // verifyArbitrary (read, no approval) agrees, and refuses another message or signer.
    expect(await cosmos.read(COSMOS_METHODS.verifyArbitrary, { signer: ADDR.osmo, data: btoa(MESSAGE), signature: sig }, c)).toBe(true);
    expect(await cosmos.read(COSMOS_METHODS.verifyArbitrary, { signer: ADDR.osmo, data: btoa("other"), signature: sig }, c)).toBe(false);
    expect(await cosmos.read(COSMOS_METHODS.verifyArbitrary, { signer: ADDR.osmoBob, data: btoa(MESSAGE), signature: sig }, c)).toBe(false);
    // The same doc through signAmino (as Keplr routes it) is the same message request.
    const viaAmino = dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signAmino, { signerAddress: ADDR.osmo, signDoc: doc });
    expect((await cosmos.decode(viaAmino, c)).title).toBe("Sign a message for app.osmosis.example");
  });

  it("ADR-36 on Initia hashes with keccak256 (Keplr verifyADR36Amino 'ethsecp256k1')", async () => {
    const c = ctxFor(INITIA_TESTNET, mockFetch([]).fetch);
    const req = dappRequest(INITIA_TESTNET, COSMOS_METHODS.signArbitrary, { signer: ADDR.init, data: btoa(MESSAGE) });
    const sig = (await sign(initia, req, c)) as { signature: string };
    const doc = makeSignDoc([{ type: "sign/MsgSignData", value: { signer: ADDR.init, data: btoa(MESSAGE) } }], { gas: "0", amount: [] }, "", "", 0, 0);
    expect(await Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(b64decode(sig.signature)), keccak256(cosmjsSerialize(doc)), fromHex(PUB.initia))).toBe(true);
  });

  it("a message that isn't text is shown as hex with a caution", async () => {
    const req = dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signArbitrary, { signer: ADDR.osmo, data: btoa(String.fromCharCode(0, 1, 2, 255)) });
    const d = await cosmos.decode(req, ctx());
    expect(d.lines).toEqual([{ label: "Message (not text)", value: "0x000102ff" }]);
    expect(d.warnings[0]).toMatchObject({ code: "blind-signing", level: "caution" });
  });

  it("explains IBC, staking, contracts and grants; anything else is blind", async () => {
    const c = ctx();
    const amino = (msgs: unknown[]) =>
      dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signAmino, { signerAddress: ADDR.osmo, signDoc: { ...dappAminoDoc(), msgs } });
    const ibc = await cosmos.decode(
      amino([{ type: "cosmos-sdk/MsgTransfer", value: { source_port: "transfer", source_channel: "channel-4156", token: { denom: "uosmo", amount: "1000000" }, sender: ADDR.osmo, receiver: "noble1abc", timeout_timestamp: "1" } }]),
      c,
    );
    expect(ibc.title).toBe("Send 1 OSMO to noble1abc");
    expect(ibc.warnings[0]).toMatchObject({ code: "network-matters", msg: { id: "bg.cosmos.ibcLeaves" } });
    expect(ibc.balanceChanges[0]!.delta).toBe("-1000000");

    const stake = await cosmos.decode(amino([{ type: "cosmos-sdk/MsgDelegate", value: { delegator_address: ADDR.osmo, validator_address: "osmovaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4", amount: { denom: "uosmo", amount: "2000000" } } }]), c);
    expect(stake.title).toBe("Stake 2 OSMO with osmovaloper1clpq…n0y4");
    const unstake = await cosmos.decode(amino([{ type: "cosmos-sdk/MsgUndelegate", value: { delegator_address: ADDR.osmo, validator_address: "osmovaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4", amount: { denom: "uosmo", amount: "2000000" } } }]), c);
    expect(unstake.title).toBe("Unstake 2 OSMO from osmovaloper1clpq…n0y4");
    const claim = await cosmos.decode(amino([{ type: "cosmos-sdk/MsgWithdrawDelegationReward", value: { delegator_address: ADDR.osmo, validator_address: "osmovaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4" } }]), c);
    expect(claim.title).toBe("Claim staking rewards from osmovaloper1clpq…n0y4");

    const wasm = await cosmos.decode(
      amino([{ type: "wasm/MsgExecuteContract", value: { sender: ADDR.osmo, contract: "osmo1contractaddr", msg: { swap: { offer: "1" } }, funds: [{ denom: "uosmo", amount: "1000" }] } }]),
      c,
    );
    expect(wasm.title).toBe("Use swap on contract osmo1cont…addr");
    expect(wasm.lines).toContainEqual({ label: "Message", value: JSON.stringify({ swap: { offer: "1" } }, null, 2) });
    expect(wasm.balanceChanges[0]!.delta).toBe("-1000");
    expect(wasm.warnings[0]).toMatchObject({ level: "caution", code: "unknown-call" });

    const grant = await cosmos.decode(
      amino([{ type: "cosmos-sdk/MsgGrant", value: { granter: ADDR.osmo, grantee: ADDR.osmoBob, grant: { authorization: { type: "cosmos-sdk/GenericAuthorization", value: { msg: TYPE.msgSend } } } } }]),
      c,
    );
    expect(grant.title).toBe("Let osmo1jrkm…4pqs act for your account");
    expect(grant.warnings[0]).toMatchObject({ level: "danger", code: "account-takeover", msg: { id: "bg.cosmos.authzTakeAll" } });
    const fee = await cosmos.decode(amino([{ type: "cosmos-sdk/MsgGrantAllowance", value: { granter: ADDR.osmo, grantee: ADDR.osmoBob, allowance: { type: "cosmos-sdk/BasicAllowance", value: {} } } }]), c);
    expect(fee.warnings[0]).toMatchObject({ level: "danger", code: "account-takeover" });

    const two = await cosmos.decode(amino([...dappAminoDoc().msgs, { type: "cosmos-sdk/MsgDelegate", value: { delegator_address: ADDR.osmo, validator_address: "osmovaloper1clpqr4nrk4khgkxj78fcwwh6dl3uw4ep88n0y4", amount: { denom: "uosmo", amount: "1" } } }]), c);
    expect(two.title).toBe("Send 0.25 OSMO to osmo1jrkm…4pqs");
    expect(two.lines).toContainEqual(expect.objectContaining({ label: "Also", value: "Stake 0.000001 OSMO with osmovaloper1clpq…n0y4" }));

    const blind = await cosmos.decode(amino([{ type: "osmosis/poolmanager/swap-exact-amount-in", value: { sender: ADDR.osmo } }]), c);
    expect(blind.blind).toBe(true);
    expect(blind.title).toBe("Approve a transaction for app.osmosis.example");
    expect(blind.warnings[0]).toMatchObject({ level: "danger", code: "blind-signing" });

    // Direct bytes we can't parse at all: blind, still signable only if blind signing is on (the approval decides).
    const junk = dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signDirect, { signerAddress: ADDR.osmo, signDoc: { ...dappDirectDoc(), bodyBytes: btoa("ÿÿÿ") } });
    expect((await cosmos.decode(junk, c)).blind).toBe(true);
  });

  it("refuses the wrong network, the wrong signer and transactions it isn't a signer of", async () => {
    const c = ctx();
    const doc = dappDirectDoc();
    await expect(cosmos.decode(dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signDirect, { signerAddress: ADDR.osmo, signDoc: { ...doc, chainId: "osmosis-1" } }), c)).rejects.toMatchObject({
      code: "cosmos/network-mismatch",
    });
    await expect(cosmos.decode(dappRequest(OSMOSIS_MAINNET, COSMOS_METHODS.signDirect, { signerAddress: ADDR.osmo, signDoc: doc }), c)).rejects.toMatchObject({ code: "cosmos/network-mismatch" });
    await expect(initia.decode(dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signDirect, { signerAddress: ADDR.osmo, signDoc: doc }), c)).rejects.toMatchObject({ code: "cosmos/network-mismatch" });
    await expect(cosmos.decode(dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signAmino, { signerAddress: ADDR.osmo, signDoc: { ...dappAminoDoc(), chain_id: "dydx-testnet-4" } }), c)).rejects.toMatchObject({
      code: "cosmos/network-mismatch",
    });
    await expect(cosmos.decode(dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signDirect, { signerAddress: ADDR.osmoBob, signDoc: doc }), c)).rejects.toMatchObject({ code: "cosmos/wrong-account" });
    await expect(cosmos.decode(dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signArbitrary, { signer: ADDR.dydx, data: "aGk=" }), c)).rejects.toMatchObject({ code: "cosmos/wrong-account" });
    const notMine = { ...dappAminoDoc(), msgs: [{ type: "cosmos-sdk/MsgSend", value: { from_address: ADDR.osmoBob, to_address: ADDR.osmo, amount: [{ denom: "uosmo", amount: "1" }] } }] };
    await expect(cosmos.decode(dappRequest(OSMOSIS_TESTNET, COSMOS_METHODS.signAmino, { signerAddress: ADDR.osmo, signDoc: notMine }), c)).rejects.toMatchObject({ code: "cosmos/not-a-signer" });
    await expect(cosmos.decode(dappRequest(OSMOSIS_TESTNET, "cosmos_signEverything", {}), c)).rejects.toBeInstanceOf(ClipError);
  });

  it("sendTx broadcasts signed bytes without an approval (Keplr sendTx) and reports refusals in plain words", async () => {
    const ok = mockFetch([[/\/cosmos\/tx\/v1beta1\/txs$/, { tx_response: { code: 0, txhash: "abcd" } }]]);
    const c = ctxFor(OSMOSIS_TESTNET, ok.fetch);
    const tx = btoa(String.fromCharCode(...TxRaw.encode({ bodyBytes: new Uint8Array([10, 0]), authInfoBytes: new Uint8Array([18, 0]), signatures: [new Uint8Array(64)] }).finish()));
    expect(await cosmos.read(COSMOS_METHODS.sendTx, { tx, mode: "sync" }, c)).toEqual({ txhash: "ABCD" });
    expect(JSON.parse(ok.calls[0]!.body!)).toMatchObject({ mode: "BROADCAST_MODE_SYNC" });
    const bad = mockFetch([[/txs$/, broadcastFail(5, "insufficient funds")]]);
    await expect(cosmos.read(COSMOS_METHODS.sendTx, { tx, mode: "sync" }, ctxFor(OSMOSIS_TESTNET, bad.fetch))).rejects.toMatchObject({ userMessage: "You don't have enough OSMO for this and its network fee." });
  });
});

describe("network specs", () => {
  it("every chain has its family's coin type, a prefix, two REST endpoints where available and a fee token", () => {
    for (const c of COSMOS_CHAINS) {
      expect(c.coinType).toBe({ cosmos: 118, provenance: 505, thorchain: 931, initia: 60 }[c.family]);
      expect(c.rest.length).toBeGreaterThanOrEqual(c.chainId === "pio-testnet-1" || c.chainId === "initiation-2" ? 1 : 2);
      expect(c.feeTokens[0]!.denom).toBe(c.native.denom);
      expect(c.rest.every((u) => u.startsWith("https://") && !/key=|apikey/i.test(u))).toBe(true);
    }
    expect(COSMOS_CHAINS.filter((c) => c.testnet).map((c) => c.chainId)).toEqual(["osmo-test-5", "dydx-testnet-4", "zig-test-2", "pio-testnet-1", "initiation-2"]);
  });

  it("an account type the node wraps (vesting) still yields number and sequence", async () => {
    const { getAccount, restFor } = await import("../src/rest.js");
    const vesting = {
      account: {
        "@type": "/cosmos.vesting.v1beta1.ContinuousVestingAccount",
        base_vesting_account: { base_account: { address: ADDR.osmo, pub_key: null, account_number: "77", sequence: "3" }, original_vesting: [] },
      },
    };
    const m = mockFetch([
      [/account_info/, reply(501, { code: 12, message: "Not Implemented" })],
      [/accounts\//, vesting],
    ]);
    const a = await getAccount(restFor(ctxFor(OSMOSIS_TESTNET, m.fetch)), ADDR.osmo);
    expect(a).toMatchObject({ accountNumber: 77n, sequence: 3n });
    expect(accountInfo).toBeTypeOf("function");
    expect(makeAccount("cosmos").address).toBe(VAULT_ADDRESS.cosmos);
  });
});

describe("1Mask's chain table (packages/1mask/src/shared/cosmos.ts) matches these networks", () => {
  it("same chains, families, prefixes, coin types, key algos, natives and gas prices", async () => {
    const { COSMOS_CHAIN_FACTS } = await import("../../1mask/src/shared/cosmos.js");
    expect(COSMOS_CHAIN_FACTS.map((c) => c.chainId)).toEqual(COSMOS_CHAINS.map((c) => c.chainId));
    for (const f of COSMOS_CHAIN_FACTS) {
      const s = COSMOS_CHAINS.find((c) => c.chainId === f.chainId)!;
      expect({ family: f.family, prefix: f.prefix, coinType: f.coinType, algo: f.algo, testnet: f.testnet, name: f.chainName }).toEqual({
        family: s.family,
        prefix: s.prefix,
        coinType: s.coinType,
        algo: s.keyKind,
        testnet: s.testnet,
        name: s.name,
      });
      expect(f.native).toEqual({ coinDenom: s.native.symbol, coinMinimalDenom: s.native.denom, coinDecimals: s.native.decimals });
      expect(f.gas).toEqual({ low: Number(s.feeTokens[0]!.low), average: Number(s.feeTokens[0]!.average), high: Number(s.feeTokens[0]!.high) });
      expect(f.usdc).toBe(s.tokens?.find((t) => t.key === "usdc")?.denom);
    }
  });
});
