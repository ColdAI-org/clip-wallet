/**
 * Keystone over BC-UR. Two kinds of fixtures:
 *  - Keystone's own SDK test vectors (KeystoneHQ/keystone-sdk-base and KeystoneHQ/ur-registry, see
 *    README "Tests and fixtures"): exact UR strings our code must produce or read.
 *  - End-to-end: the device side is played by the Keystone registry classes (encode only). Its
 *    signatures are the ones the recorded Ledger sessions produced for the same phrase and payloads,
 *    so they verify against the same accounts. Nothing here generates keys or signs.
 */
import { describe, expect, it } from "vitest";
import { CryptoHDKey, CryptoKeypath, CryptoMultiAccounts, CryptoPSBT, PathComponent } from "@keystonehq/bc-ur-registry";
import { ETHSignature, EthSignRequest } from "@keystonehq/bc-ur-registry-eth";
import { SolSignRequest, SolSignature } from "@keystonehq/bc-ur-registry-sol";
import { KeystoneSDK } from "@keystonehq/keystone-sdk";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";
import { SigHash, Transaction } from "@scure/btc-signer";
import { ClipError } from "@clip-wallet/core";
import {
  AnimatedUr,
  HardwareKeyring,
  KeystoneSigner,
  UR,
  UrCollector,
  WrongUrType,
  decodeSingle,
  decodeXpub,
  type HardwareAccount,
  type KeystoneExchange,
} from "../src/index.js";
import * as I from "./inputs.js";
import { fixture, memoryStorage } from "./helpers.js";

/* ------------------------------------------------------------------ Keystone SDK vectors */

const V = {
  // keystone-sdk-base packages/ur-registry-eth/__tests__/EthSignRequest.test.ts ("construct from string")
  ethSignRequest:
    "ur:eth-sign-request/onadtpdagdndcawmgtfrkigrpmndutdnbtkgfssbjnaohdgryagalalnascsgljpnbaelfdibemwaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaelaoxlbjyihjkjyeyaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaehnaehglalalaaxadaaadahtaaddyoeadlecsdwykadykadykaewkadwkaocybgeehfkswdtklffd",
  ethRlp: "f849808609184e72a00082271094000000000000000000000000000000000000000080a47f7465737432000000000000000000000000000000000000000000000000000000600057808080",
  requestId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  // .../EthSignature.test.ts
  ethSignature:
    "ur:eth-signature/otadtpdagdndcawmgtfrkigrpmndutdnbtkgfssbjnaohdfptywtosrftahprdctrkbegylogdghjkbafhflamfwlohghtpsseaozorsimnybbtnnbiynlckenbtfmeeamsabnaeoxasjkwswfkekiieckhpecckssptndzelnwfecylbwaxisjeihkkjkjyjljtihdwlkamiy",
  ethSignatureHex: "d4f0a7bcd95bba1fbb1051885054730e3f47064288575aacc102fbbf6a9a14daa066991e360d3e3406c20c00a40973eff37c7d641e5b351ec4a99bfe86f335f713",
  // .../ur-registry-sol/__tests__/SolSignature.test.ts
  solSignature:
    "ur:sol-signature/oeadtpdagdndcawmgtfrkigrpmndutdnbtkgfssbjnaohdfztywtosrftahprdctrkbegylogdghjkbafhflamfwlohghtpsseaozorsimnybbtnnbiynlckenbtfmeeamsabnaeoxasjkwswfkekiieckhpecckssptndzelnwfecyldrcyhkws",
  // .../ur-registry-eth/__tests__/CryptoHDKey.test.ts: the m/44'/60'/0' key of the BIP-39 test vector phrase
  ethHdKey:
    "ur:crypto-hdkey/oxaxhdclaowdverokopdinhseeroisyalksaykctjshedprnuyjyfgrovawewftyghceglrpkgaahdcxtplfjsluknfwlaisaxwypalbjylswzamcxhscyuyloztmwfnldlgskpyptgsdecfamtaaddyoeadlncsdwykcsfnykaeykaocywlcscewfaycytedmfeayghlptnin",
  // KeystoneHQ/ur-registry __tests__/extended/CryptoMultiAccounts.test.ts
  multiAccounts:
    "ur:crypto-multi-accounts/onadcywlcscewfaolytaaddloeaxhdclaowdverokopdinhseeroisyalksaykctjshedprnuyjyfgrovawewftyghceglrpkgamtaaddyoyadlocsdwykcfadykykaeykaeykaxisjeihkkjkjyjljtihaaksdeeyeteeemeciaetieetdyiyeniadyenidhsiyidiheeenhsemieehemecdyiyeoiyiaiyeyeceneciyemahihehdmdydmeyksrlzmdi",
  // KeystoneHQ/ur-registry __tests__/CryptoPSBT.test.ts
  psbt:
    "ur:crypto-psbt/hdosjojkidjyzmadaenyaoaeaeaeaohdvsknclrejnpebncnrnmnjojofejzeojlkerdonspkpkkdkykfelokgprpyutkpaeaeaeaeaezmzmzmzmlslgaaditiwpihbkispkfgrkbdaslewdfycprtjsprsgksecdratkkhktikewdcaadaeaeaeaezmzmzmzmaojopkwtayaeaeaeaecmaebbtphhdnjstiambdassoloimwmlyhygdnlcatnbggtaevyykahaeaeaeaecmaebbaeplptoevwwtyakoonlourgofgvsjydpcaltaemyaeaeaeaeaeaeaeaeaebkgdcarh",
  psbtHex:
    "70736274ff01009a020000000258e87a21b56daf0c23be8e7070456c336f7cbaa5c8757924f545887bb2abdd750000000000ffffffff838d0427d0ec650a68aa46bb0b098aea4422c071b2ca78352a077959d07cea1d0100000000ffffffff0270aaf00800000000160014d85c2b71d0060b09c9886aeb815e50991dda124d00e1f5050000000016001400aea9a2e5f0f876a588df5546e8742d1d87008f000000000000000000",
};

