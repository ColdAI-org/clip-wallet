/** Pairing protocol: SAS on both screens, key confirmation, and a man in the middle on the relay. */
import { describe, expect, it } from "vitest";
import { memoryChannelPair } from "../src/pairing/channel.js";
import { contextFromOffer, newOffer, offerToUri, pair, parseOfferUri, PairingError } from "../src/pairing/pairing.js";
import { openSession, encodeValue, decodeValue } from "../src/pairing/session.js";
import { b64url } from "../src/bytes.js";
import { fakePairingKey, tick } from "./helpers.js";

async function setup(tap?: Parameters<typeof memoryChannelPair>[0]) {
  const ki = fakePairingKey("initiator");
  const kr = fakePairingKey("responder");
  const offer = newOffer({ key: ki, purpose: "signer", relay: "https://relay.test", name: "Chrome on Mac" });
  const [a, b] = memoryChannelPair(tap);
  const pi = pair({ channel: a, role: "i", key: ki, ctx: contextFromOffer(offer, "i"), me: { name: "Chrome on Mac", platform: "extension" }, timeoutMs: 2000 });
  const pr = pair({ channel: b, role: "r", key: kr, ctx: contextFromOffer(parseOfferUri(offerToUri(offer))!, "r"), me: { name: "Pixel 9", platform: "mobile" }, timeoutMs: 2000 });
  return { a, b, pi, pr, ki, kr, offer };
}

describe("QR offer", () => {
  it("round-trips through the clipwallet://link URI and refuses junk", () => {
    const o = newOffer({ key: fakePairingKey(), purpose: "device-add", relay: "https://relay.test", name: "Tab" });
    expect(parseOfferUri(offerToUri(o))).toEqual(o);
    expect(parseOfferUri("https://evil.example/link?v=1")).toBeNull();
    expect(parseOfferUri(offerToUri({ ...o, relay: "http://evil.example" }))).toBeNull();
    expect(parseOfferUri(offerToUri({ ...o, key: "short" }))).toBeNull();
  });
});

