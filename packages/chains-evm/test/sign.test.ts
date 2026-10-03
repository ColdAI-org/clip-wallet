import { ClipError, type Signature } from "@clip-wallet/core";
import {
  type Hex,
  bytesToHex,
  hashMessage,
  hashTypedData,
  hexToBytes,
  keccak256,
  parseTransaction,
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  serializeTransaction,
} from "viem";
import { describe, expect, it } from "vitest";
import { addressFromPublicKey, createEvmModule, derivationPath } from "../src/module.js";
import { EVM_NETWORKS } from "../src/networks.js";
import { PERMIT_TYPED, PERSONAL, ROOTSTOCK_STATE, SEND_LEGACY, SEND_NATIVE, SEPOLIA_STATE, TYPED } from "./fixtures.js";
import { BOB, ME, ROOTSTOCK, RpcErr, SEPOLIA, SEPOLIA_USDC, TEST_ACCOUNT, ctxFor, mockFetch } from "./helpers.js";
import { SIGS } from "./signatures.js";

const GWEI = 1_000_000_000n;

/** 65-byte r||s||v hex → the vault's Signature shape. */
function vaultSig(h: string, withRecovery = true): Signature {
  const b = hexToBytes(h as Hex);
  const s: Signature = { scheme: "ecdsa-secp256k1", bytes: b.slice(0, 64), publicKey: TEST_ACCOUNT.publicKey };
  if (withRecovery) s.recovery = b[64]! - 27;
  return s;
}

const hex = (u: Uint8Array) => bytesToHex(u);

describe("keys and addresses", () => {
  it("uses the standard EVM path", () => {
    expect(derivationPath(0)).toBe("m/44'/60'/0'/0/0");
    expect(derivationPath(3)).toBe("m/44'/60'/0'/0/3");
    expect(() => derivationPath(-1)).toThrow();
  });
  it("derives the checksum address from a compressed public key (BIP-39 test vector)", () => {
    expect(addressFromPublicKey(hexToBytes(`0x${TEST_ACCOUNT.publicKey}`))).toBe(ME);
  });
  it("matches every EVM network for an EVM address", () => {
    const mod = createEvmModule();
    const many = mod.networksForAddress(ME, EVM_NETWORKS);
    expect(many.length).toBe(EVM_NETWORKS.length);
    expect(many.length).toBeGreaterThan(1); // caller must treat this as "network-matters"
    expect(mod.networksForAddress("bc1qxyz", EVM_NETWORKS)).toEqual([]);
    expect(mod.isAddress(ME)).toBe(true);
    expect(mod.isAddress(ME.toLowerCase())).toBe(true);
    expect(mod.isAddress("0x9858EfFD232B4033E47d90003D41EC34EcaEda95")).toBe(false); // bad checksum
  });
});