describe("Keystone SDK vectors", () => {
  const sdk = new KeystoneSDK();

  it("eth-sign-request: the SDK call we make produces Keystone's vector byte for byte", () => {
    const ur = sdk.eth.generateSignRequest({
      requestId: V.requestId,
      signData: V.ethRlp,
      dataType: 1,
      path: "M/44'/1'/1'/0/1",
      xfp: "12345678",
      chainId: 1,
    });
    expect(new AnimatedUr(ur, 1000).next().toLowerCase()).toBe(V.ethSignRequest);
    const back = EthSignRequest.fromCBOR(decodeSingle(V.ethSignRequest).cbor);
    expect(back.getSignData().toString("hex")).toBe(V.ethRlp);
    expect(back.getDerivationPath()).toBe("44'/1'/1'/0/1");
  });

  it("eth-signature and sol-signature decode (upper-case QR text accepted)", () => {
    const eth = sdk.eth.parseSignature(decodeSingle(V.ethSignature.toUpperCase()));
    expect(eth).toMatchObject({ signature: V.ethSignatureHex, requestId: V.requestId, origin: "keystone" });
    const sol = sdk.sol.parseSignature(decodeSingle(V.solSignature));
    expect(sol.signature).toBe(V.ethSignatureHex.slice(0, 128));
    expect(sol.requestId).toBe(V.requestId);
  });

  it("crypto-psbt round trip", () => {
    const c = new UrCollector(["crypto-psbt"]);
    expect(c.receive(V.psbt).done).toBe(true);
    expect(sdk.btc.parsePSBT(c.result())).toBe(V.psbtHex);
    expect(new AnimatedUr(sdk.btc.generatePSBT(Buffer.from(V.psbtHex, "hex")), 1000).next().toLowerCase()).toBe(V.psbt);
  });

  it("a crypto-hdkey export yields the same EVM accounts as the vault and the Ledger for that phrase", async () => {
    const ks = new KeystoneSigner({ channel: noChannel, storage: memoryStorage() });
    const sync = await ks.importSync(decodeSingle(V.ethHdKey));
    expect(sync.fingerprint).toBe("e9181cf3");
    const list = await ks.listAccounts("evm", 0, 2);
    expect(list.map((a) => a.address)).toEqual((I.ACCOUNTS.evm.accounts as HardwareAccount[]).map((a) => a.address));
    expect(list[0]!.address).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    expect(list[0]!.id).toBe("hw:keystone:e9181cf3:evm:0");
  });

  it("crypto-multi-accounts: device info and keys are kept; missing families say 'scan first'", async () => {
    const ks = new KeystoneSigner({ channel: noChannel, storage: memoryStorage() });
    const sync = await ks.importSync(decodeSingle(V.multiAccounts));
    expect(sync).toMatchObject({ fingerprint: "e9181cf3", device: "keystone" });
    expect(sync.keys[0]!.path).toBe("m/44'/501'/0'/0'");
    await expect(ks.listAccounts("bitcoin", 0, 1)).rejects.toMatchObject({ code: "hw/not-synced" });
    await expect(ks.listAccounts("hedera", 0, 1)).rejects.toMatchObject({ code: "hw/unsupported" });
  });
});