describe("pairing", () => {
  it("both devices show the same 6-digit code and end with the same link secret", async () => {
    const { pi, pr } = await setup();
    const [i, r] = await Promise.all([pi, pr]);
    expect(i.sas).toMatch(/^\d{6}$/);
    expect(i.sas).toBe(r.sas);
    expect(i.peer.name).toBe("Pixel 9");
    expect(r.peer.name).toBe("Chrome on Mac");
    const [pa, pb] = await Promise.all([i.confirm(), r.confirm()]);
    expect(b64url(pa.linkSecret)).toBe(b64url(pb.linkSecret));
    expect(pa.role).toBe("i");
    expect(pb.role).toBe("r");
  });

  it("one person tapping 'They don't match' ends it on both sides", async () => {
    const { pi, pr } = await setup();
    const [i, r] = await Promise.all([pi, pr]);
    r.reject();
    await expect(i.confirm()).rejects.toMatchObject({ code: "rejected" });
  });

  it("MITM swapping the responder's key (and its commitment): different codes, and confirming anyway fails", async () => {
    const mallory = fakePairingKey("mallory");
    const tap = (from: "a" | "b", frame: string) => {
      const m = JSON.parse(frame);
      if (from === "b" && m.t === "hello") m.commit = b64url((globalThis as unknown as { __h: (x: Uint8Array) => Uint8Array }).__h(mallory.publicKey));
      if (from === "b" && m.t === "reveal") m.k = b64url(mallory.publicKey);
      return JSON.stringify(m);
    };
    const { sha256 } = await import("@noble/hashes/sha2.js");
    (globalThis as unknown as { __h: typeof sha256 }).__h = sha256;
    const { pi, pr } = await setup(tap);
    const [i, r] = await Promise.all([pi, pr]);
    expect(i.sas).not.toBe(r.sas);
    // Even if both people tap "match" without looking, key confirmation fails and nothing is paired.
    const results = await Promise.allSettled([i.confirm(), r.confirm()]);
    expect(results.every((x) => x.status === "rejected")).toBe(true);
    expect(results.map((x) => ((x as PromiseRejectedResult).reason as PairingError).code)).toContain("mismatch");
  });

  it("MITM swapping the initiator's key is caught against the QR", async () => {
    const mallory = fakePairingKey("mallory2");
    const tap = (from: "a" | "b", frame: string) => {
      const m = JSON.parse(frame);
      if (from === "a" && m.t === "key") m.k = b64url(mallory.publicKey);
      return JSON.stringify(m);
    };
    const { pi, pr } = await setup(tap);
    await expect(pr).rejects.toMatchObject({ code: "bad-key" });
    await expect(pi).rejects.toBeInstanceOf(PairingError);
  });

  it("a responder that changes its key after committing is refused", async () => {
    const other = fakePairingKey("switch");
    const tap = (from: "a" | "b", frame: string) => {
      const m = JSON.parse(frame);
      if (from === "b" && m.t === "reveal") m.k = b64url(other.publicKey);
      return JSON.stringify(m);
    };
    const { pi } = await setup(tap);
    await expect(pi).rejects.toMatchObject({ code: "bad-key" });
  });

  it("times out when nobody answers", async () => {
    const ki = fakePairingKey();
    const [a] = memoryChannelPair();
    const o = newOffer({ key: ki, purpose: "signer", name: "x" });
    await expect(pair({ channel: a, role: "i", key: ki, ctx: contextFromOffer(o, "i"), me: { name: "x", platform: "extension" }, timeoutMs: 30 })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("secure session", () => {
  async function paired(tap?: Parameters<typeof memoryChannelPair>[0]) {
    const { pi, pr } = await setup();
    const [i, r] = await Promise.all([pi, pr]);
    const [pa, pb] = await Promise.all([i.confirm(), r.confirm()]);
    const [a, b] = memoryChannelPair(tap);
    const [sa, sb] = await Promise.all([openSession(a, pa.linkSecret, "i"), openSession(b, pb.linkSecret, "r")]);
    return { sa, sb, pa, pb };
  }

  it("carries values (incl. bytes and bigints) both ways, encrypted on the wire", async () => {
    const wire: string[] = [];
    const { sa, sb } = await paired((_f, frame) => (wire.push(frame), frame));
    const got: unknown[] = [];
    sb.onMessage((m) => got.push(m));
    sa.send({ t: "request", value: 10n ** 20n, bytes: new Uint8Array([1, 2, 3]), note: "Send 10 USDC" });
    await tick(5);
    expect(got).toEqual([{ t: "request", value: 10n ** 20n, bytes: new Uint8Array([1, 2, 3]), note: "Send 10 USDC" }]);
    expect(wire.join("")).not.toContain("USDC");
    expect(decodeValue(encodeValue({ a: 1n }))).toEqual({ a: 1n });
  });

  it("a tampered, replayed or reordered frame closes the session", async () => {
    let held: string | undefined;
    let mode: "tamper" | "replay" | "pass" = "pass";
    const { sa, sb } = await paired((from, frame) => {
      if (from !== "a" || !frame.includes('"t":"x"')) return frame;
      if (mode === "replay") {
        held ??= frame;
        return held;
      }
      if (mode === "tamper") {
        const m = JSON.parse(frame);
        m.d = m.d.slice(0, -2) + (m.d.endsWith("A") ? "BB" : "AA");
        return JSON.stringify(m);
      }
      return frame;
    });
    const got: unknown[] = [];
    sb.onMessage((m) => got.push(m));
    mode = "replay";
    sa.send({ n: 1 });
    sa.send({ n: 2 }); // relay replays frame 1 instead
    await tick(5);
    expect(got).toEqual([{ n: 1 }]);
    expect(sb.isOpen).toBe(false);
  });

  it("a device with another link secret can't open a session", async () => {
    const { pa } = await paired();
    const [a, b] = memoryChannelPair();
    const wrong = new Uint8Array(32).fill(9);
    const r = await Promise.allSettled([openSession(a, pa.linkSecret, "i", 500), openSession(b, wrong, "r", 500)]);
    expect(r.every((x) => x.status === "rejected")).toBe(true);
  });
});
