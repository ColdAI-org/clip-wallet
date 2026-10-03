import { describe, expect, it } from "vitest";
import { SocialRequest, isSocialRequest } from "../src/index.js";

describe("bus schema", () => {
  it("accepts well-formed requests and rejects the rest", () => {
    expect(SocialRequest.safeParse({ type: "socNotifySet", kinds: { nft: false } }).success).toBe(true);
    expect(SocialRequest.safeParse({ type: "socNotifySet", kinds: { spam: true } }).success).toBe(false);
    expect(SocialRequest.safeParse({ type: "socContactSave", input: { name: "A", addresses: [{ family: "evm", address: "0x1" }] } }).success).toBe(true);
    expect(SocialRequest.safeParse({ type: "socContactSave", input: { name: "A", addresses: [{ family: "dogecoin", address: "D1" }] } }).success).toBe(false);
    expect(SocialRequest.safeParse({ type: "socContactSave", input: { name: "A", addresses: [], extra: 1 } }).success).toBe(false);
    expect(SocialRequest.safeParse({ type: "socAlertAdd", assetKey: "eth", direction: "above", price: -1, currency: "USD" }).success).toBe(false);
    expect(SocialRequest.safeParse({ type: "socHandlePublish", records: [] }).success).toBe(false);
    expect(isSocialRequest({ type: "socDiscover" })).toBe(true);
    expect(isSocialRequest({ type: "featSwapQuote" })).toBe(false);
  });
});