/* ------------------------------------------------------------------ animated QR */

describe("animated UR", () => {
  it("fountain parts reassemble in any order, with frames missing", () => {
    const big = new UR(Buffer.from(new Uint8Array(3000).map((_, i) => (i * 7) % 256)), "bytes");
    const a = new AnimatedUr(big, 100);
    expect(a.animated).toBe(true);
    const frames = Array.from({ length: a.parts * 3 }, () => a.next());
    const c = new UrCollector(["bytes"]);
    let done = false;
    // drop every 3rd frame and feed the rest backwards
    for (const f of frames.filter((_, i) => i % 3 !== 0).reverse()) {
      if ((done = c.receive(f).done)) break;
    }
    expect(done).toBe(true);
    expect(Buffer.from(c.result().cbor).equals(Buffer.from(big.cbor))).toBe(true);
  });

  it("ignores non-UR codes and rejects the wrong UR type", () => {
    const c = new UrCollector(["eth-signature"]);
    expect(c.receive("https://example.com").done).toBe(false);
    expect(() => c.receive(V.solSignature)).toThrow(WrongUrType);
  });
});

/* ------------------------------------------------------------------ end to end */

const noChannel = { exchange: async (): Promise<UR> => Promise.reject(new Error("no device")) };

/** A pretend Keystone: reads our animated request, checks it, answers with an animated UR. */
function device(answer: (req: UR) => UR): { channel: { exchange(x: KeystoneExchange): Promise<UR> }; seen: UR[] } {
  const seen: UR[] = [];
  return {
    seen,
    channel: {
      async exchange(x) {
        const inbound = new UrCollector();
        while (!inbound.receive(x.request.next()).done);
        const req = inbound.result();
        seen.push(req);
        const out = new AnimatedUr(answer(req), 80);
        const back = new UrCollector(x.expect);
        while (!back.receive(out.next()).done);
        return back.result();
      },
    },
  };
}

/** r||s from the recorded Ledger session for the same payload (same phrase, same digest). */
function recordedSig(session: string): Uint8Array {
  const lines = fixture(`ledger-${session}.apdus`).trim().split("\n");
  const last = lines[lines.length - 1]!.slice(3);
  return hex.decode(last.slice(0, -4)); // drop 9000
}

async function keyring(ks: KeystoneSigner, accounts: HardwareAccount[]) {
  const k = new HardwareKeyring({ signers: { keystone: ks }, storage: memoryStorage() });
  await k.addAccounts(accounts);
  return k;
}

