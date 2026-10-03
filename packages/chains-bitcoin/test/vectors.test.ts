import type { Account } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base64, hex } from "@scure/base";
import { Address, NETWORK, OutScript, RawWitness, Transaction, p2wpkh } from "@scure/btc-signer";
import { describe, expect, it } from "vitest";
import { derivationPath, derivationPathTaproot, ownScripts, segwitAddress, taprootAddress } from "../src/keys.js";
import { bip322Digest, bip322MessageHash, bip322ToSign, bip322ToSpend, txidOf } from "../src/message.js";
import { BITCOIN_MAINNET, networkById } from "../src/networks.js";
import { TX_OPTS, analyzePsbt, inputDigests } from "../src/psbt.js";

const MAIN = networkById(BITCOIN_MAINNET)!;
const enc = new TextEncoder();

describe("BIP-84 / BIP-86 test vectors (abandon … about)", () => {
  it("paths", () => {
    expect(derivationPath(0, true)).toBe("m/84'/0'/0'/0/0");
    expect(derivationPathTaproot(2, true)).toBe("m/86'/0'/0'/0/2");
    expect(derivationPath(3)).toBe("m/84'/1'/0'/0/3"); // testnet default, same as @clip-wallet/vault
  });
  it("BIP-84 m/84'/0'/0'/0/0 → bc1qcr8te4…", () => {
    expect(segwitAddress(hex.decode("0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c"), MAIN)).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  });
  it("BIP-86 m/86'/0'/0'/0/0 → bc1p5cyxnu…", () => {
    expect(taprootAddress(hex.decode("03cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115"), MAIN)).toBe(
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
    );
  });
});

describe("BIP-143 native P2WPKH sighash", () => {
  it("matches the spec's sigHash for input 1", () => {
    const raw = hex.decode(
      "0100000002fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f0000000000eeffffffef51e1b804cc89d182d279655c3aa89e815b1b309fe287d9b2b55d57b90ec68a0100000000ffffffff02202cb206000000001976a9148280b37df378db99f66f85c95a783a76ac7a6d5988ac9093510d000000001976a9143bde42dbee7e4dbe6a21b2d50ce2f0167faa815988ac11000000",
    );
    const pub = "025476c2e83188368da1ff3e292e7acafcdb3566bb0ad253f62fc70f07aeee6357";
    expect(hex.encode(p2wpkh(hex.decode(pub)).script)).toBe("00141d0f172a0ecb48aee1be1f2687d2963ae33f71a1");
    const tx = Transaction.fromRaw(raw, TX_OPTS);
    tx.updateInput(1, { witnessUtxo: { script: p2wpkh(hex.decode(pub)).script, amount: 600_000_000n } }, true);
    const account: Account = { id: "bitcoin:0", family: "bitcoin", index: 0, curve: "secp256k1", derivationPath: "", publicKey: pub, address: "" };
    const a = analyzePsbt(tx, account, MAIN, [{ index: 1, sighash: 1 }]);
    const [d] = inputDigests(tx, a);
    expect(d!.kind).toBe("wpkh");
    expect(hex.encode(d!.digest)).toBe("c37af31116d1b27caf68aae9e3ac82f1477929014d5b917657d0eb49478cb670");
  });
});

describe("BIP-322 simple test vectors", () => {
  const script = OutScript.encode(Address(NETWORK).decode("bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l"));
  it.each([
    ["", "c90c269c4f8fcbe6880f72a721ddfbf1914268a794cbb21cfafee13770ae19f1", "c5680aa69bb8d860bf82d4e9cd3504b55dde018de765a91bb566283c545a99a7", "1e9654e951a5ba44c8604c4de6c67fd78a27e81dcadcfe1edf638ba3aaebaed6"],
    ["Hello World", "f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a", "b79d196740ad5217771c1098fc4a4b51e0535c32236c71f1ea4d61a2d603352b", "88737ae86f2077145f93cc4b153ae9a1cb8d56afa511988c149c5c8c9d93bddf"],
  ])("message %j: hash, to_spend and to_sign ids", (m, hash, toSpend, toSign) => {
    expect(hex.encode(bip322MessageHash(enc.encode(m)))).toBe(hash);
    expect(hex.encode(txidOf(bip322ToSpend(enc.encode(m), script)))).toBe(toSpend);
    expect(bip322ToSign(enc.encode(m), script).id).toBe(toSign);
  });

  it("the published 'Hello World' signature verifies against our digest", () => {
    const w = RawWitness.decode(
      base64.decode("AkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI="),
    );
    const pub = w[1]!;
    const own = ownScripts({ id: "x", family: "bitcoin", index: 0, curve: "secp256k1", derivationPath: "", publicKey: hex.encode(pub), address: "" });
    const digest = bip322Digest(enc.encode("Hello World"), "wpkh", own);
    const sig = secp256k1.Signature.fromBytes(w[0]!.slice(0, -1), "der").toBytes("compact");
    expect(secp256k1.verify(sig, digest, pub, { prehash: false })).toBe(true);
  });
});
