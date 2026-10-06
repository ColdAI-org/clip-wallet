/**
 * Phase 2 families: known-answer tests for the public BIP-39 vector "abandon … about", each cross-checked
 * against an independent official implementation (devDependencies only), plus signature round-trips
 * verified by those implementations. Literal expected values come from published vectors where one
 * exists (SEP-5, CIP-3, Keystone/Cardano, Pera, Argent X, sp-core dev phrase) and are noted inline.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mnemonicToEntropy, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { base58 } from "@scure/base";
// independent implementations
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Account as AptosAccount, Ed25519PublicKey as AptosPk, Ed25519Signature as AptosSig } from "@aptos-labs/ts-sdk";
import { parseSeedPhrase } from "near-seed-phrase";
import { Keypair as StellarKeypair, StrKey } from "@stellar/stellar-base";
import algosdk from "algosdk";
import { BIP32DerivationType, KeyContext, XHDWalletAPI, fromSeed as xhdFromSeed } from "@algorandfoundation/xhd-wallet-api";
import { InMemorySigner } from "@taquito/signer";
import { deriveEd25519Path, keyPairFromSeed, signVerify } from "@ton/crypto";
import { WalletContractV4, WalletContractV5R1 } from "@ton/ton";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady, sr25519Verify } from "@polkadot/util-crypto";
import { HDNodeWallet } from "ethers";
import { ec as starkEc, hash as starkHash } from "starknet";
import { HDKey as MkpHDKey } from "micro-key-producer/slip10.js";
import { fromHex, toHex, utf8 } from "../src/bytes.js";
import {
  accountNodePath,
  deriveFamilyKey,
  deriveKey,
  derivationPath,
  junctionChainCode,
  starkPrivateKey,
  starkPublicKey,
  substrateJunction,
  substrateMiniSecret,
  substrateSecret,
  type KeySource,
} from "../src/derive.js";
import { deriveArc52, deriveXPrv, icarusMaster, signExtended, xprvPublicKey } from "../src/bip32ed25519.js";
import {
  algorandAddress,
  aptosAddress,
  cardanoBaseAddress,
  cardanoRewardAddress,
  nearImplicitAccount,
  ss58Address,
  starknetOzAccountAddress,
  stellarAddress,
  suiAddress,
  tezosTz1Address,
  tonAddress,
} from "../src/encodings.js";
import { signEd25519, signSr25519, signStark } from "../src/sign.js";
import { STARKNET_OZ_ACCOUNT_CLASS_HASH } from "../src/vault.js";

// Public BIP-39 test phrase (official vectors). Never a real wallet.
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const MSG = utf8("clip wallet phase 2 test message");

let src: KeySource;
beforeAll(async () => {
  src = { seed: await mnemonicToSeed(ABANDON), entropy: mnemonicToEntropy(ABANDON, wordlist) };
});

const key = (family: Parameters<typeof derivationPath>[0], i: number, opts: Parameters<typeof derivationPath>[2] = {}) =>
  deriveFamilyKey(src, family, derivationPath(family, i, opts), opts);

/* ------------------------------------------------------------------ Sui */

describe("sui: SLIP-10 m/44'/784'/i'/0'/0', BLAKE2b-256(0x00 ‖ pk)", () => {
  it("matches @mysten/sui Ed25519Keypair.deriveKeypair for accounts 0..2", () => {
    for (const i of [0, 1, 2]) {
      const path = derivationPath("sui", i);
      expect(path).toBe(`m/44'/784'/${i}'/0'/0'`);
      expect(suiAddress(key("sui", i).publicKey)).toBe(Ed25519Keypair.deriveKeypair(ABANDON, path).toSuiAddress());
    }
    expect(suiAddress(key("sui", 0).publicKey)).toBe("0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1");
  });

  it("signature is byte-identical to @mysten/sui's (Ed25519 is deterministic)", async () => {
    const k = key("sui", 0);
    expect(toHex(signEd25519(MSG, k.privateKey))).toBe(toHex(await Ed25519Keypair.deriveKeypair(ABANDON).sign(MSG)));
  });
});

