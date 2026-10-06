import { describe, expect, it } from "vitest";
import { guessKind, isBlockedHost, mediaProxyUrl, normaliseMediaSource, parseProxyQuery, sniffMediaType } from "../src/index.js";

const CID0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const CID1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const AR = "bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U";

describe("normaliseMediaSource", () => {
  it("canonicalises ipfs:// forms and gateway URLs", () => {
    expect(normaliseMediaSource(`ipfs://${CID0}`)).toEqual({ url: `ipfs://${CID0}`, scheme: "ipfs" });
    expect(normaliseMediaSource(`ipfs://ipfs/${CID1}/1.png`)).toEqual({ url: `ipfs://${CID1}/1.png`, scheme: "ipfs" });
    expect(normaliseMediaSource(`${CID1}/a.gif`)!.url).toBe(`ipfs://${CID1}/a.gif`);
    expect(normaliseMediaSource(`https://ipfs.io/ipfs/${CID0}/x.png`)!.url).toBe(`ipfs://${CID0}/x.png`);
    expect(normaliseMediaSource(`https://${CID1}.ipfs.dweb.link/7.png`)!.url).toBe(`ipfs://${CID1}/7.png`);
  });

  it("canonicalises arweave", () => {
    expect(normaliseMediaSource(`ar://${AR}`)).toEqual({ url: `ar://${AR}`, scheme: "ar" });
    expect(normaliseMediaSource(`https://arweave.net/${AR}`)!.url).toBe(`ar://${AR}`);
    expect(normaliseMediaSource("ar://short")).toBeNull();
  });

  it("keeps plain https/http and drops the fragment", () => {
    expect(normaliseMediaSource("https://example.com/a.png#x")).toEqual({ url: "https://example.com/a.png", scheme: "https" });
    expect(normaliseMediaSource("http://example.com/a.png")!.scheme).toBe("http");
  });

  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,<svg onload=alert(1)>",
    "blob:https://x/1",
    "file:///etc/passwd",
    "https://user:pw@example.com/a.png",
    "https://example.com:8080/a.png",
    "http://localhost/a.png",
    "http://127.0.0.1/a.png",
    "http://2130706433/a.png",
    "http://0x7f000001/a.png",
    "http://10.1.2.3/a.png",
    "http://192.168.1.1/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/a.png",
    "http://metadata.google.internal/",
    "http://printer.local/a.png",
    "http://intranet/a.png",
    `ipfs://${CID0}/../../etc`,
    "ipfs://notacid",
    "",
  ])("rejects %s", (raw) => {
    expect(normaliseMediaSource(raw)).toBeNull();
  });

  it("rejects oversized input", () => {
    expect(normaliseMediaSource(`https://example.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("audit MEDIA-01: hosts are parsed, not matched as strings", () => {
  it("blocks loopback, private and link-local addresses in any spelling the URL parser accepts", () => {
    for (const h of ["127.1", "0x7f.0.0.1", "0177.0.0.1", "２１３０７０６４３３", "１２７.0.0.1", "10.1", "192.168.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "[fe80::1]", "::1"]) {
      expect([h, isBlockedHost(h)]).toEqual([h, true]);
    }
  });

  it("blocks special-use and private-use names by their last labels, with any case or a trailing dot", () => {
    for (const h of ["LOCALHOST.", "api.localhost", "Printer.LOCAL.", "a.b.home.arpa", "metadata.google.internal", "router.lan", "nas.home", "x.test", "x.invalid", "intranet", "exa mple.com", ""]) {
      expect([h, isBlockedHost(h)]).toEqual([h, true]);
    }
  });

  it("blocks reserved, documentation and benchmark ranges", () => {
    for (const h of ["198.51.100.7", "203.0.113.9", "192.0.2.1", "192.88.99.1", "240.0.0.1", "255.255.255.255", "198.19.255.255"]) {
      expect([h, isBlockedHost(h)]).toEqual([h, true]);
    }
  });

  it("doesn't block public names that merely contain those words", () => {
    for (const h of ["local.example.com", "localhost.example.com", "internal-cdn.example.com", "lan.party", "1.1.1.1", "203.0.114.1"]) {
      expect([h, isBlockedHost(h)]).toEqual([h, false]);
    }
  });

  it("normaliseMediaSource refuses those hosts too, and rewrites IPFS subdomain gateways by label", () => {
    for (const raw of ["http://router.lan/a.png", "https://cdn.test/a.png", "http://198.51.100.7/a.png", "http://[fe80::1]/a.png"]) expect([raw, normaliseMediaSource(raw)]).toEqual([raw, null]);
    const v1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    expect(normaliseMediaSource(`https://${v1}.ipfs.dweb.link/a.png`)).toEqual({ url: `ipfs://${v1}/a.png`, scheme: "ipfs" });
    expect(normaliseMediaSource(`https://x.${v1}.ipfs.dweb.link/a.png`)!.scheme).toBe("https");
  });
});

