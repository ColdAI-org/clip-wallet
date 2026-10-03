import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import type { SignablePayload } from "@clip-wallet/core";
import {
  HardwareApprovals,
  MAX_APPROVAL_TTL_MS,
  decodeImageData,
  decodeXpub,
  deriveChild,
  encodeXpub,
  hardwareAccountId,
  hardwarePath,
  isHardwareAccountId,
  ledgerError,
  parseHardwareAccountId,
} from "../src/index.js";

describe("BIP-32 public derivation (official test vectors)", () => {
  // https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki#test-vector-1 and #test-vector-2
  it("vector 1: M/0H/1/2H/2 -> M/0H/1/2H/2/1000000000", () => {
    const parent = decodeXpub("xpub6FHa3pjLCk84BayeJxFW2SP4XRrFd1JYnxeLeU8EqN3vDfZmbqBqaGJAyiLjTAwm6ZLRQUMv1ZACTj37sR62cfN7fe5JnJ7dh8zL4fiyLHV");
    expect(encodeXpub(deriveChild(parent, 1000000000))).toBe(
      "xpub6H1LXWLaKsWFhvm6RVpEL9P4KfRZSW7abD2ttkWP3SSQvnyA8FSVqNTEcYFgJS2UaFcxupHiYkro49S8yGasTvXEYBVPamhGW6cFJodrTHy",
    );
  });

  it("vector 2: M -> M/0", () => {
    const m = decodeXpub("xpub661MyMwAqRbcFW31YEwpkMuc5THy2PSt5bDMsktWQcFF8syAmRUapSCGu8ED9W6oDMSgv6Zz8idoc4a6mr8BDzTJY47LJhkJ8UB7WEGuduB");
    expect(encodeXpub(deriveChild(m, 0))).toBe(
      "xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH",
    );
  });

  it("refuses hardened children and private keys", () => {
    const m = decodeXpub("xpub661MyMwAqRbcFW31YEwpkMuc5THy2PSt5bDMsktWQcFF8syAmRUapSCGu8ED9W6oDMSgv6Zz8idoc4a6mr8BDzTJY47LJhkJ8UB7WEGuduB");
    expect(() => deriveChild(m, 0x80000000)).toThrow(/non-hardened/);
    // vector 2 master xprv: a private extended key is not accepted
    expect(() => decodeXpub("xprv9s21ZrQH143K31xYSDQpPDxsXRTUcvj2iNHm5NUtrGiGG5e2DtALGdso3pGz6ssrdK4PFmM8NSpSBHNqPqm55Qn3LqFtT2emdEXVYsCzC2U")).toThrow();
  });
});

describe("paths and ids", () => {
  it("standard paths are the vault's (packages/vault/src/derive.ts)", () => {
    expect(hardwarePath("evm", 3)).toBe("m/44'/60'/0'/0/3");
    expect(hardwarePath("solana", 3)).toBe("m/44'/501'/3'/0'");
    expect(hardwarePath("bitcoin", 3)).toBe("m/84'/1'/0'/0/3");
    expect(hardwarePath("bitcoin", 3, "standard", { bitcoinNetwork: "mainnet" })).toBe("m/84'/0'/0'/0/3");
  });

  it("other wallets' layouts", () => {
    expect(hardwarePath("evm", 3, "ledger-live")).toBe("m/44'/60'/3'/0/0");
    expect(hardwarePath("evm", 3, "ledger-legacy")).toBe("m/44'/60'/0'/3");
    expect(hardwarePath("solana", 3, "ledger-live")).toBe("m/44'/501'/3'");
    expect(hardwarePath("hedera", 3)).toBe("m/44'/3030'/0'/0'/3'");
    expect(() => hardwarePath("hedera", 0, "ledger-live")).toThrow();
  });

  it("hardware ids never parse as vault ids and round-trip", () => {
    const id = hardwareAccountId("ledger", "73C5DA0A", "bitcoin", 2);
    expect(id).toBe("hw:ledger:73c5da0a:bitcoin:2");
    expect(isHardwareAccountId(id)).toBe(true);
    expect(isHardwareAccountId("evm:0")).toBe(false);
    expect(parseHardwareAccountId(hardwareAccountId("keystone", "e9181cf3", "evm", 1, "ledger-live"))).toEqual({
      kind: "keystone",
      fingerprint: "e9181cf3",
      family: "evm",
      index: 1,
      pathStyle: "ledger-live",
    });
  });
});

