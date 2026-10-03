import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { Nft } from "@clip-wallet/core";
import { mergeBalances } from "../src/lib/portfolio";
import { formatUnits, parseUnits, readyIn } from "../src/lib/format";
import { normaliseMediaUrl, proxyMedia } from "../src/lib/media";
import { WebAuthnPasskeyPrf, PasskeyError, runPasskeyCeremony, b64urlEncode } from "../src/lib/passkey";
import { NftMedia } from "../src/components";
import { ClipProvider, Router } from "../src/context";
import { groupCollectibles } from "../src/screens/Collectibles";
import { isWalletConnectUri } from "../src/screens/Settings";
import { render } from "@testing-library/react";
import { BALANCES, fakeClient, state } from "./fake-client";

describe("mergeBalances", () => {
  it("merges by AssetRef.key, keeps bridged copies apart, hides spam", () => {
    const r = mergeBalances(BALANCES);
    const usdc = r.assets.find((a) => a.id === "usdc")!;
    expect(usdc.amount).toBe("412000000");
    expect(usdc.fiatValue).toBe(412);
    expect(usdc.parts).toHaveLength(2);
    expect(r.assets.find((a) => a.key === "usdc.e")!.bridged).toBe(true);
    expect(r.assets.some((a) => a.spam)).toBe(false);
    expect(r.hiddenSpam).toBe(1);
    expect(r.total).toBeCloseTo(604.51);
  });

  it("never merges a bridged copy even if it reuses the key", () => {
    const b = BALANCES.map((x) => (x.asset.key === "usdc.e" ? { ...x, asset: { ...x.asset, key: "usdc" } } : x));
    const r = mergeBalances(b);
    expect(r.assets.filter((a) => a.key === "usdc")).toHaveLength(2);
  });

  it("pins first, hides small balances, searches", () => {
    expect(mergeBalances(BALANCES, { pinned: ["hbar"] }).assets[0]!.key).toBe("hbar");
    expect(mergeBalances(BALANCES, { hideSmallBalances: true }).assets.some((a) => a.key === "dust")).toBe(false);
    expect(mergeBalances(BALANCES, { search: "ether" }).assets.map((a) => a.key)).toEqual(["eth"]);
  });

  it("sums assets with different decimals on different networks", () => {
    const r = mergeBalances([
      { asset: { key: "x", symbol: "X", name: "X", decimals: 6, networkId: "a" }, amount: "1000000" },
      { asset: { key: "x", symbol: "X", name: "X", decimals: 8, networkId: "b" }, amount: "100000000" },
    ]);
    expect(formatUnits(r.assets[0]!.amount, r.assets[0]!.decimals)).toBe("2");
  });
});

describe("format", () => {
  it("round-trips units", () => {
    expect(parseUnits("25.5", 6)).toBe(25500000n);
    expect(parseUnits("1.1234567", 6)).toBeNull();
    expect(parseUnits("abc", 6)).toBeNull();
    expect(formatUnits("1234567890000", 6)).toBe("1,234,567.89");
    expect(readyIn(10)).toBe("in about 10 seconds");
    expect(readyIn(130)).toBe("in about 2 minutes");
  });
});

