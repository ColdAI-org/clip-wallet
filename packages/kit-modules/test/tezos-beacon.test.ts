// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BeaconV2Request, WalletDispatch } from "../src/tezos/index.js";

/**
 * A window whose postMessage events carry `source === window` and the page origin, like a browser's.
 * Installed as globalThis.window BEFORE Beacon loads, because Beacon captures `windowRef` at import.
 */
function fakeWindow(origin = "https://dapp.example") {
  const listeners = new Set<(e: unknown) => void>();
  const win: any = {
    location: { origin },
    addEventListener: (_t: string, l: (e: unknown) => void) => void listeners.add(l),
    removeEventListener: (_t: string, l: (e: unknown) => void) => void listeners.delete(l),
    postMessage: (data: unknown) => {
      const copy = structuredClone(data);
      setTimeout(() => [...listeners].forEach((l) => l({ data: copy, source: win, origin })));
    },
  };
  return win;
}
const win = fakeWindow();
(globalThis as any).window = win;
const { Serializer, getSenderId } = await import("@airgap/beacon-core");
const { PostMessageTransport } = await import("@airgap/beacon-transport-postmessage");
const { getKeypairFromSeed, toHex } = await import("@airgap/beacon-utils");
const { installTezosBeaconRelay } = await import("@clip-wallet/1mask/inpage/p2");
const { BEACON_ERROR, createBeaconExtensionPeer, createBeaconP2PWallet, mapBeaconRequest, DEFAULT_TEZOS_NETWORKS } = await import("../src/tezos/index.js");

/** Beacon's dApp-side PostMessageClient (only reachable through PostMessageTransport). */
const dappClient = (name: string, keys: unknown): any =>
  (new PostMessageTransport(name, keys as never, { get: async () => [], set: async () => {} } as never, "beacon:postmessage-peers-dapp" as never) as any).client;

/**
 * Interop test: Beacon's own dApp-side PostMessageClient (@airgap/beacon-transport-postmessage 4.8, the
 * code @airgap/beacon-dapp runs) talks to 1Mask's page relay and our background peer through a real
 * window (fakeWindow). Transport keys come from Beacon's getKeypairFromSeed with fixed test seeds: they
 * are Beacon session keys, not account keys, and nothing here signs for an account.
 */

const PUB = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";
const TZ1 = "tz1XvkuUNDk8j2tG3RJaRUo4Xppcjc6FvK39"; // beacon-utils getAddressFromPublicKey(PUB)
const EDPK = "edpku6Pc31JWM3RXfym4pG5RzoKkyNCxQzakzsfQiG1aKXP1J651n8";
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await tick(2);
  }
}

function memoryStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { get: async (k: string) => m.get(k), set: async (k: string, v: string) => void m.set(k, v), m };
}

function wallet(behaviour: (method: string, params: any) => unknown) {
  const calls: { origin: string; method: string; params: any; chain?: string }[] = [];
  const dispatch: WalletDispatch = async (origin, input) => {
    calls.push({ origin, method: input.method, params: input.params, chain: input.chain });
    return behaviour(input.method, input.params);
  };
  return { dispatch, calls };
}

describe("Beacon request mapping", () => {
  it("maps v2 requests onto tezos_* wallet methods", () => {
    const base = { version: "2", id: "1", senderId: "S" };
    expect(mapBeaconRequest({ ...base, type: "permission_request", network: { type: "shadownet" }, scopes: ["operation_request", "sign"], appMetadata: { senderId: "S", name: "App" } }, DEFAULT_TEZOS_NETWORKS)).toEqual({
      kind: "call",
      method: "tezos:connect",
      params: { scopes: ["operation_request", "sign"], app: { name: "App", icon: undefined } },
      chain: "tezos:NetXsqzbfFenSTS",
    });
    expect(mapBeaconRequest({ ...base, type: "permission_request", network: { type: "weeklynet" } }, DEFAULT_TEZOS_NETWORKS)).toEqual({ kind: "error", errorType: BEACON_ERROR.networkNotSupported });
    expect(mapBeaconRequest({ ...base, type: "operation_request", network: { type: "mainnet" }, sourceAddress: TZ1, operationDetails: [{ kind: "transaction", amount: "1", destination: TZ1 }] }, DEFAULT_TEZOS_NETWORKS)).toMatchObject({
      kind: "call",
      method: "tezos_send",
      params: { account: TZ1 },
      chain: "tezos:NetXdQprcVkpaWU",
    });
    expect(mapBeaconRequest({ ...base, type: "sign_payload_request", payload: "05", signingType: "micheline", sourceAddress: TZ1 }, DEFAULT_TEZOS_NETWORKS)).toEqual({
      kind: "call",
      method: "tezos_sign",
      params: { account: TZ1, payload: "05", signingType: "micheline" },
    });
    expect(mapBeaconRequest({ ...base, type: "broadcast_request", signedTransaction: "00" }, DEFAULT_TEZOS_NETWORKS)).toEqual({ kind: "error", errorType: BEACON_ERROR.broadcast });
  });
});