describe("eth_sendTransaction prepare/finalize", () => {
  it("builds an EIP-1559 tx and hands the vault its keccak digest", async () => {
    const mod = createEvmModule();
    const m = mockFetch(SEPOLIA_STATE);
    const ctx = ctxFor(SEPOLIA, m);
    const payloads = await mod.prepare(SEND_NATIVE, ctx, "approval-1");
    expect(payloads).toHaveLength(1);
    const p = payloads[0]!;
    expect(p.scheme).toBe("ecdsa-secp256k1");
    expect(p.accountId).toBe("evm:0");
    expect(p.approvalId).toBe("approval-1");
    expect(p.bytes).toHaveLength(32);
    // Independently rebuild the expected unsigned transaction.
    const expected = keccak256(
      serializeTransaction({
        type: "eip1559",
        chainId: 11155111,
        nonce: 7,
        to: BOB,
        value: 10n ** 16n,
        data: "0x",
        gas: (21000n * 12n) / 10n,
        maxPriorityFeePerGas: GWEI,
        maxFeePerGas: 3n * GWEI,
      }),
    );
    expect(hex(p.bytes)).toBe(expected);
    expect(mod.pendingCount()).toBe(1);
  });

  it("finalize serializes with the signature and broadcasts", async () => {
    const mod = createEvmModule();
    const m = mockFetch(SEPOLIA_STATE);
    const ctx = ctxFor(SEPOLIA, m);
    await mod.prepare(SEND_NATIVE, ctx, "a");
    const hash = await mod.finalize(SEND_NATIVE, [vaultSig(SIGS.sendNative)], ctx);
    expect(hash).toBe("0x" + "ab".repeat(32));
    const raw = m.calls.find((c) => c.method === "eth_sendRawTransaction")!.params[0] as Hex;
    expect(raw.startsWith("0x02")).toBe(true);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })).toBe(ME);
    const parsed = parseTransaction(raw);
    expect(parsed.to?.toLowerCase()).toBe(BOB.toLowerCase());
    expect(parsed.value).toBe(10n ** 16n);
    expect(mod.pendingCount()).toBe(0);
  });

  it("recovers the parity when the vault omits it", async () => {
    const mod = createEvmModule();
    const m = mockFetch(SEPOLIA_STATE);
    const ctx = ctxFor(SEPOLIA, m);
    await mod.prepare(SEND_NATIVE, ctx, "a");
    await expect(mod.finalize(SEND_NATIVE, [vaultSig(SIGS.sendNative, false)], ctx)).resolves.toMatch(/^0x/);
  });

  it("rejects a signature from another key and sends nothing", async () => {
    const mod = createEvmModule();
    const m = mockFetch(SEPOLIA_STATE);
    const ctx = ctxFor(SEPOLIA, m);
    await mod.prepare(SEND_NATIVE, ctx, "a");
    await expect(mod.finalize(SEND_NATIVE, [vaultSig(SIGS.personal)], ctx)).rejects.toBeInstanceOf(ClipError);
    expect(m.calls.some((c) => c.method === "eth_sendRawTransaction")).toBe(false);
  });

  it("builds a legacy EIP-155 tx on networks without a base fee (Rootstock)", async () => {
    const mod = createEvmModule();
    const m = mockFetch(ROOTSTOCK_STATE);
    const ctx = ctxFor(ROOTSTOCK, m);
    const [p] = await mod.prepare(SEND_LEGACY, ctx, "a");
    const expected = keccak256(
      serializeTransaction({ type: "legacy", chainId: 30, nonce: 2, to: BOB, value: 10n ** 16n, data: "0x", gas: 25200n, gasPrice: 66_000_000n }),
    );
    expect(hex(p!.bytes)).toBe(expected);
    await mod.finalize(SEND_LEGACY, [vaultSig(SIGS.sendLegacy)], ctx);
    const raw = m.calls.find((c) => c.method === "eth_sendRawTransaction")!.params[0] as Hex;
    const parsed = parseTransaction(raw);
    expect(parsed.type).toBe("legacy");
    expect(parsed.chainId).toBe(30);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as never })).toBe(ME);
  });

  it("refuses a tx from another account", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch(SEPOLIA_STATE));
    const req = { ...SEND_NATIVE, params: [{ from: BOB, to: ME, value: "0x1" }] };
    await expect(mod.prepare(req, ctx, "a")).rejects.toMatchObject({ code: "wrong-account" });
  });

  it("refuses a tx for another chain id", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch(SEPOLIA_STATE));
    const req = { ...SEND_NATIVE, params: [{ from: ME, to: BOB, value: "0x1", chainId: "0x1" }] };
    await expect(mod.prepare(req, ctx, "a")).rejects.toMatchObject({ code: "chain-mismatch" });
  });

  it("explains insufficient funds in plain words", async () => {
    const mod = createEvmModule();
    const m2 = mockFetch({ rpc: { ...SEPOLIA_STATE.rpc, eth_sendRawTransaction: new RpcErr(-32000, "insufficient funds for gas * price + value") } });
    const ctx = ctxFor(SEPOLIA, m2);
    await mod.prepare(SEND_NATIVE, ctx, "a");
    await expect(mod.finalize(SEND_NATIVE, [vaultSig(SIGS.sendNative)], ctx)).rejects.toMatchObject({ code: "insufficient-funds" });
  });

  it("refuses to finalize something it never prepared", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch(SEPOLIA_STATE));
    await expect(mod.finalize(SEND_NATIVE, [vaultSig(SIGS.sendNative)], ctx)).rejects.toMatchObject({ code: "not-prepared" });
  });
});