describe("Keystone signing end to end", () => {
  it("EVM transaction: eth-sign-request carries the RLP, path, fingerprint and chain id", async () => {
    const vrs = recordedSig("evm-sign-tx"); // Ledger answers v || r || s
    const tx = I.evmTx();
    const d = device((req) => {
      const r = EthSignRequest.fromCBOR(req.cbor);
      expect(req.type).toBe("eth-sign-request");
      expect(r.getSignData().toString("hex")).toBe(hex.encode(tx.raw));
      expect(r.getDataType()).toBe(4); // typedTransaction (EIP-1559)
      expect(r.getDerivationPath()).toBe("44'/60'/0'/0/0");
      expect(r.getSourceFingerprint().toString("hex")).toBe("e9181cf3");
      expect(r.getChainId()).toBe(I.SEPOLIA);
      const rsv = Buffer.concat([Buffer.from(vrs.slice(1)), Buffer.from([vrs[0]!])]);
      return new ETHSignature(rsv, r.getRequestId()).toUR();
    });
    const ks = new KeystoneSigner({ channel: d.channel, storage: memoryStorage() });
    await ks.importSync(decodeSingle(V.ethHdKey));
    const [acct] = await ks.listAccounts("evm", 0, 1);
    const k = await keyring(ks, [acct!]);
    const p = I.payload(acct!.id, "ecdsa-secp256k1", tx.digest, { format: "evm-tx", bytes: tx.raw, chainId: I.SEPOLIA });
    k.registerApproval(p.approvalId, [p], 60_000);
    const sig = await k.sign(p, { request: I.request("evm", "eth_sendTransaction", "eip155:11155111"), decoded: I.decoded("eip155:11155111") });
    expect(secp256k1.Signature.fromBytes(sig.bytes, "compact").addRecoveryBit(sig.recovery!).recoverPublicKey(tx.digest).toHex(true)).toBe(acct!.publicKey);
    expect(d.seen).toHaveLength(1);
  });

  it("a signature for another request id is refused", async () => {
    const d = device((req) => new ETHSignature(Buffer.alloc(65, 1), Buffer.from("1b4e28ba2fa111d2883f0016d3cca427", "hex")).toUR());
    const ks = new KeystoneSigner({ channel: d.channel, storage: memoryStorage() });
    await ks.importSync(decodeSingle(V.ethHdKey));
    const [acct] = await ks.listAccounts("evm", 0, 1);
    const m = I.evmPersonal();
    const p = I.payload(acct!.id, "ecdsa-secp256k1", m.digest, { format: "evm-personal", bytes: m.raw });
    await expect(ks.sign(p, { request: I.request("evm", "personal_sign", "eip155:1"), decoded: I.decoded("eip155:1"), account: acct! })).rejects.toMatchObject({ code: "hw/wrong-request" });
  });

  it("Solana: sol-sign-request with the message bytes; account from a multi-accounts export", async () => {
    const sol = (I.ACCOUNTS.solana.accounts as HardwareAccount[])[0]!;
    const path = new CryptoKeypath([44, 501, 0, 0].map((index) => new PathComponent({ index, hardened: true })), Buffer.from("73c5da0a", "hex"));
    const exportUr = new CryptoMultiAccounts(Buffer.from("73c5da0a", "hex"), [new CryptoHDKey({ isMaster: false, key: Buffer.from(sol.publicKey, "hex"), origin: path })], "Keystone 3 Pro").toUR();
    const msg = I.solTransfer(sol.publicKey);
    const sigBytes = recordedSig("solana-sign-tx");
    const d = device((req) => {
      const r = SolSignRequest.fromCBOR(req.cbor);
      expect(r.getSignData().toString("hex")).toBe(hex.encode(msg));
      expect(r.getDerivationPath()).toBe("44'/501'/0'/0'");
      expect(r.getSignType()).toBe(1);
      return new SolSignature(Buffer.from(sigBytes), r.getRequestId()).toUR();
    });
    const ks = new KeystoneSigner({ channel: d.channel, storage: memoryStorage() });
    await ks.importSync(new UR(Buffer.from(exportUr.cbor), exportUr.type));
    const [acct] = await ks.listAccounts("solana", 0, 1);
    expect(acct!.address).toBe(sol.address);
    const k = await keyring(ks, [acct!]);
    const p = I.payload(acct!.id, "ed25519", msg, { format: "solana-tx", bytes: msg });
    k.registerApproval(p.approvalId, [p], 60_000);
    const sig = await k.sign(p, { request: I.request("solana", "solana:signTransaction", "solana:devnet"), decoded: I.decoded("solana:devnet") });
    expect(hex.encode(sig.bytes)).toBe(hex.encode(sigBytes));
  });

  it("Bitcoin: crypto-psbt with our BIP-32 derivation in, signed crypto-psbt back", async () => {
    const btc = (I.ACCOUNTS.bitcoin.accounts as HardwareAccount[])[0]!;
    const node = decodeXpub(btc.hardware.accountXpub!);
    const origin = new CryptoKeypath([new PathComponent({ index: 84, hardened: true }), new PathComponent({ index: 1, hardened: true }), new PathComponent({ index: 0, hardened: true })], Buffer.from("73c5da0a", "hex"));
    const hd = new CryptoHDKey({ isMaster: false, key: Buffer.from(node.publicKey), chainCode: Buffer.from(node.chainCode), origin, parentFingerprint: Buffer.alloc(4) }).toUR();
    const t = I.btcPsbt(btc.publicKey);
    const der = secp256k1.Signature.fromBytes(recordedSigFromPsbt(), "compact").toBytes("der");
    const d = device((req) => {
      const tx = Transaction.fromPSBT(CryptoPSBT.fromCBOR(req.cbor).getPSBT(), { allowUnknownOutputs: true });
      const deriv = tx.getInput(0).bip32Derivation!;
      expect(hex.encode(deriv[0]![0])).toBe(btc.publicKey);
      expect(deriv[0]![1].fingerprint).toBe(0x73c5da0a);
      tx.updateInput(0, { partialSig: [[hex.decode(btc.publicKey), new Uint8Array([...der, SigHash.ALL])]] }, true);
      return new CryptoPSBT(Buffer.from(tx.toPSBT(0))).toUR();
    });
    const ks = new KeystoneSigner({ channel: d.channel, storage: memoryStorage() });
    await ks.importSync(new UR(Buffer.from(hd.cbor), hd.type));
    const [acct] = await ks.listAccounts("bitcoin", 0, 1);
    expect(acct!.address).toBe(btc.address);
    // Same key and chain code as the Ledger's xpub (the export doesn't carry the parent fingerprint).
    const mine = decodeXpub(acct!.hardware.accountXpub!);
    expect(hex.encode(mine.publicKey)).toBe(hex.encode(node.publicKey));
    expect(hex.encode(mine.chainCode)).toBe(hex.encode(node.chainCode));
    expect(mine.childNumber).toBe(node.childNumber);
    const k = await keyring(ks, [acct!]);
    const p = I.payload(acct!.id, "ecdsa-secp256k1", t.digest, { format: "psbt", bytes: t.psbt, inputIndex: 0 });
    k.registerApproval(p.approvalId, [p], 60_000);
    await k.sign(p, { request: I.request("bitcoin", "signPsbt", "bip122:testnet"), decoded: I.decoded("bip122:testnet") });
  });

  it("errors are plain words", async () => {
    const ks = new KeystoneSigner({ channel: noChannel, storage: memoryStorage() });
    const e = await ks.listAccounts("evm", 0, 1).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ClipError);
    expect((e as ClipError).userMessage).toMatch(/^Scan your Keystone's account QR code first/);
    await expect(ks.importSync(decodeSingle(V.ethSignature))).rejects.toMatchObject({ code: "hw/wrong-qr" });
  });
});

