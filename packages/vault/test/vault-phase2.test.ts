/**
 * ClipVault Phase 2 behaviour: every family through the public API, scheme enforcement, derivationSubPath
 * (Cardano stake key, Bitcoin change), change-address bookkeeping, and encrypted account metadata.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { cryptoWaitReady, sr25519Verify } from "@polkadot/util-crypto";
import { ec as starkEc } from "starknet";
import { FAMILIES, ClipError, type Family, type SignablePayload } from "@clip-wallet/core";
import { ClipVault, MemoryStorage, hashSignablePayload, type ClipVaultOptions } from "../src/index.js";
import { fromHex, toHex } from "../src/bytes.js";

// Public BIP-39 test phrase (official vectors). Never a real wallet.
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct horse battery staple";
const FAST_ARGON2 = { memoryKiB: 256, iterations: 1, parallelism: 1 };
const MSG = new TextEncoder().encode("phase 2");

async function imported(over: Partial<ClipVaultOptions> = {}, storage = new MemoryStorage()) {
  const vault = new ClipVault({ storage, argon2: FAST_ARGON2, autoLockMs: 0, ...over });
  if ((await vault.status()) === "empty") await vault.importPhrase(ABANDON, PW);
  else await vault.unlock(PW);
  return { vault, storage };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof ClipError ? e.code : `non-clip: ${String(e)}`;
  }
  return "no-error";
}

let n = 0;
function approved(vault: ClipVault, p: Omit<SignablePayload, "approvalId">): SignablePayload {
  const approvalId = `ap-${++n}`;
  vault.registerApproval(approvalId, [hashSignablePayload(p)], 60_000);
  return { ...p, approvalId };
}

beforeAll(async () => {
  await cryptoWaitReady();
});

describe("deriveAccount for every family (testnet defaults)", () => {
  it("returns the known addresses of 'abandon … about'", async () => {
    const { vault } = await imported();
    const addr = async (f: Family) => (await vault.deriveAccount(f, 0)).address;
    expect(await addr("sui")).toBe("0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1");
    expect(await addr("aptos")).toBe("0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf");
    expect(await addr("stellar")).toBe("GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX");
    expect(await addr("tezos")).toBe("tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL");
    expect(await addr("substrate")).toBe("5EPCUjPxiHAcNooYipQFWr9NmmXJKpNG5RhcntXwbtUySrgH");
    expect(await addr("cardano")).toBe("addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn");
    expect(await addr("near")).toMatch(/^[0-9a-f]{64}$/);
    expect(await addr("ton")).toMatch(/^0Q[A-Za-z0-9_-]{46}$/); // non-bounceable, testnet
    expect(await addr("algorand")).toMatch(/^[A-Z2-7]{58}$/);
    expect(await addr("starknet")).toMatch(/^0x[0-9a-f]{64}$/);
    // Phase 1 families unchanged.
    expect(await addr("evm")).toBe("0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
  });

  it("ids, curves and paths", async () => {
    const { vault } = await imported();
    const a = await vault.deriveAccount("algorand", 2);
    expect(a).toMatchObject({ id: "algorand:2", curve: "bip32-ed25519", derivationPath: "m/44'/283'/2'/0/0" });
    expect(await vault.deriveAccount("substrate", 1)).toMatchObject({ curve: "sr25519", derivationPath: "//0" });
    expect(await vault.deriveAccount("starknet", 0)).toMatchObject({ curve: "stark", derivationPath: "argent-x:m/44'/9004'/0'/0/0" });
    expect(await vault.deriveAccount("cardano", 0)).toMatchObject({ curve: "bip32-ed25519", derivationPath: "m/1852'/1815'/0'/0/0" });
    for (const f of FAMILIES) expect((await vault.deriveAccount(f, 0)).publicKey).toMatch(/^[0-9a-f]{64,66}$/);
  });

  it("mainnet options and alternative schemes", async () => {
    const { vault } = await imported({ cardanoNetwork: "mainnet", tonNetwork: "mainnet", algorandScheme: "slip10", starknetScheme: "braavos" });
    expect((await vault.deriveAccount("cardano", 0)).address).toBe(
      "addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mq4afdhv",
    );
    expect((await vault.deriveAccount("ton", 0)).address).toMatch(/^UQ/);
    expect(await vault.deriveAccount("algorand", 0)).toMatchObject({ curve: "ed25519", derivationPath: "m/44'/283'/0'/0'/0'" });
    expect((await vault.deriveAccount("starknet", 0)).publicKey).toBe("05d97a4a9174d9158c3886717a70112c5e60b17318a1d3ae17f563f1cf8292f4");
  });

  it("an injected addressOf replaces the built-in encoders (e.g. chains-starknet's account class)", async () => {
    const { vault } = await imported({ addressOf: (f, pk) => `${f}:${toHex(pk).slice(0, 8)}` });
    expect((await vault.deriveAccount("starknet", 0)).address).toMatch(/^starknet:[0-9a-f]{8}$/);
  });
});

describe("signing per scheme", () => {
  it("ed25519 families (SLIP-10 and Cardano/Algorand extended keys) verify as Ed25519", async () => {
    const { vault } = await imported();
    for (const f of ["sui", "aptos", "near", "stellar", "algorand", "tezos", "ton", "cardano"] as Family[]) {
      const acct = await vault.deriveAccount(f, 1);
      const sig = await vault.sign(approved(vault, { accountId: acct.id, scheme: "ed25519", bytes: MSG }));
      expect(sig.publicKey).toBe(acct.publicKey);
      expect(ed25519.verify(sig.bytes, MSG, fromHex(acct.publicKey))).toBe(true);
    }
  });

  it("sr25519 verifies with @polkadot/util-crypto", async () => {
    const { vault } = await imported();
    const acct = await vault.deriveAccount("substrate", 0);
    const sig = await vault.sign(approved(vault, { accountId: acct.id, scheme: "sr25519", bytes: MSG }));
    expect(sig.bytes).toHaveLength(64);
    expect(sr25519Verify(MSG, sig.bytes, fromHex(acct.publicKey))).toBe(true);
  });

  it("stark-ecdsa verifies with starknet.js", async () => {
    const { vault } = await imported();
    const acct = await vault.deriveAccount("starknet", 0);
    const h = fromHex("05" + "ab".repeat(31));
    const sig = await vault.sign(approved(vault, { accountId: acct.id, scheme: "stark-ecdsa", bytes: h }));
    const s = new starkEc.starkCurve.Signature(BigInt("0x" + toHex(sig.bytes.subarray(0, 32))), BigInt("0x" + toHex(sig.bytes.subarray(32))));
    // Verify against the 32-byte x-coordinate (Starknet's "public key"): both y parities are tried.
    const ok = [2, 3].some((p) => starkEc.starkCurve.verify(s, "0x" + toHex(h), new Uint8Array([p, ...fromHex(acct.publicKey)])));
    expect(ok).toBe(true);
  });

  it("enforces scheme per family before consuming the approval", async () => {
    const { vault } = await imported();
    const cases: [string, SignablePayload["scheme"]][] = [
      ["substrate:0", "ed25519"],
      ["cardano:0", "sr25519"],
      ["starknet:0", "ecdsa-secp256k1"],
      ["sui:0", "schnorr-secp256k1"],
      ["ton:0", "stark-ecdsa"],
    ];
    for (const [accountId, scheme] of cases) {
      const bytes = scheme === "ecdsa-secp256k1" || scheme === "schnorr-secp256k1" ? new Uint8Array(32).fill(1) : MSG;
      const p = approved(vault, { accountId, scheme, bytes });
      expect(await code(vault.sign(p))).toBe("vault/scheme-mismatch");
    }
  });

  it("a stark hash ≥ 2^251 is refused and doesn't burn the approval", async () => {
    const { vault } = await imported();
    const bad = { accountId: "starknet:0", scheme: "stark-ecdsa" as const, bytes: fromHex("08" + "00".repeat(31)) };
    const good = { accountId: "starknet:0", scheme: "stark-ecdsa" as const, bytes: fromHex("07" + "ff".repeat(31)) };
    vault.registerApproval("both", [hashSignablePayload(bad), hashSignablePayload(good)], 60_000);
    expect(await code(vault.sign({ ...bad, approvalId: "both" }))).toBe("vault/bad-payload");
    expect(await code(vault.sign({ ...good, approvalId: "both" }))).toBe("no-error");
    expect(await code(vault.sign({ ...bad, bytes: new Uint8Array(33), approvalId: "x" }))).toBe("vault/bad-payload");
  });

  it("unknown account families are refused", async () => {
    const { vault } = await imported();
    expect(await code(vault.sign({ accountId: "cosmos:0", scheme: "ed25519", bytes: MSG, approvalId: "a" }))).toBe("vault/unknown-account");
  });
});

describe("derivationSubPath", () => {
  it("Cardano 2/0 signs with the stake key; other roles refused", async () => {
    const { vault } = await imported();
    const sig = await vault.sign(approved(vault, { accountId: "cardano:0", scheme: "ed25519", bytes: MSG, derivationSubPath: "2/0" }));
    // CIP-1852 stake key of account 0 (cardano-serialization-lib, see families.test.ts)
    expect(sig.publicKey).toBe("012f5dc3115b8a07981e6e50f5a671e2c6fbb26c3ffde1cd1dcaf40a7fe8f160");
    expect(ed25519.verify(sig.bytes, MSG, fromHex(sig.publicKey))).toBe(true);
    for (const sub of ["2/1", "3/0", "0", "0/x", "../0"]) {
      expect(await code(vault.sign(approved(vault, { accountId: "cardano:0", scheme: "ed25519", bytes: MSG, derivationSubPath: sub })))).toBe("vault/bad-payload");
    }
    const internal = await vault.sign(approved(vault, { accountId: "cardano:0", scheme: "ed25519", bytes: MSG, derivationSubPath: "1/4" }));
    expect(internal.publicKey).not.toBe((await vault.deriveAccount("cardano", 0)).publicKey);
  });

  it("families without sub-paths refuse one", async () => {
    const { vault } = await imported();
    const p = approved(vault, { accountId: "sui:0", scheme: "ed25519", bytes: MSG, derivationSubPath: "0/0" });
    expect(await code(vault.sign(p))).toBe("vault/bad-payload");
  });

  it("is bound by the approval hash (approve without, sign with → refused)", async () => {
    const { vault } = await imported();
    const p = approved(vault, { accountId: "cardano:0", scheme: "ed25519", bytes: MSG });
    expect(await code(vault.sign({ ...p, derivationSubPath: "2/0" }))).toBe("vault/no-approval");
    // Payloads without a sub-path keep their Phase 1 hash.
    const base = { accountId: "evm:0", scheme: "ecdsa-secp256k1" as const, bytes: new Uint8Array(32) };
    expect(toHex(hashSignablePayload(base))).toBe(toHex(hashSignablePayload({ ...base, derivationSubPath: undefined })));
    expect(toHex(hashSignablePayload(base))).not.toBe(toHex(hashSignablePayload({ ...base, derivationSubPath: "" })));
  });
});

describe("Bitcoin change addresses", () => {
  it("BIP-84 internal chain m/84'/c'/0'/1/n (mainnet: BIP-84 vector's first change address)", async () => {
    const { vault } = await imported({ bitcoinNetwork: "mainnet" });
    const c = await vault.deriveChange("bitcoin", 0, 0);
    expect(c).toEqual({
      address: "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
      publicKey: "03025324888e429ab8e3dbaf1f7802648b9cd01e9b418485c5fa4c1b9b5700e1a6",
      derivationPath: "m/84'/0'/0'/1/0",
      derivationSubPath: "1/0",
    });
  });

  it("freshChange hands out never-reused indexes across accounts and persists them", async () => {
    const storage = new MemoryStorage();
    const { vault } = await imported({}, storage);
    const a = await vault.freshChange("bitcoin", 0);
    const b = await vault.freshChange("bitcoin", 3);
    const c = await vault.freshChange("bitcoin", 0);
    expect([a, b, c].map((x) => x.derivationSubPath)).toEqual(["1/0", "1/1", "1/2"]);
    expect(a.derivationPath).toBe("m/84'/1'/0'/1/0");
    expect(a.address).toMatch(/^tb1q/);
    expect((await vault.listChange("bitcoin", 0)).map((x) => x.derivationSubPath)).toEqual(["1/0", "1/2"]);
    expect(await code(vault.deriveChange("bitcoin", 0, 1))).toBe("vault/bad-payload"); // belongs to account 3
    // Survives a restart.
    const again = await imported({}, storage);
    expect((await again.vault.freshChange("bitcoin", 3)).derivationSubPath).toBe("1/3");
    // Taproot change lives under BIP-86 with its own counter.
    const t = await again.vault.freshChange("bitcoin", 0, { bitcoinAddressType: "p2tr" });
    expect(t).toMatchObject({ derivationPath: "m/86'/1'/0'/1/0", derivationSubPath: "1/0" });
    expect(t.address).toMatch(/^tb1p/);
  });

  it("signs with a handed-out change key via derivationSubPath; refuses unknown ones", async () => {
    const { vault } = await imported();
    const c = await vault.freshChange("bitcoin", 0);
    const digest = new Uint8Array(32).fill(7);
    const sig = await vault.sign(approved(vault, { accountId: "bitcoin:0", scheme: "ecdsa-secp256k1", bytes: digest, derivationSubPath: c.derivationSubPath }));
    expect(sig.publicKey).toBe(c.publicKey);
    expect(secp256k1.verify(sig.bytes, digest, fromHex(c.publicKey), { prehash: false })).toBe(true);
    for (const sub of ["1/9", "0/0", "1/x"]) {
      expect(await code(vault.sign(approved(vault, { accountId: "bitcoin:0", scheme: "ecdsa-secp256k1", bytes: digest, derivationSubPath: sub })))).toBe("vault/bad-payload");
    }
    // Another account can't sign with account 0's change key.
    expect(await code(vault.sign(approved(vault, { accountId: "bitcoin:1", scheme: "ecdsa-secp256k1", bytes: digest, derivationSubPath: c.derivationSubPath })))).toBe("vault/bad-payload");
  });

  it("is Bitcoin-only", async () => {
    const { vault } = await imported();
    await expect(vault.deriveChange("evm" as "bitcoin", 0, 0)).rejects.toThrow(/Bitcoin-only/);
  });
});

describe("accounts and labels (encrypted metadata)", () => {
  it("lists index 0 per family until accounts are added", async () => {
    const { vault } = await imported();
    const all = await vault.listAccounts();
    expect(all.map((a) => a.id)).toEqual(FAMILIES.map((f) => `${f}:0`));
    expect((await vault.listAccounts(["sui", "ton"])).map((a) => a.id)).toEqual(["sui:0", "ton:0"]);
  });

  it("addAccount, setAccountLabel persist across lock, restart and password change", async () => {
    const storage = new MemoryStorage();
    const { vault } = await imported({}, storage);
    const s1 = await vault.addAccount("sui", "Savings");
    expect(s1).toMatchObject({ id: "sui:1", label: "Savings" });
    expect((await vault.addAccount("sui")).id).toBe("sui:2");
    await vault.setAccountLabel("sui", 0, "  Main\u0007 ");
    await vault.setAccountLabel("cardano", 4, "Staking");
    await vault.lock();
    expect(await code(vault.listAccounts())).toBe("vault/locked");
    await vault.changePassword(PW, "another long password");
    const again = new ClipVault({ storage, argon2: FAST_ARGON2, autoLockMs: 0 });
    await again.unlock("another long password");
    const list = await again.listAccounts(["sui", "cardano"]);
    expect(list.map((a) => [a.id, a.label])).toEqual([
      ["sui:0", "Main"],
      ["sui:1", "Savings"],
      ["sui:2", undefined],
      ["cardano:0", undefined],
      ["cardano:4", "Staking"],
    ]);
    await again.setAccountLabel("sui", 1, "");
    expect((await again.listAccounts(["sui"]))[1]!.label).toBeUndefined();
  });

  it("metadata is encrypted at rest and tamper-evident", async () => {
    const storage = new MemoryStorage();
    const { vault } = await imported({}, storage);
    await vault.addAccount("near", "Very secret label");
    const raw = (await storage.get("clip-wallet/vault/v1"))!;
    expect(raw).not.toContain("Very secret label");
    expect(raw).not.toContain("near");
    const rec = JSON.parse(raw);
    rec.meta.ct = rec.meta.ct.slice(0, -4) + (rec.meta.ct.endsWith("AAAA") ? "BBBB" : "AAAA");
    await storage.set("clip-wallet/vault/v1", JSON.stringify(rec));
    expect(await code(vault.listAccounts())).toBe("vault/corrupt");
  });

  it("labels are capped and must be strings", async () => {
    const { vault } = await imported();
    const a = await vault.addAccount("tezos", "x".repeat(200));
    expect(a.label).toHaveLength(64);
    await expect(vault.setAccountLabel("tezos", 0, 5 as unknown as string)).rejects.toThrow(/string/);
    await expect(vault.addAccount("cosmos" as Family)).rejects.toThrow(/unknown family/);
  });
});

describe("lock wipes the entropy too", () => {
  it("Cardano/Substrate derivation needs an unlocked vault", async () => {
    const { vault } = await imported();
    await vault.deriveAccount("cardano", 0);
    await vault.lock();
    expect(await code(vault.deriveAccount("substrate", 0))).toBe("vault/locked");
    expect(await code(vault.freshChange("bitcoin", 0))).toBe("vault/locked");
  });
});
