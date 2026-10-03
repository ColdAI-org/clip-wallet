import { describe, expect, it } from "vitest";
import { HDKey } from "@scure/bip32";
import { mnemonicToEntropy, mnemonicToSeed } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey as MkpHDKey } from "micro-key-producer/slip10.js";
import { derivePath as hdkeyDerivePath } from "ed25519-hd-key";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import fixture from "./fixtures/bip39-english.json" with { type: "json" };
import { fromHex, toHex } from "../src/bytes.js";
import { entropyToPhrase, isValidPhrase, normalizePhrase, phraseToEntropy, phraseToSeed } from "../src/phrase.js";
import { slip10Derive, slip10Master, slip10PublicKey } from "../src/slip10.js";
import { deriveKey, derivationPath } from "../src/derive.js";
import { evmAddress, p2trAddress, p2wpkhAddress, solanaAddress } from "../src/address.js";

// Public BIP-39 test phrase (official vectors). Never a real wallet.
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("BIP-39 official vectors (trezor/python-mnemonic, passphrase TREZOR)", () => {
  for (const v of fixture.vectors) {
    it(`${v.mnemonic.split(" ").length} words: ${v.entropy.slice(0, 8)}...`, async () => {
      expect(entropyToPhrase(fromHex(v.entropy))).toBe(v.mnemonic);
      const words = v.mnemonic.split(" ").length;
      let seed: Uint8Array;
      if (words === 12 || words === 24) {
        expect(toHex(phraseToEntropy(v.mnemonic))).toBe(v.entropy);
        seed = await phraseToSeed(v.mnemonic, fixture.passphrase);
      } else {
        // 18-word phrases are valid BIP-39 but outside vault policy: check the primitive, then the refusal.
        expect(toHex(mnemonicToEntropy(v.mnemonic, wordlist))).toBe(v.entropy);
        expect(isValidPhrase(v.mnemonic)).toBe(false);
        seed = await mnemonicToSeed(v.mnemonic, fixture.passphrase);
      }
      expect(toHex(seed)).toBe(v.seed);
      expect(HDKey.fromMasterSeed(seed).privateExtendedKey).toBe(v.xprv);
    });
  }

  it("only 12 or 24 words are accepted (vault policy)", () => {
    const eighteen = fixture.vectors.find((v) => v.mnemonic.split(" ").length === 18)!;
    expect(isValidPhrase(eighteen.mnemonic)).toBe(false);
    expect(isValidPhrase(ABANDON)).toBe(true);
  });

  it("rejects a bad checksum and unknown words", () => {
    expect(isValidPhrase(ABANDON.replace(/about$/, "abandon"))).toBe(false);
    expect(isValidPhrase(ABANDON.replace(/about$/, "notaword"))).toBe(false);
  });

  it("normalizes whitespace and case", () => {
    expect(normalizePhrase(`  ${ABANDON.toUpperCase().replace(/ /g, "\n ")} `)).toBe(ABANDON);
    expect(isValidPhrase(ABANDON.toUpperCase())).toBe(true);
  });
});