describe("Beacon extension peer + 1Mask relay vs Beacon's dApp PostMessageClient", () => {
  it("is discovered, pairs, and answers permission, operation and sign requests", async () => {
    const storage = memoryStorage({ "beacon:seed": "clip-wallet-test-seed" });
    const w = wallet((method) => {
      if (method === "tezos:connect") return [{ address: TZ1, publicKey: PUB }];
      if (method === "tezos_send") return { operationHash: "ooTestHash" };
      if (method === "tezos_sign") return { signature: "edsigTest" };
      throw Object.assign(new Error("nope"), { code: 4200 });
    });
    const peer = createBeaconExtensionPeer({ name: "Clip Wallet", iconUrl: "https://clip.example/icon.png", dispatch: w.dispatch, storage });
    const origin = win.location.origin;
    const transport = {
      request: async (_family: string, method: string, params: any) =>
        JSON.parse(JSON.stringify(method === "tezos:beacon" ? await peer.receive(origin, params.message) : await peer.result(origin, params.id))),
      onEvent: () => () => {},
      destroy: () => {},
    };
    const identity = { name: "Clip Wallet", icon: "data:image/png;base64,AA==" as const, rdns: "org.coldai.clipwallet" };
    const relay = installTezosBeaconRelay(win, identity, transport as never);

    // 1. Discovery: Beacon pings, we pong with our sender info.
    const pongs: any[] = [];
    const onPong = (e: any) => e.data?.payload === "pong" && pongs.push(e.data.sender);
    win.addEventListener("message", onPong);
    win.postMessage({ target: "toExtension", payload: "ping" }, win.location.origin);
    await until(() => pongs.length > 0);
    expect(pongs).toContainEqual({ id: "org.coldai.clipwallet", name: "Clip Wallet", iconUrl: identity.icon });

    // 2. Pairing with Beacon's dApp client.
    const dappKeys = await getKeypairFromSeed("dapp-test-seed");
    const dapp = dappClient("Test dApp", dappKeys);
    const paired = new Promise<any>((resolve) => dapp.listenForChannelOpening(async (r: any) => resolve(r)));
    await dapp.sendPairingRequest(relay.extensionId);
    const pairing = await paired;
    expect(pairing.name).toBe("Clip Wallet");
    expect(pairing.extensionId).toBe("org.coldai.clipwallet");
    expect(pairing.publicKey).toMatch(/^[0-9a-f]{64}$/);

    // 3. Encrypted v2 requests.
    const ser = new Serializer();
    const inbox: any[] = [];
    await dapp.listenForEncryptedMessage(pairing.publicKey, async (m: string) => inbox.push(await ser.deserialize(m)));
    const dappSender = await getSenderId(toHex(dappKeys.publicKey));
    const send = async (msg: Record<string, unknown>) => dapp.sendMessage(await ser.serialize({ version: "2", senderId: dappSender, ...msg }), pairing);

    await send({ id: "p1", type: "permission_request", appMetadata: { senderId: dappSender, name: "Test dApp" }, network: { type: "shadownet" }, scopes: ["operation_request", "sign", "encrypt"] });
    await until(() => inbox.length >= 2);
    expect(inbox.map((m) => m.type)).toEqual(["acknowledge", "permission_response"]);
    expect(inbox[1]).toMatchObject({ id: "p1", version: "2", publicKey: EDPK, address: TZ1, network: { type: "shadownet" }, scopes: ["operation_request", "sign"], senderId: await peer.senderId() });
    expect(w.calls[0]).toEqual({ origin, method: "tezos:connect", params: { scopes: ["operation_request", "sign", "encrypt"], app: { name: "Test dApp", icon: undefined } }, chain: "tezos:NetXsqzbfFenSTS" });

    await send({ id: "o1", type: "operation_request", network: { type: "shadownet" }, sourceAddress: TZ1, operationDetails: [{ kind: "transaction", amount: "1000000", destination: TZ1 }] });
    await send({ id: "s1", type: "sign_payload_request", signingType: "micheline", payload: "05010000000568656c6c6f", sourceAddress: TZ1 });
    await until(() => inbox.some((m) => m.id === "o1" && m.type !== "acknowledge") && inbox.some((m) => m.id === "s1" && m.type !== "acknowledge"));
    expect(inbox.find((m) => m.id === "o1" && m.type === "operation_response")).toMatchObject({ transactionHash: "ooTestHash" });
    expect(inbox.find((m) => m.id === "s1" && m.type === "sign_payload_response")).toMatchObject({ signingType: "micheline", signature: "edsigTest" });

    // 4. Errors become Beacon errors; unknown peers are ignored.
    await send({ id: "x1", type: "broadcast_request", network: { type: "shadownet" }, signedTransaction: "00" });
    await until(() => inbox.some((m) => m.id === "x1" && m.type !== "acknowledge"));
    expect(inbox.find((m) => m.id === "x1" && m.type !== "acknowledge")).toMatchObject({ type: "error", errorType: "BROADCAST_ERROR" });
    expect(await peer.receive("https://other.example", { encryptedPayload: "00".repeat(60) })).toEqual({ replies: [] });

    // 5. The pairing survives a background restart (peers + seed in storage).
    const again = createBeaconExtensionPeer({ name: "Clip Wallet", dispatch: w.dispatch, storage });
    expect(await again.senderId()).toBe(await peer.senderId());
    expect(Object.keys(await again.peers())).toEqual([origin]);
    relay.stop();
    win.removeEventListener("message", onPong);
  });

  it("turns a declined approval into ABORTED_ERROR", async () => {
    const storage = memoryStorage({ "beacon:seed": "clip-wallet-test-seed-2" });
    const w = wallet(() => {
      throw Object.assign(new Error("declined"), { code: 4001 });
    });
    const peer = createBeaconExtensionPeer({ name: "Clip Wallet", dispatch: w.dispatch, storage });
    const dappKeys = await getKeypairFromSeed("dapp-test-seed-2");
    const ser = new Serializer();
    // Pair directly (no window): the pairing request is what PostMessageClient.getPairingRequestInfo builds.
    const pairingReq = await ser.serialize({ type: "postmessage-pairing-request", id: "pair-1", name: "dApp", publicKey: toHex(dappKeys.publicKey), version: "3" });
    const { replies } = await peer.receive("https://dapp.example", { payload: pairingReq });
    expect(replies).toHaveLength(1);
    expect(replies[0]!.payload).toMatch(/^[0-9a-f]+$/);

    const dapp = dappClient("dApp", dappKeys);
    const ext = (await peer.peers())["https://dapp.example"]![0]!;
    expect(ext.publicKey).toBe(toHex(dappKeys.publicKey));
    // Encrypt a request the way the dApp does, for the wallet's key.
    const { getKeypairFromSeed: kp } = await import("@airgap/beacon-utils");
    const walletPub = toHex((await kp("clip-wallet-test-seed-2")).publicKey);
    const enc = await (dapp as any).encryptMessage(walletPub, await ser.serialize({ version: "2", senderId: "D", id: "q1", type: "sign_payload_request", payload: "00", signingType: "raw", sourceAddress: TZ1 }));
    const first = await peer.receive("https://dapp.example", { encryptedPayload: enc });
    expect(first.pending).toBeTruthy();
    const [reply] = await peer.result("https://dapp.example", first.pending!);
    const decoded = await ser.deserialize(await (dapp as any).decryptMessage(walletPub, reply!.encryptedPayload));
    expect(decoded).toMatchObject({ type: "error", id: "q1", errorType: "ABORTED_ERROR" });
  });
});