/* ------------------------------------------------------------------ Aptos */

describe("aptos: SLIP-10 m/44'/637'/i'/0'/0', SHA3-256(pk ‖ 0x00)", () => {
  it("matches aptos-ts-sdk Account.fromDerivationPath (legacy Ed25519 auth key, as Petra)", () => {
    for (const i of [0, 1]) {
      const path = derivationPath("aptos", i);
      const ref = AptosAccount.fromDerivationPath({ path, mnemonic: ABANDON });
      expect(aptosAddress(key("aptos", i).publicKey)).toBe(ref.accountAddress.toString());
    }
    expect(aptosAddress(key("aptos", 0).publicKey)).toBe("0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf");
  });

  it("aptos-ts-sdk verifies the vault's signature", () => {
    const k = key("aptos", 0);
    const sig = signEd25519(MSG, k.privateKey);
    expect(new AptosPk(k.publicKey).verifySignature({ message: MSG, signature: new AptosSig(sig) })).toBe(true);
  });
});

/* ------------------------------------------------------------------ NEAR */

describe("near: SLIP-10 m/44'/397'/i', implicit account = hex(pk)", () => {
  it("matches near-seed-phrase parseSeedPhrase (official NEAR lib) for accounts 0 and 1", () => {
    for (const i of [0, 1]) {
      const path = derivationPath("near", i);
      expect(path).toBe(`m/44'/397'/${i}'`);
      const ref = parseSeedPhrase(ABANDON, path).publicKey.replace(/^ed25519:/, "");
      expect(nearImplicitAccount(key("near", i).publicKey)).toBe(toHex(base58.decode(ref)));
    }
  });

  it("an independent Ed25519 verifier (Stellar's) accepts the signature", () => {
    const k = key("near", 0);
    const sig = signEd25519(MSG, k.privateKey);
    expect(StellarKeypair.fromPublicKey(StrKey.encodeEd25519PublicKey(Buffer.from(k.publicKey))).verify(Buffer.from(MSG), Buffer.from(sig))).toBe(true);
  });
});

/* ------------------------------------------------------------------ Stellar */

describe("stellar: SEP-0005 m/44'/148'/i'", () => {
  // SEP-0005 "Test 5" (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0005.md)
  const SEP5_TEST5 = [
    ["GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX", "SBUV3MRWKNS6AYKZ6E6MOUVF2OYMON3MIUASWL3JLY5E3ISDJFELYBRZ"],
    ["GDVSYYTUAJ3ACHTPQNSTQBDQ4LDHQCMNY4FCEQH5TJUMSSLWQSTG42MV", "SCHDCVCWGAKGIMTORV6K5DYYV3BY4WG3RA4M6MCBGJLHUCWU2MC6DL66"],
    ["GBFPWBTN4AXHPWPTQVQBP4KRZ2YVYYOGRMV2PEYL2OBPPJDP7LECEVHR", "SAPLVTLUXSDLFRDGCCFLPDZMTCEVMP3ZXTM74EBJCVKZKM34LGQPF7K3"],
  ] as const;

  it("official SEP-5 test 5 vectors (accounts 0..2)", () => {
    SEP5_TEST5.forEach(([pub, secret], i) => {
      const k = key("stellar", i);
      expect(stellarAddress(k.publicKey)).toBe(pub);
      // The published secret seed decodes to exactly our private key.
      expect(toHex(StrKey.decodeEd25519SecretSeed(secret))).toBe(toHex(k.privateKey));
    });
  });

  it("@stellar/stellar-base verifies the vault's signature", () => {
    const k = key("stellar", 0);
    expect(StellarKeypair.fromPublicKey(SEP5_TEST5[0][0]).verify(Buffer.from(MSG), Buffer.from(signEd25519(MSG, k.privateKey)))).toBe(true);
  });
});

/* ------------------------------------------------------------------ Algorand */