describe("BIP-32 test vector 1", () => {
  const seed = fromHex("000102030405060708090a0b0c0d0e0f");
  const cases: [string, string, string][] = [
    ["m", "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8", "xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi"],
    ["m/0'", "xpub68Gmy5EdvgibQVfPdqkBBCHxA5htiqg55crXYuXoQRKfDBFA1WEjWgP6LHhwBZeNK1VTsfTFUHCdrfp1bgwQ9xv5ski8PX9rL2dZXvgGDnw", "xprv9uHRZZhk6KAJC1avXpDAp4MDc3sQKNxDiPvvkX8Br5ngLNv1TxvUxt4cV1rGL5hj6KCesnDYUhd7oWgT11eZG7XnxHrnYeSvkzY7d2bhkJ7"],
    ["m/0'/1", "xpub6ASuArnXKPbfEwhqN6e3mwBcDTgzisQN1wXN9BJcM47sSikHjJf3UFHKkNAWbWMiGj7Wf5uMash7SyYq527Hqck2AxYysAA7xmALppuCkwQ", "xprv9wTYmMFdV23N2TdNG573QoEsfRrWKQgWeibmLntzniatZvR9BmLnvSxqu53Kw1UmYPxLgboyZQaXwTCg8MSY3H2EU4pWcQDnRnrVA1xe8fs"],
    ["m/0'/1/2'", "xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5", "xprv9z4pot5VBttmtdRTWfWQmoH1taj2axGVzFqSb8C9xaxKymcFzXBDptWmT7FwuEzG3ryjH4ktypQSAewRiNMjANTtpgP4mLTj34bhnZX7UiM"],
    ["m/0'/1/2'/2", "xpub6FHa3pjLCk84BayeJxFW2SP4XRrFd1JYnxeLeU8EqN3vDfZmbqBqaGJAyiLjTAwm6ZLRQUMv1ZACTj37sR62cfN7fe5JnJ7dh8zL4fiyLHV", "xprvA2JDeKCSNNZky6uBCviVfJSKyQ1mDYahRjijr5idH2WwLsEd4Hsb2Tyh8RfQMuPh7f7RtyzTtdrbdqqsunu5Mm3wDvUAKRHSC34sJ7in334"],
    ["m/0'/1/2'/2/1000000000", "xpub6H1LXWLaKsWFhvm6RVpEL9P4KfRZSW7abD2ttkWP3SSQvnyA8FSVqNTEcYFgJS2UaFcxupHiYkro49S8yGasTvXEYBVPamhGW6cFJodrTHy", "xprvA41z7zogVVwxVSgdKUHDy1SKmdb533PjDz7J6N6mV6uS3ze1ai8FHa8kmHScGpWmj4WggLyQjgPie1rFSruoUihUZREPSL39UNdE3BBDu76"],
  ];
  for (const [path, xpub, xprv] of cases) {
    it(path, () => {
      const k = HDKey.fromMasterSeed(seed).derive(path);
      expect(k.publicExtendedKey).toBe(xpub);
      expect(k.privateExtendedKey).toBe(xprv);
    });
  }
});

describe("SLIP-10 ed25519 official vectors", () => {
  type Row = [path: string, chain: string, priv: string, pub: string];
  const vectors: { seed: string; rows: Row[] }[] = [
    {
      seed: "000102030405060708090a0b0c0d0e0f",
      rows: [
        ["m", "90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb", "2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7", "00a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed"],
        ["m/0'", "8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69", "68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3", "008c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c"],
        ["m/0'/1'", "a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14", "b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2", "001932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187"],
        ["m/0'/1'/2'", "2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c", "92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9", "00ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1"],
        ["m/0'/1'/2'/2'", "8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc", "30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662", "008abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c"],
        ["m/0'/1'/2'/2'/1000000000'", "68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230", "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793", "003c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a"],
      ],
    },
    {
      seed: "fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542",
      rows: [
        ["m", "ef70a74db9c3a5af931b5fe73ed8e1a53464133654fd55e7a66f8570b8e33c3b", "171cb88b1b3c1db25add599712e36245d75bc65a1a5c9e18d76f9f2b1eab4012", "008fe9693f8fa62a4305a140b9764c5ee01e455963744fe18204b4fb948249308a"],
        ["m/0'", "0b78a3226f915c082bf118f83618a618ab6dec793752624cbeb622acb562862d", "1559eb2bbec5790b0c65d8693e4d0875b1747f4970ae8b650486ed7470845635", "0086fab68dcb57aa196c77c5f264f215a112c22a912c10d123b0d03c3c28ef1037"],
        ["m/0'/2147483647'", "138f0b2551bcafeca6ff2aa88ba8ed0ed8de070841f0c4ef0165df8181eaad7f", "ea4f5bfe8694d8bb74b7b59404632fd5968b774ed545e810de9c32a4fb4192f4", "005ba3b9ac6e90e83effcd25ac4e58a1365a9e35a3d3ae5eb07b9e4d90bcf7506d"],
        ["m/0'/2147483647'/1'", "73bd9fff1cfbde33a1b846c27085f711c0fe2d66fd32e139d3ebc28e5a4a6b90", "3757c7577170179c7868353ada796c839135b3d30554bbb74a4b1e4a5a58505c", "002e66aa57069c86cc18249aecf5cb5a9cebbfd6fadeab056254763874a9352b45"],
        ["m/0'/2147483647'/1'/2147483646'", "0902fe8a29f9140480a00ef244bd183e8a13288e4412d8389d140aac1794825a", "5837736c89570de861ebc173b1086da4f505d4adb387c6a1b1342d5e4ac9ec72", "00e33c0f7d81d843c572275f287498e8d408654fdf0d1e065b84e2e6f157aab09b"],
        ["m/0'/2147483647'/1'/2147483646'/2'", "5d70af781f3a37b829f0d060924d5e960bdc02e85423494afc0b1a41bbe196d4", "551d333177df541ad876a60ea71f00447931c0a9da16f227c11ea080d7391b8d", "0047150c75db263559a70d5778bf36abbab30fb061ad69f69ece61a72b0cfa4fc0"],
      ],
    },
  ];
  for (const [n, v] of vectors.entries()) {
    for (const [path, chain, priv, pub] of v.rows) {
      it(`vector ${n + 1} ${path}`, () => {
        const node = path === "m" ? slip10Master(fromHex(v.seed)) : slip10Derive(fromHex(v.seed), path);
        expect(toHex(node.chainCode)).toBe(chain);
        expect(toHex(node.privateKey)).toBe(priv);
        expect(toHex(slip10PublicKey(node.privateKey))).toBe(pub);
      });
    }
  }

  it("refuses non-hardened segments", () => {
    expect(() => slip10Derive(fromHex(vectors[0]!.seed), "m/0'/1")).toThrow(/hardened/);
  });
});

