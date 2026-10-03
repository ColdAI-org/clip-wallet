/**
 * End to end: @clip-wallet/chains-bitcoin prepares, the real ClipVault signs, chains-bitcoin finalizes, and
 * @scure/btc-signer recomputes every input's sighash from the finished transaction and checks the witness
 * signatures. Covers the taproot contract: SignablePayload.options.taprootTweak is the BIP-341 merkle root
 * (empty for BIP-86) and the taproot key is the vault's BIP-86 key (Account.taprootPublicKey).
 * Public BIP-39 test vector only; UTXOs and the broadcast endpoint are mocked.
 */
import { describe, expect, it } from "vitest";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { hex } from "@scure/base";
import { SigHash, Transaction, p2pkh, p2tr, p2wpkh } from "@scure/btc-signer";
import { equalBytes, hash160, tagSchnorr } from "@scure/btc-signer/utils.js";
import type { ChainContext, DappRequest, Signature, SignablePayload } from "@clip-wallet/core";
import {
  BITCOIN_MAINNET,
  BITCOIN_TESTNET4,
  bip322ToSign,
  createBitcoinModule,
  networkById,
  ownTaprootAddress,
  segwitAddress,
  taprootOutputKey,
} from "@clip-wallet/chains-bitcoin";
import { ClipVault, MemoryStorage, hashSignablePayload } from "../src/index.js";

// Public BIP-39 test phrase (official vectors). Never a real wallet.
const ABANDON = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PW = "correct horse battery staple";
const FAST_ARGON2 = { memoryKiB: 256, iterations: 1, parallelism: 1 };
const T4 = networkById(BITCOIN_TESTNET4)!;
const MAIN = networkById(BITCOIN_MAINNET)!;
const RAW_OPTS = { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true } as const;

async function unlockedVault(bitcoinNetwork?: "mainnet" | "testnet") {
  const vault = new ClipVault({ storage: new MemoryStorage(), argon2: FAST_ARGON2, ...(bitcoinNetwork ? { bitcoinNetwork } : {}) });
  await vault.importPhrase(ABANDON, PW);
  return vault;
}

async function signAll(vault: ClipVault, payloads: SignablePayload[]): Promise<Signature[]> {
  vault.registerApproval(payloads[0]!.approvalId, payloads.map(hashSignablePayload), 60_000);
  const out: Signature[] = [];
  for (const p of payloads) out.push(await vault.sign(p));
  return out;
}