describe("isBlockedHost", () => {
  it("allows public names and IPs", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    expect(isBlockedHost("172.32.0.1")).toBe(false);
  });
  it("blocks private ranges", () => {
    for (const h of ["172.16.0.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1"]) expect(isBlockedHost(h)).toBe(true);
  });
});

describe("mediaProxyUrl", () => {
  it("returns null without a proxy (never fetch the original)", () => {
    expect(mediaProxyUrl(undefined, "https://example.com/a.png")).toBeNull();
  });
  it("builds a canonical, encoded URL and guesses the kind", () => {
    const p = mediaProxyUrl("https://media.example/", `https://ipfs.io/ipfs/${CID0}/clip.mp4`);
    expect(p).toEqual({ kind: "video", src: `https://media.example/v1/media?src=${encodeURIComponent(`ipfs://${CID0}/clip.mp4`)}&kind=video` });
    expect(mediaProxyUrl("https://m", "https://example.com/page.html")).toBeNull();
    expect(mediaProxyUrl("https://m", "https://example.com/a", { kind: "image" })!.kind).toBe("image");
  });
  it("round-trips through parseProxyQuery", () => {
    const p = mediaProxyUrl("https://m", `ar://${AR}`)!;
    const q = parseProxyQuery(new URL(p.src).searchParams);
    expect(q).toEqual({ source: { url: `ar://${AR}`, scheme: "ar" }, kind: "image" });
    expect(parseProxyQuery(new URLSearchParams("src=https%3A%2F%2Fexample.com%2Fa&kind=html"))).toBeNull();
  });
  it("guessKind", () => {
    expect(guessKind("x.webm")).toBe("video");
    expect(guessKind("x.svg")).toBe("image");
    expect(guessKind("x.js")).toBeNull();
  });
});

describe("sniffMediaType", () => {
  const bytes = (...xs: (number | string)[]) =>
    new Uint8Array(xs.flatMap((x) => (typeof x === "number" ? [x] : [...x].map((c) => c.charCodeAt(0)))));
  it("recognises image and video signatures", () => {
    expect(sniffMediaType(bytes(0x89, "PNG\r\n\x1a\n", 0, 0))).toBe("image/png");
    expect(sniffMediaType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMediaType(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffMediaType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe("image/webp");
    expect(sniffMediaType(bytes(0, 0, 0, 0x20, "ftypavif"))).toBe("image/avif");
    expect(sniffMediaType(bytes(0, 0, 0, 0x20, "ftypisom"))).toBe("video/mp4");
    expect(sniffMediaType(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe("video/webm");
  });
  it("recognises SVG with prolog, comments and doctype", () => {
    const svg = '﻿<?xml version="1.0"?>\n<!-- hi -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(sniffMediaType(new TextEncoder().encode(svg))).toBe("image/svg+xml");
  });
  it("rejects HTML, scripts and JSON", () => {
    for (const s of ["<!doctype html><html>", "<script>alert(1)</script>", '{"name":"x"}', "<html><svg>"]) expect(sniffMediaType(new TextEncoder().encode(s))).toBeNull();
  });
});