describe("address KATs for the public 'abandon x11 about' phrase", () => {
  const seedP = phraseToSeed(ABANDON);

  it("EVM m/44'/60'/0'/0/0 (MetaMask)", async () => {
    const k = deriveKey(await seedP, "secp256k1", derivationPath("evm", 0));
    expect(evmAddress(k.publicKey)).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  });

  it("BIP-84 first receive address (mainnet)", async () => {
    const path = derivationPath("bitcoin", 0, { bitcoinNetwork: "mainnet" });
    expect(path).toBe("m/84'/0'/0'/0/0");
    const k = deriveKey(await seedP, "secp256k1", path);
    expect(p2wpkhAddress(k.publicKey, "mainnet")).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
  });

  it("BIP-86 first receive address (mainnet, BIP-86 test vector)", async () => {
    const path = derivationPath("bitcoin", 0, { bitcoinNetwork: "mainnet", bitcoinAddressType: "p2tr" });
    expect(path).toBe("m/86'/0'/0'/0/0");
    const k = deriveKey(await seedP, "secp256k1", path);
    expect(p2trAddress(k.publicKey, "mainnet")).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
  });

  it("testnet uses coin type 1' and tb1", async () => {
    const path = derivationPath("bitcoin", 0);
    expect(path).toBe("m/84'/1'/0'/0/0");
    const k = deriveKey(await seedP, "secp256k1", path);
    expect(p2wpkhAddress(k.publicKey, "testnet")).toMatch(/^tb1q[02-9ac-hj-np-z]{38}$/);
  });

  it("Solana m/44'/501'/0'/0' matches two independent SLIP-10 implementations", async () => {
    const seed = await seedP;
    const path = derivationPath("solana", 0);
    expect(path).toBe("m/44'/501'/0'/0'");
    const mine = solanaAddress(deriveKey(seed, "ed25519", path).publicKey);

    const viaMkp = base58.encode(ed25519.getPublicKey(MkpHDKey.fromMasterSeed(seed).derive(path).privateKey));
    const viaHdKey = base58.encode(ed25519.getPublicKey(hdkeyDerivePath(path, toHex(seed)).key));
    expect(mine).toBe(viaMkp);
    expect(mine).toBe(viaHdKey);
    // Also the address Phantom/Solflare show for this public test phrase.
    expect(mine).toBe("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk");
  });

  it("Hedera ECDSA uses m/44'/3030'/0'/0/i and differs from the EVM account", async () => {
    const seed = await seedP;
    expect(derivationPath("hedera", 0)).toBe("m/44'/3030'/0'/0/0");
    const h = deriveKey(seed, "secp256k1", derivationPath("hedera", 0));
    const independent = HDKey.fromMasterSeed(seed).derive("m/44'/3030'/0'/0/0");
    expect(toHex(h.publicKey)).toBe(toHex(independent.publicKey!));
    expect(evmAddress(h.publicKey)).not.toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  });
});