describe("algorand: ARC-52 BIP32-Ed25519 (Peikert) m/44'/283'/i'/0/0 by default", () => {
  const xhd = new XHDWalletAPI();

  it("matches @algorandfoundation/xhd-wallet-api keyGen for accounts 0..2", async () => {
    const root = xhdFromSeed(Buffer.from(src.seed));
    for (const i of [0, 1, 2]) {
      expect(derivationPath("algorand", i)).toBe(`m/44'/283'/${i}'/0/0`);
      const ref = await xhd.keyGen(root, KeyContext.Address, i, 0, BIP32DerivationType.Peikert);
      expect(toHex(key("algorand", i).publicKey)).toBe(toHex(ref));
      expect(algorandAddress(key("algorand", i).publicKey)).toBe(algosdk.encodeAddress(ref));
    }
  });

  it("Pera Universal Wallet vector (pera-react-native conformance knownAnswerVectors)", async () => {
    const pera = "champion say kitchen sock defense example mesh body sample artwork warfare canvas item recall cheese total floor cycle such asthma okay immense lake street";
    const node = deriveArc52(await mnemonicToSeed(pera), "m/44'/283'/0'/0/0");
    expect(algorandAddress(xprvPublicKey(node.key))).toBe("RP35URKAEVP6PA3WIJGDGA3FZKNV76E7Y2QZPEJ4TDLV72T326B3IOFX7A");
  });

  it("algosdk.verifyBytes accepts a signature made with the extended key (\"MX\" prefix)", () => {
    const k = key("algorand", 0);
    const sig = signExtended(new Uint8Array([...utf8("MX"), ...MSG]), k.privateKey);
    expect(algosdk.verifyBytes(MSG, sig, algorandAddress(k.publicKey))).toBe(true);
  });

  it("matches the reference rawSign byte for byte", async () => {
    const root = xhdFromSeed(Buffer.from(src.seed));
    // rawSign is TS-private in the reference lib; it is the primitive signAlgoTransaction uses.
    const raw = await (xhd as unknown as { rawSign: (r: Uint8Array, p: number[], d: Uint8Array, t: BIP32DerivationType) => Promise<Uint8Array> }).rawSign(root, [0x8000002c, 0x8000011b, 0x80000000, 0, 0], MSG, BIP32DerivationType.Peikert);
    expect(toHex(signExtended(MSG, key("algorand", 0).privateKey))).toBe(toHex(raw));
  });

  it("slip10 option = Trust Wallet m/44'/283'/i'/0'/0' (cross-checked with micro-key-producer)", () => {
    const path = derivationPath("algorand", 0, { algorandScheme: "slip10" });
    expect(path).toBe("m/44'/283'/0'/0'/0'");
    const k = deriveFamilyKey(src, "algorand", path, { algorandScheme: "slip10" });
    expect(k.curve).toBe("ed25519");
    expect(toHex(k.publicKey)).toBe(toHex(ed25519.getPublicKey(MkpHDKey.fromMasterSeed(src.seed).derive(path).privateKey)));
  });
});

/* ------------------------------------------------------------------ Tezos */

describe("tezos: SLIP-10 m/44'/1729'/i'/0', tz1", () => {
  it("matches @taquito/signer InMemorySigner.fromMnemonic (Temple/Kukai path) for accounts 0..2", async () => {
    for (const i of [0, 1, 2]) {
      const path = derivationPath("tezos", i);
      expect(path).toBe(`m/44'/1729'/${i}'/0'`);
      const ref = await InMemorySigner.fromMnemonic({ mnemonic: ABANDON, derivationPath: path.slice(2), curve: "ed25519" });
      expect(tezosTz1Address(key("tezos", i).publicKey)).toBe(await ref.publicKeyHash());
    }
    expect(tezosTz1Address(key("tezos", 0).publicKey)).toBe("tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL");
  });

  it("signing blake2b(watermark ‖ op) gives Taquito's exact signature", async () => {
    const op = new Uint8Array([3, ...MSG]); // generic-operation watermark 0x03
    const ref = await InMemorySigner.fromMnemonic({ mnemonic: ABANDON });
    const theirs = await ref.sign(toHex(MSG), new Uint8Array([3]));
    const mine = signEd25519(blake2b(op, { dkLen: 32 }), key("tezos", 0).privateKey);
    expect(theirs.sbytes).toBe(toHex(MSG) + toHex(mine));
  });
});