describe("untrusted NFT media", () => {
  const nft = (mediaUrl?: string): Nft => ({ networkId: "eip155:84532", standard: "erc721", collection: { address: "0xc", name: "Frogs" }, tokenId: "1", mediaUrl });

  it("never fetches originals and blocks non-http schemes", () => {
    expect(proxyMedia("https://x.example/a.png", undefined)).toBeNull();
    expect(proxyMedia("javascript:alert(1)", "https://proxy.example/m")).toBeNull();
    expect(proxyMedia("data:text/html,<script>", "https://proxy.example/m")).toBeNull();
    expect(proxyMedia("https://x.example/page.html", "https://proxy.example/m")).toBeNull();
    expect(normaliseMediaUrl("ipfs://bafy/1.svg")).toBe("https://ipfs.io/ipfs/bafy/1.svg");
    expect(proxyMedia("https://x.example/a.mp4", "https://proxy.example/m")).toEqual({
      kind: "video",
      src: "https://proxy.example/m?url=https%3A%2F%2Fx.example%2Fa.mp4&kind=video",
    });
  });

  it("renders SVG as a proxied <img> with no-referrer, never inline", () => {
    render(
      <ClipProvider client={fakeClient()} initialState={state()} options={{ mediaProxyUrl: "https://proxy.example/m" }}>
        <Router memory>
          <NftMedia nft={nft("https://evil.example/x.svg")} />
        </Router>
      </ClipProvider>,
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toMatch(/^https:\/\/proxy\.example\/m\?url=/);
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(document.querySelector("svg image, iframe, object, embed")).toBeNull();
  });

  it("draws a placeholder when no proxy is configured", () => {
    render(
      <ClipProvider client={fakeClient()} initialState={state()}>
        <Router memory>
          <NftMedia nft={nft("https://evil.example/x.png")} />
        </Router>
      </ClipProvider>,
    );
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Frogs #1" })).toHaveClass("clip-nft-media--placeholder");
  });

  it("groups by collection, network is only a filter, spam hidden", () => {
    const items: Nft[] = [
      nft(),
      { ...nft(), tokenId: "2" },
      { ...nft(), networkId: "hedera:testnet", collection: { address: "0.0.9", name: "Owls" } },
      { ...nft(), collection: { address: "0xs", name: "Free mint!!" }, spam: true },
    ];
    expect(groupCollectibles(items).map((g) => [g.name, g.items.length])).toEqual([["Frogs", 2], ["Owls", 1]]);
    expect(groupCollectibles(items, { network: "hedera:testnet" }).map((g) => g.name)).toEqual(["Owls"]);
  });
});

describe("WalletConnect URIs", () => {
  it("accepts v2 pairing URIs only", () => {
    const topic = "a".repeat(64);
    expect(isWalletConnectUri(`wc:${topic}@2?relay-protocol=irn&symKey=${"b".repeat(64)}`)).toBe(true);
    expect(isWalletConnectUri(`wc:${topic}@1?bridge=x&key=y`)).toBe(false);
    expect(isWalletConnectUri("https://example.com")).toBe(false);
  });
});

describe("WebAuthnPasskeyPrf", () => {
  class FakePKC {}
  vi.stubGlobal("PublicKeyCredential", FakePKC);
  const prfOut = new Uint8Array(32).fill(7);
  const cred = (ext: unknown) => ({ rawId: new Uint8Array([1, 2, 3]).buffer, getClientExtensionResults: () => ext });
  const opts = { rpId: null, rpName: "Clip Wallet", userId: new Uint8Array([9]), userName: "Clip Wallet" };
  const input = new Uint8Array(32).fill(1);

  it("returns PRF output from create when the authenticator evaluates at creation", async () => {
    const credentials = { create: vi.fn(async () => cred({ prf: { enabled: true, results: { first: prfOut.buffer } } })), get: vi.fn() };
    const prf = new WebAuthnPasskeyPrf({ ...opts, credentials: credentials as unknown as CredentialsContainer });
    const r = await prf.enroll(input);
    expect([...r.credentialId]).toEqual([1, 2, 3]);
    expect(r.prfOutput).toEqual(prfOut);
    const arg = (credentials.create.mock.calls[0] as unknown as [CredentialCreationOptions])[0];
    expect((arg.publicKey!.extensions as { prf: { eval: { first: Uint8Array } } }).prf.eval.first).toEqual(input);
    expect(arg.publicKey!.rp.id).toBeUndefined();
    expect(credentials.get).not.toHaveBeenCalled();
  });

  it("follows up with get() when create only reports prf.enabled", async () => {
    const credentials = {
      create: vi.fn(async () => cred({ prf: { enabled: true } })),
      get: vi.fn(async () => cred({ prf: { results: { first: prfOut } } })),
    };
    const prf = new WebAuthnPasskeyPrf({ ...opts, rpId: "wallet.example", credentials: credentials as unknown as CredentialsContainer });
    const r = await prf.enroll(input);
    expect(r.prfOutput).toEqual(prfOut);
    const getArg = (credentials.get.mock.calls[0] as unknown as [CredentialRequestOptions])[0];
    expect(getArg.publicKey!.rpId).toBe("wallet.example");
    expect(getArg.publicKey!.userVerification).toBe("required");
  });

  it("throws no-prf when PRF is unsupported so the app falls back to the password", async () => {
    const credentials = { create: vi.fn(async () => cred({})), get: vi.fn() };
    const prf = new WebAuthnPasskeyPrf({ ...opts, credentials: credentials as unknown as CredentialsContainer });
    await expect(prf.enroll(input)).rejects.toMatchObject({ code: "no-prf" });
  });

  it("maps a cancelled prompt to a plain message", async () => {
    const credentials = { create: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" }))), get: vi.fn() };
    const prf = new WebAuthnPasskeyPrf({ ...opts, credentials: credentials as unknown as CredentialsContainer });
    await expect(prf.enroll(input)).rejects.toBeInstanceOf(PasskeyError);
    await expect(prf.enroll(input)).rejects.toMatchObject({ code: "cancelled" });
  });

  it("runPasskeyCeremony hands the vault's prfInput through and returns the output", async () => {
    const begin = vi.fn(async () => ({
      id: "c1",
      op: "unlock" as const,
      rpId: null,
      rpName: "Clip",
      userId: "",
      userName: "Clip",
      prfInput: b64urlEncode(input),
      credentialId: b64urlEncode(new Uint8Array([1, 2, 3])),
      mode: "extension" as const,
      bridgeUrl: "",
    }));
    const finish = vi.fn(async () => undefined);
    const evaluate = vi.fn(async (_id: Uint8Array, _in: Uint8Array) => new Uint8Array(32).fill(5));
    await runPasskeyCeremony({ passkeyBegin: begin, passkeyFinish: finish }, { create: () => ({ enroll: vi.fn(), evaluate }) }, { op: "unlock" });
    expect([...evaluate.mock.calls[0]![0]]).toEqual([1, 2, 3]);
    expect(evaluate.mock.calls[0]![1]).toEqual(input);
    expect(finish).toHaveBeenCalledWith({ id: "c1", credentialId: "AQID", prfOutput: b64urlEncode(new Uint8Array(32).fill(5)) });
  });
});

describe("theme tokens from @clip-wallet/config", async () => {
  const { defineConfig } = await import("@clip-wallet/config");
  const { tokensFor } = await import("../src/theme/tokens");
  const { defaultClipConfig } = await import("../src/theme/config");
  it("defaults to ColdAI orange with white button text and Inter", () => {
    const t = tokensFor(defaultClipConfig, "light");
    expect(t["--clip-accent"]).toBe("#FF3C00");
    expect(t["--clip-accent-text"]).toBe("#FFFFFF");
    expect(t["--clip-font"]).toMatch(/^"Inter Variable", "Inter"/);
  });
  it("rebrands from config alone and derives the radius scale", () => {
    const t = tokensFor(defineConfig({ name: "Acme", rdns: "com.acme.wallet", theme: { accent: "#4F46E5", font: "Geist", radius: 10 } }), "dark");
    expect(t["--clip-accent"]).toBe("#4F46E5");
    expect(t["--clip-font"]).toMatch(/"Geist"/);
    expect([t["--clip-radius-sm"], t["--clip-radius-md"], t["--clip-radius-lg"]]).toEqual(["7px", "10px", "14px"]);
    expect(t["--clip-bg"]).toBe("#0F0F10");
  });
});