describe("approvals", () => {
  const p: SignablePayload = { accountId: "hw:ledger:00000000:evm:0", scheme: "ecdsa-secp256k1", bytes: new Uint8Array(32).fill(1), approvalId: "a1", raw: { format: "evm-personal", bytes: new Uint8Array([1, 2]) } };

  it("each approved payload signs once; raw is part of what was approved", () => {
    let now = 0;
    const a = new HardwareApprovals(() => now);
    a.register("a1", [p], 60_000);
    expect(a.consume({ ...p, raw: { format: "evm-personal", bytes: new Uint8Array([9]) } })).toBe(false);
    expect(a.consume(p)).toBe(true);
    expect(a.consume(p)).toBe(false);
  });

  it("expire at the ttl, capped at 10 minutes", () => {
    let now = 0;
    const a = new HardwareApprovals(() => now);
    a.register("a1", [p], 60 * 60_000);
    now = MAX_APPROVAL_TTL_MS;
    expect(a.consume(p)).toBe(false);
  });

  it("refuse payloads of another approval", () => {
    const a = new HardwareApprovals();
    expect(() => a.register("other", [p], 1000)).toThrow();
  });
});

describe("errors", () => {
  it("map Ledger failures to next steps", () => {
    expect(ledgerError({ name: "TransportOpenUserCancelled" }, "Ethereum").userMessage).toMatch(/No Ledger was picked/);
    expect(ledgerError({ name: "DisconnectedDeviceDuringOperation" }, "Ethereum").code).toBe("hw/disconnected");
    expect(ledgerError({ statusCode: 0x6e01 }, "Solana").userMessage).toBe("Open the Solana app on your Ledger, then try again.");
    expect(ledgerError({ statusCode: 0x5515 }, "Hedera").userMessage).toBe("Unlock your Ledger with your PIN, then try again.");
    expect(ledgerError({ statusCode: 0x6985 }, "Bitcoin Test").code).toBe("hw/rejected");
  });
});

describe("QR decoding fallback (jsQR)", () => {
  it("reads a UR frame from raw pixels", async () => {
    const text = "UR:ETH-SIGNATURE/OTADTPDAGDNDCAWMGTFRKIGRPMNDUTDNBTKGFSSBJNAOHDFP";
    const qr = QRCode.create(text, { errorCorrectionLevel: "L" });
    const scale = 4;
    const margin = 4;
    const n = qr.modules.size;
    const w = (n + margin * 2) * scale;
    const px = new Uint8ClampedArray(w * w * 4).fill(255);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!qr.modules.get(x, y)) continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + margin) * scale + dy) * w + (x + margin) * scale + dx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
      }
    expect(decodeImageData(px, w, w)).toBe(text);
    expect(decodeImageData(new Uint8ClampedArray(w * w * 4).fill(255), w, w)).toBeNull();
  });
});

describe("Ledger USB permission (page side)", () => {
  it("asks only when no Ledger is granted yet, and says what to do when none is picked", async () => {
    const { requestLedgerAccess } = await import("../src/index.js");
    const granted = { getDevices: async () => [{ vendorId: 0x2c97 }], requestDevice: async () => [] };
    await expect(requestLedgerAccess(granted)).resolves.toBeUndefined();
    const none = { getDevices: async () => [], requestDevice: async () => [] };
    await expect(requestLedgerAccess(none)).rejects.toMatchObject({ code: "hw/not-picked" });
    await expect(requestLedgerAccess(undefined)).rejects.toMatchObject({ code: "hw/no-webhid" });
  });
});