describe("Beacon P2P wallet wrapper", () => {
  it("answers WalletClient requests through dispatch and responds with Beacon messages", async () => {
    const responses: Record<string, unknown>[] = [];
    let cb: ((m: any, c?: unknown) => void) | undefined;
    const client = {
      init: async () => "p2p",
      connect: async (f: (m: any, c: unknown) => void) => void (cb = f),
      respond: async (m: Record<string, unknown>) => void responses.push(m),
      addPeer: async () => {},
    };
    const w = wallet((method) => (method === "tezos:connect" ? [{ address: TZ1, publicKey: PUB }] : { operationHash: "ooP2P" }));
    const p2p = createBeaconP2PWallet({ client, dispatch: w.dispatch });
    await p2p.start();
    const req: BeaconV2Request = { type: "permission_request", version: "2", id: "a", senderId: "SID", appMetadata: { senderId: "SID", name: "Mobile dApp" }, network: { type: "mainnet" }, scopes: ["sign"] };
    cb!(req);
    await until(() => responses.length >= 1);
    cb!({ type: "operation_request", version: "2", id: "b", senderId: "SID", network: { type: "mainnet" }, sourceAddress: TZ1, operationDetails: [{ kind: "delegation" }] });
    await until(() => responses.length >= 2);
    expect(w.calls.map((c) => [c.origin, c.method])).toEqual([
      ["beacon:SID", "tezos:connect"],
      ["beacon:SID", "tezos_send"],
    ]);
    expect(responses[0]).toMatchObject({ type: "permission_response", id: "a", publicKey: EDPK, scopes: ["sign"] });
    expect(responses[1]).toEqual({ type: "operation_response", id: "b", transactionHash: "ooP2P" });
  });
});