/* ------------------------------------------------------------------ TON */

describe("ton: SLIP-10 m/44'/607'/i' (Tonkeeper/Trust BIP-39 import), wallet v5r1", () => {
  it("matches @ton/crypto deriveEd25519Path + @ton/ton WalletContractV5R1/V4 (mainnet + testnet)", async () => {
    for (const i of [0, 1]) {
      expect(derivationPath("ton", i)).toBe(`m/44'/607'/${i}'`);
      const kp = keyPairFromSeed(await deriveEd25519Path(Buffer.from(src.seed), [44, 607, i]));
      const k = key("ton", i);
      expect(toHex(k.publicKey)).toBe(kp.publicKey.toString("hex"));
      for (const [net, id] of [["mainnet", -239], ["testnet", -3]] as const) {
        const v5 = WalletContractV5R1.create({ publicKey: kp.publicKey, workchain: 0, walletId: { networkGlobalId: id } });
        expect(tonAddress(k.publicKey, net)).toBe(v5.address.toString({ bounceable: false, testOnly: net === "testnet" }));
        // v4r2: the standard wallet id on mainnet; off mainnet it is bound to the network (audit CHAIN-L), so a
        // testnet signature can't be replayed on mainnet. Same rule as chains-ton's v4WalletId.
        const walletId = net === "mainnet" ? 698983191 : (698983191 ^ (id >>> 0)) >>> 0;
        const v4 = WalletContractV4.create({ publicKey: kp.publicKey, workchain: 0, walletId });
        expect(tonAddress(k.publicKey, net, "v4r2")).toBe(v4.address.toString({ bounceable: false, testOnly: net === "testnet" }));
        if (net === "testnet") {
          const standard = WalletContractV4.create({ publicKey: kp.publicKey, workchain: 0 });
          expect(tonAddress(k.publicKey, net, "v4r2")).not.toBe(standard.address.toString({ bounceable: false, testOnly: true }));
        }
      }
    }
  });

  it("@ton/crypto signVerify accepts the vault's signature", () => {
    const k = key("ton", 0);
    expect(signVerify(Buffer.from(MSG), Buffer.from(signEd25519(MSG, k.privateKey)), Buffer.from(k.publicKey))).toBe(true);
  });
});

/* ------------------------------------------------------------------ Cardano */