describe("message signing", () => {
  it("personal_sign: EIP-191 digest, returns r||s||v", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch({}));
    const [p] = await mod.prepare(PERSONAL, ctx, "a");
    expect(hex(p!.bytes)).toBe(hashMessage("Hello Clip"));
    const sig = (await mod.finalize(PERSONAL, [vaultSig(SIGS.personal)], ctx)) as Hex;
    expect(sig).toBe(SIGS.personal);
    expect(await recoverMessageAddress({ message: "Hello Clip", signature: sig })).toBe(ME);
  });

  it("eth_signTypedData_v4: EIP-712 digest", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch({}));
    const [p] = await mod.prepare(TYPED, ctx, "a");
    const { EIP712Domain: _d, ...types } = PERMIT_TYPED.types;
    const def = { domain: PERMIT_TYPED.domain, types, primaryType: "Permit", message: PERMIT_TYPED.message } as never;
    expect(hex(p!.bytes)).toBe(hashTypedData(def));
    const sig = (await mod.finalize(TYPED, [vaultSig(SIGS.typed)], ctx)) as Hex;
    expect(await recoverTypedDataAddress({ ...(def as object), signature: sig } as never)).toBe(ME);
  });

  it("eth_sign is refused at prepare", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch({}));
    const req = { ...PERSONAL, id: "x", method: "eth_sign", params: [ME, "0x" + "11".repeat(32)] };
    await expect(mod.prepare(req, ctx, "a")).rejects.toMatchObject({ code: "eth-sign-refused" });
  });
});

describe("buildTransfer", () => {
  it("native send", async () => {
    const mod = createEvmModule({ newId: () => "t1" });
    const ctx = ctxFor(SEPOLIA, mockFetch({}));
    const req = await mod.buildTransfer({ asset: ctx.network.nativeAsset, to: BOB, amount: "1000" }, ctx);
    expect(req).toMatchObject({ id: "t1", method: "eth_sendTransaction", family: "evm", networkId: SEPOLIA });
    expect((req.params as { to: string; value: string }[])[0]).toMatchObject({ to: BOB, value: "0x3e8", data: "0x" });
  });
  it("ERC-20 send encodes transfer(to, amount) to the token", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch({}));
    const asset = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: SEPOLIA, address: SEPOLIA_USDC };
    const req = await mod.buildTransfer({ asset, to: BOB, amount: "25000000" }, ctx);
    const tx = (req.params as { to: string; data: string; value: string }[])[0]!;
    expect(tx.to).toBe(SEPOLIA_USDC);
    expect(tx.value).toBe("0x0");
    expect(tx.data.startsWith("0xa9059cbb")).toBe(true);
    expect(tx.data).toContain(BOB.slice(2).toLowerCase());
    expect(tx.data.endsWith((25000000).toString(16).padStart(64, "0"))).toBe(true);
  });
  it("rejects bad input in plain words", async () => {
    const mod = createEvmModule();
    const ctx = ctxFor(SEPOLIA, mockFetch({}));
    await expect(mod.buildTransfer({ asset: ctx.network.nativeAsset, to: "nope", amount: "1" }, ctx)).rejects.toMatchObject({ code: "bad-address" });
    await expect(mod.buildTransfer({ asset: ctx.network.nativeAsset, to: BOB, amount: "0" }, ctx)).rejects.toMatchObject({ code: "bad-amount" });
  });
});

describe("raw payloads for hardware wallets", () => {
  it("eth_sendTransaction: raw is the unsigned serialized tx and hashes to bytes", async () => {
    const [p] = await createEvmModule().prepare(SEND_NATIVE, ctxFor(SEPOLIA, mockFetch(SEPOLIA_STATE)), "a");
    expect(p!.raw).toMatchObject({ format: "evm-tx", chainId: 11155111 });
    expect(keccak256(p!.raw!.bytes)).toBe(hex(p!.bytes));
    expect(parseTransaction(bytesToHex(p!.raw!.bytes)).to?.toLowerCase()).toBe(BOB.toLowerCase());
  });

  it("personal_sign: raw is the message; EIP-191 of it is bytes", async () => {
    const [p] = await createEvmModule().prepare(PERSONAL, ctxFor(SEPOLIA, mockFetch({})), "a");
    expect(p!.raw!.format).toBe("evm-personal");
    expect(new TextDecoder().decode(p!.raw!.bytes)).toBe("Hello Clip");
    expect(hashMessage({ raw: p!.raw!.bytes })).toBe(hex(p!.bytes));
  });

  it("eth_signTypedData_v4: raw is the full typed data with EIP712Domain; its hash is bytes", async () => {
    const [p] = await createEvmModule().prepare(TYPED, ctxFor(SEPOLIA, mockFetch({})), "a");
    expect(p!.raw!.format).toBe("eip712");
    const full = JSON.parse(new TextDecoder().decode(p!.raw!.bytes));
    expect(full.types.EIP712Domain).toBeDefined();
    const { EIP712Domain: _d, ...types } = full.types;
    expect(hashTypedData({ domain: full.domain, types, primaryType: full.primaryType, message: full.message } as never)).toBe(hex(p!.bytes));
  });
});
