/** Clip Link deep links on the phone: pairing codes and "continue elsewhere" links. */
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6 }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {} }));

const { parseDeepLink } = await import("../src/lib/deeplinks");
const opts = { scheme: "clipwallet", universalHost: "clipwallet.example" };
const KEY = "A".repeat(43);
const ID = "B".repeat(22);

describe("Clip Link deep links", () => {
  it("accepts a pairing code from the app scheme only", () => {
    const uri = `clipwallet://link?v=1&c=${ID}&k=${KEY}&s=${ID}&p=signer&n=Chrome&r=${encodeURIComponent("https://clip-link-relay.doyoka-platform.workers.dev")}`;
    expect(parseDeepLink(uri, opts)).toEqual({ kind: "link", uri });
    expect(parseDeepLink(`https://clipwallet.example/link?v=1&c=${ID}&k=${KEY}&s=${ID}&p=signer`, opts)).toBeNull();
    expect(parseDeepLink(`clipwallet://link?v=1&c=${ID}&k=short&s=${ID}&p=signer`, opts)).toBeNull();
    expect(parseDeepLink(`clipwallet://link?v=1&c=${ID}&k=${KEY}&s=${ID}&p=signer&r=${encodeURIComponent("http://evil.example")}`, opts)).toBeNull();
  });
  it("keeps the handoff token of a browse link for Linked devices to check", () => {
    const raw = `clipwallet://browse?url=${encodeURIComponent("https://app.uniswap.org/swap")}&h=${"x".repeat(80)}`;
    expect(parseDeepLink(raw, opts)).toEqual({ kind: "browse", url: "https://app.uniswap.org/swap", handoff: raw });
    expect(parseDeepLink(`clipwallet://browse?url=${encodeURIComponent("https://app.uniswap.org")}`, opts)).toEqual({ kind: "browse", url: "https://app.uniswap.org" });
  });
});