describe("cardano: CIP-3 Icarus + BIP32-Ed25519, CIP-1852 m/1852'/1815'/i'/0/0 and /2/0, CIP-19 base address", () => {
  it("CIP-3 Icarus master key vector", () => {
    const e = mnemonicToEntropy("eight country switch draw meat scout mystery blade tip drift useless good keep usage title", wordlist);
    const m = icarusMaster(e);
    expect(toHex(m.key) + toHex(m.chainCode)).toBe(
      "c065afd2832cd8b087c4d9ab7011f481ee1e0721e78ea5dd609f3ab3f156d245d176bd8fd4ec60b4731c3918a2a72a0226c0cd119ec35b47e4d55884667f552a23f7fdcd4a10c6cd2c7393ac61d877873e248f417634aa3d812af327ffe9d620",
    );
  });

  it("'abandon … about' root (Keystone firmware vector)", () => {
    const m = icarusMaster(src.entropy);
    expect(toHex(m.key) + toHex(m.chainCode)).toBe(
      "60ce7dbec3616e9fc17e0c32578b3f380337b1b61a1f3cb9651aee30670e6f53970419a23a2e4e4082d12bf78faa8645dfc882cee2ae7179e2b07fe88098abb2072310084784c7308182dbbdb1449b2706586f1ff5cbf13d15e9b6e78c15f067",
    );
  });

  it("matches cardano-serialization-lib for accounts 0..2 (keys, base and reward addresses)", () => {
    const h = (n: number) => n + 0x80000000;
    const root = CSL.Bip32PrivateKey.from_bip39_entropy(src.entropy, new Uint8Array());
    for (const i of [0, 1, 2]) {
      const acct = root.derive(h(1852)).derive(h(1815)).derive(h(i));
      const pay = acct.derive(0).derive(0);
      const stake = acct.derive(2).derive(0);
      expect(derivationPath("cardano", i)).toBe(`m/1852'/1815'/${i}'/0/0`);
      const myPay = key("cardano", i);
      const myStake = deriveFamilyKey(src, "cardano", `${accountNodePath("cardano", i)}/2/0`);
      expect(toHex(myPay.privateKey)).toBe(toHex(pay.to_raw_key().as_bytes()));
      expect(toHex(myStake.publicKey)).toBe(toHex(stake.to_public().to_raw_key().as_bytes()));
      for (const [net, id] of [["mainnet", 1], ["testnet", 0]] as const) {
        const ref = CSL.BaseAddress.new(id, CSL.Credential.from_keyhash(pay.to_public().to_raw_key().hash()), CSL.Credential.from_keyhash(stake.to_public().to_raw_key().hash()));
        expect(cardanoBaseAddress(myPay.publicKey, myStake.publicKey, net)).toBe(ref.to_address().to_bech32());
      }
    }
  });

  it("published addresses for 'abandon … about' account 0", () => {
    const pay = key("cardano", 0).publicKey;
    const stake = deriveFamilyKey(src, "cardano", "m/1852'/1815'/0'/2/0").publicKey;
    // Keystone firmware (rust/apps/cardano/src/address.rs), xchainjs, EdgeApp tests.
    expect(cardanoBaseAddress(pay, stake, "mainnet")).toBe("addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mq4afdhv");
    expect(cardanoBaseAddress(pay, stake, "testnet")).toBe("addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn");
    expect(cardanoRewardAddress(stake, "testnet")).toBe("stake_test1urj40zgr2gy4788kl54h6x3gu0pukq5lfr8nflufpg5dzas324ywz");
  });

  it("extended-key signature equals cardano-serialization-lib's and verifies with its PublicKey", () => {
    const k = key("cardano", 0);
    const sig = signExtended(MSG, k.privateKey);
    const ref = CSL.PrivateKey.from_extended_bytes(k.privateKey);
    expect(toHex(sig)).toBe(toHex(ref.sign(MSG).to_bytes()));
    expect(CSL.PublicKey.from_bytes(k.publicKey).verify(MSG, CSL.Ed25519Signature.from_bytes(sig))).toBe(true);
    expect(ed25519.verify(sig, MSG, k.publicKey)).toBe(true);
  });

  it("deriveXPrv refuses malformed paths", () => {
    expect(() => deriveXPrv(src.entropy, "1852'/1815'")).toThrow(/bad path/);
    expect(() => deriveXPrv(src.entropy, "m/1852'/x")).toThrow(/bad path segment/);
  });
});

/* ------------------------------------------------------------------ Substrate */