/** The compact signature the recorded Ledger Bitcoin session put on input 0. */
function recordedSigFromPsbt(): Uint8Array {
  // The final APDU exchange of the session yields the partial signature as a YIELD (0x41 tag) of
  // input index || pubkey len || pubkey || DER sig. We read it straight from the recording.
  const lines = fixture("ledger-bitcoin-sign-psbt.apdus").trim().split("\n");
  const yields = lines.filter((l) => l.startsWith("<= 10")); // CLIENT_INTERRUPTED responses (0xE000 → 10 = YIELD command)
  for (const y of yields) {
    const b = hex.decode(y.slice(3, -4));
    if (b[0] !== 0x10) continue;
    // b: 0x10 | input index (varint) | pubkey len | pubkey | signature (DER + sighash)
    const pkLen = b[2]!;
    const der = b.slice(3 + pkLen, b.length - 1);
    return secp256k1.Signature.fromBytes(der, "der").toBytes("compact");
  }
  throw new Error("no yielded signature in recording");
}

describe("KeystoneBridge (background side of the QR exchange)", () => {
  it("parks the request for the approval window and resumes the signer with the scanned answer", async () => {
    const { KeystoneBridge } = await import("../src/index.js");
    const changes: number[] = [];
    const bridge = new KeystoneBridge(() => changes.push(1));
    const sigUr = decodeSingle(V.ethSignature);
    const pending = bridge.exchange({
      approvalId: "a1",
      request: new AnimatedUr(decodeSingle(V.ethSignRequest)),
      expect: ["eth-signature"],
      title: "t",
      requestContext: { request: I.request("evm", "personal_sign", "eip155:1"), decoded: I.decoded("eip155:1") },
    });
    expect(bridge.current("a1")).toMatchObject({ type: "eth-sign-request", expect: ["eth-signature"] });
    expect(() => bridge.answer("a1", { type: "sol-signature", cborHex: "00" })).toThrow(/isn't the signature/);
    bridge.answer("a1", { type: sigUr.type, cborHex: Buffer.from(sigUr.cbor).toString("hex") });
    expect((await pending).type).toBe("eth-signature");
    expect(bridge.current("a1")).toBeUndefined();
    expect(changes.length).toBe(2);

    const again = bridge.exchange({ approvalId: "a2", request: new AnimatedUr(sigUr), expect: ["x"], title: "t", requestContext: { request: I.request("evm", "m", "n"), decoded: I.decoded("n") } });
    bridge.cancelAll();
    await expect(again).rejects.toMatchObject({ code: "hw/cancelled" });
  });
});
