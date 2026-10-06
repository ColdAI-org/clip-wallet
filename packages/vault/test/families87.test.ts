/**
 * networks87 families: known-answer tests for the public BIP-39 vector "abandon … about", each cross-checked against
 * the ecosystem's own official SDK (devDependencies only): cosmjs, xrpl.js, TronWeb, WharfKit, MultiversX sdk-core,
 * @dfinity/identity-secp256k1, @stacks/wallet-sdk, fuels-ts and libauth. Literal expected values are what those
 * SDKs print for the phrase; the cross-checks re-derive them on every run.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mnemonicToEntropy, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { bech32 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { Secp256k1HdWallet } from "@cosmjs/amino";
import { stringToPath } from "@cosmjs/crypto";
import { Wallet as XrplWallet } from "xrpl";
import { TronWeb } from "tronweb";
import { Bytes, KeyType, PrivateKey as AntelopePrivateKey, PublicKey as AntelopePublicKey, Signature as AntelopeSignature, Checksum256 } from "@wharfkit/antelope";
import { Mnemonic as MvxMnemonic } from "@multiversx/sdk-core";
import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import { generateWallet, getStxAddress } from "@stacks/wallet-sdk";
import { Wallet as FuelWallet } from "fuels";
import { deriveHdPath, deriveHdPrivateNodeFromSeed, encodeCashAddress, hash160, secp256k1 as libauthSecp } from "@bitauth/libauth";
import { HDNodeWallet } from "ethers";
import { toHex } from "../src/bytes.js";
import { CURVE_OF, deriveFamilyKey, derivationPath, type KeySource } from "../src/derive.js";
import { defaultAddressOf } from "../src/address.js";
import {
  antelopeLegacyPublicKey,
  antelopePublicKey,
  bitcoincashAddress,
  cashAddress,
  cosmosAddress,
  fuelAddress,
  icpAccountIdentifier,
  icpPrincipal,
  icpPrincipalBytes,
  initiaAddress,
  multiversxAddress,
  stacksAddress,
  tronAddress,
  xrplAddress,
} from "../src/encodings87.js";
import { isCanonicalK1, signEcdsaCanonical } from "../src/sign.js";
import type { Family } from "@clip-wallet/core";

// Public BIP-39 test phrase (official vectors). Never a real wallet.
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

let src: KeySource;
beforeAll(async () => {
  src = { seed: await mnemonicToSeed(ABANDON), entropy: mnemonicToEntropy(ABANDON, wordlist) };
});

const key = (family: Family, i: number) => deriveFamilyKey(src, family, derivationPath(family, i));
const ctx = { bitcoinNetwork: "testnet", bitcoinAddressType: "p2wpkh" } as const;

describe("networks87 derivation paths", () => {
  it("use each ecosystem's standard SLIP-44 path and curve", () => {
    const want: [Family, string, string][] = [
      ["cosmos", "m/44'/118'/0'/0/1", "secp256k1"],
      ["provenance", "m/44'/505'/0'/0/1", "secp256k1"],
      ["thorchain", "m/44'/931'/0'/0/1", "secp256k1"],
      ["initia", "m/44'/60'/0'/0/1", "secp256k1"],
      ["tron", "m/44'/195'/0'/0/1", "secp256k1"],
      ["xrpl", "m/44'/144'/1'/0/0", "secp256k1"],
      ["antelope", "m/44'/194'/0'/0/1", "secp256k1"],
      ["multiversx", "m/44'/508'/0'/0'/1'", "ed25519"],
      ["icp", "m/44'/223'/0'/0/1", "secp256k1"],
      ["stacks", "m/44'/5757'/0'/0/1", "secp256k1"],
      ["fuel", "m/44'/1179993420'/1'/0/0", "secp256k1"],
      ["bitcoincash", "m/44'/145'/0'/0/1", "secp256k1"],
    ];
    for (const [f, path, curve] of want) {
      expect(derivationPath(f, 1), f).toBe(path);
      expect(CURVE_OF[f], f).toBe(curve);
    }
  });
});

describe("cosmos SDK (cosmjs Secp256k1HdWallet)", () => {
  const cases: [Family, string, string][] = [
    ["cosmos", "cosmos", "118"],
    ["cosmos", "osmo", "118"],
    ["cosmos", "dydx", "118"],
    ["cosmos", "zig", "118"],
    ["provenance", "pb", "505"],
    ["thorchain", "thor", "931"],
  ];
  it.each(cases)("%s %s1… at coin %s matches cosmjs for accounts 0..1", async (family, prefix, coin) => {
    for (const i of [0, 1]) {
      const w = await Secp256k1HdWallet.fromMnemonic(ABANDON, { hdPaths: [stringToPath(`m/44'/${coin}'/0'/0/${i}`)], prefix });
      const [a] = await w.getAccounts();
      const k = key(family, i);
      expect(toHex(k.publicKey)).toBe(toHex(a!.pubkey));
      expect(cosmosAddress(k.publicKey, prefix)).toBe(a!.address);
    }
  });
  it("published vector: cosmos1… for m/44'/118'/0'/0/0", () => {
    expect(defaultAddressOf("cosmos", key("cosmos", 0).publicKey, ctx)).toBe("cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4");
  });
  it("initia is bech32('init') of the EVM address bytes (ethers HDNodeWallet)", () => {
    const evm = HDNodeWallet.fromPhrase(ABANDON, undefined, "m/44'/60'/0'/0/0").address;
    const bytes = Uint8Array.from(Buffer.from(evm.slice(2), "hex"));
    expect(initiaAddress(key("initia", 0).publicKey)).toBe(bech32.encode("init", bech32.toWords(bytes)));
    expect(defaultAddressOf("initia", key("initia", 0).publicKey, ctx)).toBe(initiaAddress(key("initia", 0).publicKey));
  });
});

describe("tron (TronWeb)", () => {
  it("matches TronWeb.fromMnemonic for accounts 0..2", () => {
    for (const i of [0, 1, 2]) {
      const t = TronWeb.fromMnemonic(ABANDON, `m/44'/195'/0'/0/${i}`) as { address: string };
      expect(tronAddress(key("tron", i).publicKey)).toBe(t.address);
    }
    expect(defaultAddressOf("tron", key("tron", 0).publicKey, ctx)).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });
});

describe("xrpl (xrpl.js Wallet.fromMnemonic)", () => {
  it("matches xrpl.js for m/44'/144'/i'/0/0", () => {
    for (const i of [0, 1]) {
      const w = XrplWallet.fromMnemonic(ABANDON, { derivationPath: `m/44'/144'/${i}'/0/0` });
      const k = key("xrpl", i);
      expect(toHex(k.publicKey).toUpperCase()).toBe(w.publicKey);
      expect(xrplAddress(k.publicKey)).toBe(w.classicAddress);
    }
  });
});

describe("antelope (WharfKit)", () => {
  it("public key strings match WharfKit for the same private key", () => {
    for (const i of [0, 1]) {
      const k = key("antelope", i);
      const wk = new AntelopePrivateKey(KeyType.K1, Bytes.from(k.privateKey)).toPublic();
      expect(antelopePublicKey(k.publicKey)).toBe(wk.toString());
      expect(antelopeLegacyPublicKey(k.publicKey)).toBe(wk.toLegacyString());
      expect(AntelopePublicKey.from(antelopePublicKey(k.publicKey)).equals(wk)).toBe(true);
    }
  });
  it("signs canonical K1 signatures that WharfKit verifies and recovers, deterministically", () => {
    const k = key("antelope", 0);
    const pub = AntelopePublicKey.from(antelopePublicKey(k.publicKey));
    for (let n = 0; n < 40; n++) {
      const digest = sha256(new TextEncoder().encode(`clip antelope ${n}`));
      const s = signEcdsaCanonical(digest, k.privateKey);
      expect(isCanonicalK1(s.bytes)).toBe(true);
      expect(toHex(signEcdsaCanonical(digest, k.privateKey).bytes)).toBe(toHex(s.bytes));
      const sig = AntelopeSignature.from({ type: KeyType.K1, r: s.bytes.slice(0, 32), s: s.bytes.slice(32), recid: s.recovery });
      const d = Checksum256.from(digest);
      expect(sig.verifyDigest(d, pub)).toBe(true);
      expect(sig.recoverDigest(d).equals(pub)).toBe(true);
      // Same digest signed by wharfkit's own key must also be canonical; ours may differ in nonce but must verify.
      const plain = new AntelopePrivateKey(KeyType.K1, Bytes.from(k.privateKey)).signDigest(d);
      expect(plain.verifyDigest(d, pub)).toBe(true);
    }
  });
});

describe("multiversx (sdk-core Mnemonic)", () => {
  it("matches Mnemonic.deriveKey(i) for accounts 0..2", () => {
    const m = MvxMnemonic.fromString(ABANDON);
    for (const i of [0, 1, 2]) {
      const k = key("multiversx", i);
      const pk = m.deriveKey(i).generatePublicKey();
      expect(toHex(k.publicKey)).toBe(pk.hex());
      expect(multiversxAddress(k.publicKey)).toBe(pk.toAddress().toBech32());
    }
  });
});

describe("icp (@dfinity/identity-secp256k1)", () => {
  it("matches Secp256k1KeyIdentity.fromSeedPhrase (m/44'/223'/0'/0/0)", () => {
    const id = Secp256k1KeyIdentity.fromSeedPhrase(ABANDON);
    const k = key("icp", 0);
    expect(icpPrincipal(k.publicKey)).toBe(id.getPrincipal().toText());
    expect(toHex(icpPrincipalBytes(k.publicKey))).toBe(toHex(id.getPrincipal().toUint8Array()));
    expect(icpAccountIdentifier(icpPrincipalBytes(k.publicKey))).toMatch(/^[0-9a-f]{64}$/);
  });
  it("account identifier of the anonymous principal matches the IC spec example", () => {
    // Anonymous principal 0x04, default subaccount: published in the ICP ledger docs / dfx ledger account-id --of-principal 2vxsx-fae.
    expect(icpAccountIdentifier(Uint8Array.from([4]))).toBe("1c7a48ba6a562aa9eaa2481a9049cdf0433b9738c992d698c31d8abf89cadc79");
  });
});

describe("stacks (@stacks/wallet-sdk)", () => {
  it("matches generateWallet accounts 0..1 on mainnet and testnet", async () => {
    let wallet = await generateWallet({ secretKey: ABANDON, password: "" });
    const { generateNewAccount } = await import("@stacks/wallet-sdk");
    wallet = generateNewAccount(wallet);
    for (const i of [0, 1]) {
      const k = key("stacks", i);
      expect(stacksAddress(k.publicKey, "mainnet")).toBe(getStxAddress(wallet.accounts[i]!, "mainnet"));
      expect(stacksAddress(k.publicKey, "testnet")).toBe(getStxAddress(wallet.accounts[i]!, "testnet"));
    }
  });
});

describe("fuel (fuels-ts Wallet.fromMnemonic)", () => {
  it("matches the Fuel Wallet path for accounts 0..1, checksum included", () => {
    for (const i of [0, 1]) {
      const w = FuelWallet.fromMnemonic(ABANDON, `m/44'/1179993420'/${i}'/0/0`);
      const addr = fuelAddress(key("fuel", i).publicKey);
      expect(addr.toLowerCase()).toBe(w.address.toB256().toLowerCase());
      expect(addr).toBe(w.address.toString());
    }
  });
});

describe("bitcoin cash (libauth)", () => {
  it("matches libauth HD derivation + CashAddr on mainnet and testnet", () => {
    const node = deriveHdPrivateNodeFromSeed(src.seed, { assumeValidity: true, throwErrors: true } as never) as never;
    for (const i of [0, 1]) {
      const child = deriveHdPath(node, `m/44'/145'/0'/0/${i}`) as { privateKey: Uint8Array };
      const pub = libauthSecp.derivePublicKeyCompressed(child.privateKey) as Uint8Array;
      const k = key("bitcoincash", i);
      expect(toHex(k.publicKey)).toBe(toHex(pub));
      const main = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkh", payload: hash160(pub) });
      const test = encodeCashAddress({ prefix: "bchtest", type: "p2pkh", payload: hash160(pub) });
      expect(bitcoincashAddress(k.publicKey, "mainnet")).toBe(typeof main === "string" ? main : (main as { address: string }).address);
      expect(bitcoincashAddress(k.publicKey, "testnet")).toBe(typeof test === "string" ? test : (test as { address: string }).address);
    }
  });
  it("published CashAddr vector (spec test vector, 20-byte P2PKH)", () => {
    // https://reference.cash/protocol/blockchain/encoding/cashaddr test vectors: F5BF48B397DAE70BE82B3CCA4793F8EB2B6CDAC9
    const h = Uint8Array.from(Buffer.from("F5BF48B397DAE70BE82B3CCA4793F8EB2B6CDAC9", "hex"));
    const r = encodeCashAddress({ prefix: "bitcoincash", type: "p2pkh", payload: h });
    expect(typeof r === "string" ? r : (r as { address: string }).address).toBe("bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2");
    expect(cashAddress("bitcoincash", 0, h)).toBe("bitcoincash:qr6m7j9njldwwzlg9v7v53unlr4jkmx6eylep8ekg2");
    const t = encodeCashAddress({ prefix: "bchtest", type: "p2pkh", payload: h });
    expect(cashAddress("bchtest", 0, h)).toBe(typeof t === "string" ? t : (t as { address: string }).address);
  });
});

describe("ClipVault: the networks87 families through the public API", () => {
  const FAST_ARGON2 = { memoryKiB: 256, iterations: 1, parallelism: 1 };
  async function vault() {
    const { ClipVault, MemoryStorage } = await import("../src/index.js");
    const v = new ClipVault({ storage: new MemoryStorage(), argon2: FAST_ARGON2, autoLockMs: 0 });
    await v.importPhrase(ABANDON, "correct horse battery staple");
    return v;
  }
  it("derives every family with the mainnet address forms", async () => {
    const v = await vault();
    const addr = async (f: Family) => (await v.deriveAccount(f, 0)).address;
    expect(await addr("cosmos")).toBe("cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4");
    expect(await addr("provenance")).toMatch(/^pb1[02-9ac-hj-np-z]{38}$/);
    expect(await addr("thorchain")).toMatch(/^thor1[02-9ac-hj-np-z]{38}$/);
    expect(await addr("initia")).toMatch(/^init1[02-9ac-hj-np-z]{38}$/);
    expect(await addr("tron")).toBe((TronWeb.fromMnemonic(ABANDON, "m/44'/195'/0'/0/0") as { address: string }).address);
    expect(await addr("xrpl")).toBe(XrplWallet.fromMnemonic(ABANDON).classicAddress);
    expect(await addr("antelope")).toMatch(/^PUB_K1_/);
    expect(await addr("multiversx")).toBe(MvxMnemonic.fromString(ABANDON).deriveKey(0).generatePublicKey().toAddress().toBech32());
    expect(await addr("icp")).toBe(Secp256k1KeyIdentity.fromSeedPhrase(ABANDON).getPrincipal().toText());
    expect(await addr("stacks")).toMatch(/^SP[0-9A-Z]{38,39}$/);
    expect(await addr("fuel")).toBe(FuelWallet.fromMnemonic(ABANDON).address.toString());
    expect(await addr("bitcoincash")).toMatch(/^bitcoincash:q[02-9ac-hj-np-z]{41}$/);
  });
  it("signs only after approval; Antelope signatures are canonical; MultiversX is ed25519", async () => {
    const { hashSignablePayload } = await import("../src/index.js");
    const v = await vault();
    for (let n = 0; n < 8; n++) {
      const p = { accountId: "antelope:0", scheme: "ecdsa-secp256k1" as const, bytes: sha256(new TextEncoder().encode(`tx ${n}`)) };
      await expect(v.sign({ ...p, approvalId: `none-${n}` })).rejects.toThrow();
      v.registerApproval(`ok-${n}`, [hashSignablePayload(p)], 60_000);
      const s = await v.sign({ ...p, approvalId: `ok-${n}` });
      expect(isCanonicalK1(s.bytes)).toBe(true);
    }
    const p = { accountId: "multiversx:0", scheme: "ed25519" as const, bytes: new TextEncoder().encode("mvx") };
    v.registerApproval("mvx", [hashSignablePayload(p)], 60_000);
    const s = await v.sign({ ...p, approvalId: "mvx" });
    expect(s.bytes).toHaveLength(64);
    const q = { accountId: "tron:0", scheme: "ed25519" as const, bytes: new TextEncoder().encode("x") };
    v.registerApproval("tron", [hashSignablePayload(q)], 60_000);
    await expect(v.sign({ ...q, approvalId: "tron" })).rejects.toThrow();
  });
});