describe("substrate: substrate-bip39 mini-secret, sr25519, hard junctions, SS58", () => {
  beforeAll(async () => {
    await cryptoWaitReady();
  });

  it("account 0 = root, account i = //(i-1): matches @polkadot/keyring addFromUri", () => {
    const kr = new Keyring({ type: "sr25519", ss58Format: 42 });
    expect([0, 1, 2, 3].map(substrateJunction)).toEqual(["", "//0", "//1", "//2"]);
    for (const i of [0, 1, 2]) {
      const k = key("substrate", i);
      const ref = kr.addFromUri(ABANDON + substrateJunction(i));
      expect(ss58Address(k.publicKey, 42)).toBe(ref.address);
      expect(toHex(k.publicKey)).toBe(toHex(ref.publicKey));
    }
    expect(ss58Address(key("substrate", 0).publicKey)).toBe("5EPCUjPxiHAcNooYipQFWr9NmmXJKpNG5RhcntXwbtUySrgH");
    // Polkadot (prefix 0) encoding of the same key, as the chain module would show it.
    expect(ss58Address(key("substrate", 0).publicKey, 0)).toBe(new Keyring({ type: "sr25519", ss58Format: 0 }).addFromUri(ABANDON).address);
  });

  it("well-known dev phrase vectors (sp-core DEV_PHRASE): root and //Alice", () => {
    const dev = mnemonicToEntropy("bottom drive obey lake curtain smoke basket hold race lonely fit walk", wordlist);
    const pub = (suri: string) => toHex(sr25519Pub(substrateSecret(dev, suri)));
    expect(pub("")).toBe("46ebddef8cd9bb167dc30878d7113b7e168e6f0646beffd77d69d39bad76b47a");
    expect(ss58Address(fromHex(pub("")))).toBe("5DfhGyQdFobKM8NsWvEeAKk5EQQgYe9AydgJ7rMB6E1EqRzV");
    expect(pub("//Alice")).toBe("d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d");
    expect(ss58Address(fromHex(pub("//Alice")))).toBe("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  });

  it("mini-secret is entropy-based, not the BIP-39 seed (substrate-bip39 vector with password 'Substrate')", () => {
    expect(toHex(substrateMiniSecret(src.entropy, "Substrate"))).toBe("44e9d125f037ac1d51f0a7d3649689d422c2af8b1ec8e00d71db4d7bf6d127e3");
    expect(toHex(substrateMiniSecret(src.entropy))).not.toBe(toHex(src.seed.subarray(0, 32)));
  });

  it("junction chain codes: numbers little-endian, strings SCALE-prefixed, 32 bytes", () => {
    expect(toHex(junctionChainCode("0"))).toBe("00".repeat(32));
    expect(toHex(junctionChainCode("258"))).toBe("0201" + "00".repeat(30));
    expect(toHex(junctionChainCode("Alice"))).toBe("14416c696365" + "00".repeat(26));
    expect(() => substrateSecret(src.entropy, "/soft")).toThrow(/hard/);
    expect(() => substrateSecret(src.entropy, "//a//")).toThrow(/bad junction/);
  });

  it("@polkadot/util-crypto sr25519Verify (wasm schnorrkel) accepts the vault's signature (context 'substrate')", () => {
    for (const i of [0, 1]) {
      const k = key("substrate", i);
      expect(sr25519Verify(MSG, signSr25519(MSG, k.privateKey), k.publicKey)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ Starknet */

describe("starknet: grindKey over a BIP-32 node; Argent X by default, Braavos and Ledger (EIP-2645) selectable", () => {
  it("paths", () => {
    expect(derivationPath("starknet", 3)).toBe("argent-x:m/44'/9004'/0'/0/3");
    expect(derivationPath("starknet", 3, { starknetScheme: "braavos" })).toBe("braavos:m/44'/9004'/0'/0/3");
    expect(derivationPath("starknet", 3, { starknetScheme: "ledger" })).toBe("m/2645'/1195502025'/1148870696'/0'/0'/3");
  });

  it("Argent X repo vector (packages/extension/test/keyDerivation.test.ts): secret → Stark keys of indexes 5 and 7", () => {
    // Argent X's secret is the ETH private key; its Stark tree is BIP-32 seeded with it. Feed it to the tree step.
    const secret = fromHex("e6904d63affe7a13cd30345b000c9b1ffc087832332d7303cf237ffda8a177d0");
    const starkKey = (i: number) => "0x" + toHex(starkPublicKey(starkPrivateKey(secret, `braavos:m/44'/9004'/0'/0/${i}`)));
    expect(starkKey(5)).toBe("0x05c7c65bfda7a85af0681c85c9c440f0aa6825feef6f9c96e55fb2ce08c8d4bc");
    expect(starkKey(7)).toBe("0x0605d5a0ece3b316f0d72221228acb7f01dcb34db74e0c02790db156741f5a86");
  });

  it("Argent X derivation replicated with ethers (the library Argent X uses) for accounts 0..2", () => {
    const eth = HDNodeWallet.fromPhrase(ABANDON); // m/44'/60'/0'/0/0
    const tree = HDNodeWallet.fromSeed(eth.privateKey);
    for (const i of [0, 1, 2]) {
      const child = tree.derivePath(`m/44'/9004'/0'/0/${i}`);
      const ref = BigInt("0x" + starkEc.starkCurve.grindKey(child.privateKey));
      expect(BigInt("0x" + toHex(key("starknet", i).privateKey))).toBe(ref);
      expect("0x" + toHex(key("starknet", i).publicKey)).toBe("0x" + BigInt(starkEc.starkCurve.getStarkKey(ref.toString(16).padStart(64, "0"))).toString(16).padStart(64, "0"));
    }
  });

  it("Braavos-style key for 'abandon … about' (strkd conformance vector, third-party) and ethers cross-check", () => {
    const k = key("starknet", 0, { starknetScheme: "braavos" });
    expect("0x" + toHex(k.publicKey)).toBe("0x05d97a4a9174d9158c3886717a70112c5e60b17318a1d3ae17f563f1cf8292f4");
    const child = HDNodeWallet.fromSeed(src.seed).derivePath("m/44'/9004'/0'/0/0");
    expect(BigInt("0x" + toHex(k.privateKey))).toBe(BigInt("0x" + starkEc.starkCurve.grindKey(child.privateKey)));
  });

  it("Ledger EIP-2645 path cross-checked with ethers + grindKey", () => {
    const k = key("starknet", 1, { starknetScheme: "ledger" });
    const child = HDNodeWallet.fromSeed(src.seed).derivePath("m/2645'/1195502025'/1148870696'/0'/0'/1");
    expect(BigInt("0x" + toHex(k.privateKey))).toBe(BigInt("0x" + starkEc.starkCurve.grindKey(child.privateKey)));
  });

  it("grindKey: Argent X repo vector", () => {
    expect(() => starkPrivateKey(src.seed, "m/44'/9004'/0'/0/0")).toThrow(/bad starknet path/);
    expect(BigInt("0x" + starkEc.starkCurve.grindKey("86F3E7293141F20A8BAFF320E8EE4ACCB9D4A4BF2B4D295E8CEE784DB46E0519"))).toBe(
      BigInt("0x5c8c8683596c732541a59e03007b2d30dbbbb873556fe65b5fb63c16688f941"),
    );
  });

  it("OpenZeppelin counterfactual address equals starknet.js calculateContractAddressFromHash", () => {
    const pk = key("starknet", 0).publicKey;
    const pkHex = "0x" + toHex(pk);
    const ref = starkHash.calculateContractAddressFromHash(pkHex, STARKNET_OZ_ACCOUNT_CLASS_HASH, [pkHex], 0);
    expect(BigInt(starknetOzAccountAddress(pk, STARKNET_OZ_ACCOUNT_CLASS_HASH))).toBe(BigInt(ref));
  });

  it("stark-ecdsa signature verifies with starknet.js; refuses hashes ≥ 2^251", () => {
    const k = key("starknet", 0);
    const h = fromHex("0" + "7".repeat(63));
    const s = signStark(h, k.privateKey);
    const sig = new starkEc.starkCurve.Signature(BigInt("0x" + toHex(s.bytes.subarray(0, 32))), BigInt("0x" + toHex(s.bytes.subarray(32))));
    const full = starkEc.starkCurve.getPublicKey(k.privateKey, false);
    expect(starkEc.starkCurve.verify(sig, "0x" + toHex(h), full)).toBe(true);
    expect(() => signStark(fromHex("08" + "00".repeat(31)), k.privateKey)).toThrow(/2\^251/);
    expect(toHex(starkPublicKey(k.privateKey))).toBe(toHex(k.publicKey));
  });
});

/* ------------------------------------------------------------------ helpers */

import * as sr25519 from "@scure/sr25519";
const sr25519Pub = (secret: Uint8Array) => sr25519.getPublicKey(secret);

describe("deriveKey keeps Phase 1 behaviour", () => {
  it("secp256k1 and ed25519 with a bare seed", () => {
    expect(deriveKey(src.seed, "ed25519", "m/44'/501'/0'/0'").publicKey).toHaveLength(32);
    expect(deriveKey(src.seed, "secp256k1", "m/44'/60'/0'/0/0").publicKey).toHaveLength(33);
    expect(() => deriveKey(src.seed, "bip32-ed25519", "m/1852'")).toThrow(/entropy/);
  });
});