function mockFetch(routes: Record<string, unknown>, posts: string[]): typeof fetch {
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST" && init.body) posts.push(String(init.body));
    const k = keys.find((key) => url.endsWith(key));
    if (!k) return new Response("not found", { status: 404 });
    const v = routes[k];
    return typeof v === "string" ? new Response(v) : new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("Bitcoin P2WPKH + P2TR (BIP-86 key path): chains-bitcoin → ClipVault → valid transaction", () => {
  it("the vault's Bitcoin account carries its BIP-86 key, and mainnet matches the BIP-86 test vector", async () => {
    const main = await unlockedVault("mainnet");
    const acct = await main.deriveAccount("bitcoin", 0);
    const tr = await main.deriveAccount("bitcoin", 0, { bitcoinAddressType: "p2tr" });
    expect(acct.derivationPath).toBe("m/84'/0'/0'/0/0");
    expect(acct.taprootPublicKey).toBe(tr.publicKey);
    // BIP-86 test vector, m/86'/0'/0'/0/0: internal key cc8a4b…c115, output key a60869…684c.
    expect(acct.taprootPublicKey!.slice(2)).toBe("cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115");
    expect(hex.encode(taprootOutputKey(hex.decode(acct.taprootPublicKey!)))).toBe("a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c");
    expect(ownTaprootAddress(acct, MAIN)).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
    expect(tr.address).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
    expect(tr.taprootPublicKey).toBe(tr.publicKey);
  });

  it("send spending a P2WPKH coin and a P2TR coin: every witness signature verifies", async () => {
    const vault = await unlockedVault(); // testnet default: m/84'/1'/0'/0/0 and m/86'/1'/0'/0/0
    const acct = await vault.deriveAccount("bitcoin", 0);
    const trAcct = await vault.deriveAccount("bitcoin", 0, { bitcoinAddressType: "p2tr" });
    expect(acct.derivationPath).toBe("m/84'/1'/0'/0/0");
    expect(acct.taprootPublicKey).toBe(trAcct.publicKey);
    const wpkhAddr = segwitAddress(hex.decode(acct.publicKey), T4);
    const trAddr = ownTaprootAddress(acct, T4);
    expect(wpkhAddr).toBe(acct.address);
    expect(trAddr).toBe(trAcct.address); // the module's taproot address is the vault's BIP-86 address
    const to = (await vault.deriveAccount("bitcoin", 1)).address;

    const posts: string[] = [];
    const ctx: ChainContext = {
      network: T4,
      account: acct,
      fetch: mockFetch(
        {
          [`/address/${wpkhAddr}/utxo`]: [{ txid: "aa".repeat(32), vout: 1, value: 80_000, status: { confirmed: true } }],
          [`/address/${trAddr}/utxo`]: [{ txid: "bb".repeat(32), vout: 0, value: 60_000, status: { confirmed: true } }],
          "/fee-estimates": { "1": 5, "3": 2, "6": 1 },
          "/tx": "e".repeat(64),
        },
        posts,
      ),
    };
    const mod = createBitcoinModule({ newId: () => "e2e-send" });
    const req: DappRequest = await mod.buildTransfer({ asset: T4.nativeAsset, to, amount: "120000" }, ctx);
    const d = await mod.decode(req, ctx);
    expect(d.title).toMatch(/^Send 0.0012 BTC to /);
    expect(d.lines.filter((l) => l.label.startsWith("Your coin"))).toHaveLength(2);

    const payloads = await mod.prepare(req, ctx, "approval-e2e");
    expect(payloads.map((p) => p.scheme)).toEqual(["ecdsa-secp256k1", "schnorr-secp256k1"]);
    expect(payloads[1]!.options?.taprootTweak).toEqual(new Uint8Array(0)); // merkle root of a BIP-86 output
    const sigs = await signAll(vault, payloads);
    expect(await mod.finalize(req, sigs, ctx)).toEqual([expect.objectContaining({ txid: "e".repeat(64) })]);

    // Independent check on the broadcast bytes: recompute each sighash with @scure/btc-signer and verify.
    expect(posts).toHaveLength(1);
    const tx = Transaction.fromRaw(hex.decode(posts[0]!), RAW_OPTS);
    expect(tx.isFinal).toBe(true);
    const spent = Array.from({ length: tx.inputsLength }, (_, i) => hex.encode(tx.getInput(i).txid!));
    expect(spent).toEqual(["aa".repeat(32), "bb".repeat(32)]);
    const scripts = [segwitScript(acct.publicKey), taprootScript(acct.taprootPublicKey!)];
    const amounts = [80_000n, 60_000n];

    // Input 0: P2WPKH, BIP-143.
    const [der, pub] = tx.getInput(0).finalScriptWitness!;
    expect(equalBytes(hash160(pub!), scripts[0]!.slice(2))).toBe(true);
    expect(der![der!.length - 1]).toBe(SigHash.ALL);
    const h0 = tx.preimageWitnessV0(0, p2pkh(pub!).script, SigHash.ALL, amounts[0]!);
    const ecdsaSig = secp256k1.Signature.fromBytes(der!.slice(0, -1), "der").toBytes("compact");
    expect(secp256k1.verify(ecdsaSig, h0, pub!, { prehash: false })).toBe(true);

    // Input 1: P2TR key path, BIP-341, SIGHASH_DEFAULT (64-byte signature), against the prevout's output key.
    const [trSig, ...rest] = tx.getInput(1).finalScriptWitness!;
    expect(rest).toEqual([]);
    expect(trSig).toHaveLength(64);
    const outputKey = scripts[1]!.slice(2);
    const h1 = tx.preimageWitnessV1(1, scripts, SigHash.DEFAULT, amounts);
    expect(schnorr.verify(trSig!, h1, outputKey)).toBe(true);
    expect(sigs[1]!.publicKey).toBe(hex.encode(outputKey)); // the vault reports the key that verifies

    // Regression: the old contract (TapTweak scalar passed as taprootTweak) hashes the tweak twice.
    const internal = hex.decode(acct.taprootPublicKey!).slice(1);
    const wrong: SignablePayload = { ...payloads[1]!, approvalId: "old-contract", options: { taprootTweak: tagSchnorr("TapTweak", internal, new Uint8Array()) } };
    const [bad] = await signAll(vault, [wrong]);
    expect(schnorr.verify(bad!.bytes, h1, outputKey)).toBe(false);
  });

  it("BIP-322 message on the taproot address verifies against the BIP-86 output key", async () => {
    const vault = await unlockedVault();
    const acct = await vault.deriveAccount("bitcoin", 0);
    const trAddr = ownTaprootAddress(acct, T4);
    const ctx: ChainContext = { network: T4, account: acct, fetch: mockFetch({}, []) };
    const mod = createBitcoinModule();
    const req: DappRequest = {
      id: "msg-tr",
      origin: "https://app.example.com",
      via: "walletconnect",
      family: "bitcoin",
      networkId: T4.id,
      method: "signMessage",
      params: { address: trAddr, message: "Hello Clip" },
    };
    const payloads = await mod.prepare(req, ctx, "approval-msg");
    expect(payloads[0]!.options?.taprootTweak).toEqual(new Uint8Array(0));
    const out = (await mod.finalize(req, await signAll(vault, payloads), ctx)) as { address: string; signature: string };
    expect(out.address).toBe(trAddr);
    const script = taprootScript(acct.taprootPublicKey!);
    const digest = bip322ToSign(new TextEncoder().encode("Hello Clip"), script).preimageWitnessV1(0, [script], SigHash.DEFAULT, [0n]);
    const witnessSig = Uint8Array.from(atob(out.signature), (c) => c.charCodeAt(0)).slice(2, 66); // 0x01 items, 0x40 len
    expect(schnorr.verify(witnessSig, digest, script.slice(2))).toBe(true);
  });
});

/** Prevout scripts recomputed with @scure/btc-signer (not chains-bitcoin): P2WPKH and BIP-86 P2TR. */
const segwitScript = (pubHex: string): Uint8Array => p2wpkh(hex.decode(pubHex)).script;
const taprootScript = (pubHex: string): Uint8Array => p2tr(hex.decode(pubHex).slice(-32)).script;
