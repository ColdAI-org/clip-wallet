import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createMemoryPermissionStore } from "../src/background/index.js";
import { P2_FAMILIES, createP2Dispatcher, p2InjectedAllowlist, tezosEdpk, type BeaconRelay } from "../src/background/p2-families.js";
import { installAlgorandProvider } from "../src/inpage/algorand.js";
import { base58Encode } from "../src/inpage/injected-base.js";
import { installNearProvider } from "../src/inpage/near.js";
import { installStellarProvider } from "../src/inpage/stellar.js";
import { installTezosBeaconRelay } from "../src/inpage/tezos.js";
import type { EventListener, InpageTransport } from "../src/inpage/transport.js";
import { resolveIdentity } from "../src/shared/config.js";
import { ProviderRpcError } from "../src/shared/errors.js";
import { ALGORAND_GENESIS, algorandChainFromGenesisHash } from "../src/shared/p2-methods.js";
import type { ExposedAccount, OneMaskEvent } from "../src/shared/protocol.js";
import { newWindow, tick } from "./helpers.js";

const asset = (key: string, networkId: string) => ({ key, symbol: key.toUpperCase(), name: key, decimals: 6, networkId });
const net = (id: string, family: Family, name: string): Network => ({
  id,
  family,
  name,
  nativeAsset: asset(family, id),
  testnet: true,
  rpcUrls: [],
  explorerUrl: "https://example.org",
});

const ALGO_TESTNET = algorandChainFromGenesisHash("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=");
const NETWORKS: Network[] = [
  net("near:testnet", "near", "NEAR Testnet"),
  net("stellar:testnet", "stellar", "Stellar Testnet"),
  net("tezos:NetXsqzbfFenSTS", "tezos", "Tezos Shadownet"),
  net(ALGO_TESTNET, "algorand", "Algorand TestNet"),
];

const PUB = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29"; // RFC 8032 test 1 public key
const ACCOUNTS: Partial<Record<Family, ExposedAccount[]>> = {
  near: [{ address: PUB, publicKey: PUB }],
  stellar: [{ address: "GA6SXIZIKLJHCZI2KEOBEUUOFMM4JUPPM2UTWX6STAWT25JWIEUFIMFF", publicKey: PUB }],
  tezos: [{ address: "tz1XvkuUNDk8j2tG3RJaRUo4Xppcjc6FvK39", publicKey: PUB }], // beacon-utils getAddressFromPublicKey(PUB)
  algorand: [{ address: "HNVCPPGOW2SC2YVDVDICU3YNONSTEFLXDXREHJR2YBEKDC2Z3IUZSC6YGI", publicKey: PUB }],
};

/** Router stand-in: same policy surface the real router lends the dispatcher. */
function harness(handleImpl: (r: DappRequest) => unknown = () => ({ ok: true }), beacon?: BeaconRelay) {
  const permissions = createMemoryPermissionStore();
  const handled: DappRequest[] = [];
  const listeners = new Set<EventListener>();
  const ORIGIN = "https://dapp.example";
  const emit = (family: Family, event: OneMaskEvent, data?: unknown) => listeners.forEach((l) => l(family, event, data));
  const internals = {
    permitted: async (o: string, f: Family) => !!(await permissions.has(o, f)),
    requirePermission: async (o: string, f: Family) => {
      if (!(await permissions.has(o, f))) throw new ProviderRpcError(4100, "Connect first.");
    },
    accounts: async (_o: string, f: Family) => ACCOUNTS[f] ?? [],
    approve: async (req: DappRequest) => {
      handled.push(req);
      return handleImpl(req);
    },
    makeReq: (origin: string, family: Family, n: Network, method: string, params: unknown): DappRequest => ({
      id: `r${handled.length}`,
      origin,
      via: "injected",
      family,
      networkId: n.id,
      method,
      params,
    }),
    connect: async (o: string, f: Family, n: Network, method: string, params: unknown) => {
      await internals.approve(internals.makeReq(o, f, n, method, params));
      await permissions.grant(o, f);
      const list = ACCOUNTS[f] ?? [];
      emit(f, "accountsChanged", list);
      return list;
    },
    requireNetwork: (f: Family, _o: string, chain: string | undefined) => {
      const list = NETWORKS.filter((n) => n.family === f);
      const n = chain ? list.find((x) => x.id === chain) : list[0];
      if (!n) throw new ProviderRpcError(4901, "No such network.");
      return n;
    },
    revoke: async (o: string, f: Family) => {
      await permissions.revoke(o, f);
      emit(f, "disconnect");
    },
  };
  const d = createP2Dispatcher(internals, { beacon });
  const transport: InpageTransport = {
    request: async (family, method, params, chain) => {
      if (!p2InjectedAllowlist(family).has(method)) throw new ProviderRpcError(4200, `unsupported ${method}`);
      return JSON.parse(JSON.stringify((await d.dispatch(ORIGIN, family, method, params, chain)) ?? null));
    },
    onEvent: (l) => (listeners.add(l), () => listeners.delete(l)),
    destroy: () => listeners.clear(),
  };
  return { transport, handled, permissions, ORIGIN };
}

const identity = resolveIdentity();

describe("p2 allowlists", () => {
  it("covers exactly the four ed25519 families", () => {
    expect([...P2_FAMILIES].sort()).toEqual(["algorand", "near", "stellar", "tezos"]);
    expect(p2InjectedAllowlist("near").has("near_signAndSendTransaction")).toBe(true);
    expect(p2InjectedAllowlist("stellar").has("stellar_signAuthEntry")).toBe(true);
    expect(p2InjectedAllowlist("tezos").has("tezos:beacon")).toBe(true);
    expect(p2InjectedAllowlist("algorand").has("algo_signTxn")).toBe(true);
    expect(p2InjectedAllowlist("evm").size).toBe(0);
  });

  it("encodes edpk like octez (RFC 8032 key)", async () => {
    // base58check(0d0f25d9 || pk); same value as @airgap/beacon-utils prefixPublicKey(PUB).
    expect(await tezosEdpk(PUB)).toBe("edpku6Pc31JWM3RXfym4pG5RzoKkyNCxQzakzsfQiG1aKXP1J651n8");
    expect(await tezosEdpk("zz")).toBeUndefined();
  });
});

describe("NEAR injected provider", () => {
  it("is exposed under window.clipwallet.near and signs in, then sends a transaction", async () => {
    const win = newWindow();
    const h = harness(() => ({ status: { SuccessValue: "" }, transaction: { hash: "abc" } }));
    const { provider, stop } = installNearProvider(win, identity, NETWORKS, h.transport);
    const g = (win as unknown as { clipwallet: { near: unknown; info: { name: string } } }).clipwallet;
    expect(g.near).toBe(provider);
    expect(g.info.name).toBe("Clip Wallet");

    expect(await provider.getAccounts()).toEqual([]);
    const changed: unknown[] = [];
    provider.on("accountsChanged", (a) => changed.push(a));
    const accounts = await provider.signIn({ networkId: "testnet", contractId: "guest-book.testnet" });
    expect(accounts).toEqual([{ accountId: PUB, publicKey: `ed25519:${base58Encode(Uint8Array.from(Buffer.from(PUB, "hex")))}` }]);
    expect(changed).toHaveLength(1);
    expect(h.handled[0]!.method).toBe("near:connect");
    expect(h.handled[0]!.networkId).toBe("near:testnet");

    const out = await provider.signAndSendTransaction({ receiverId: "bob.testnet", actions: [{ type: "Transfer", params: { deposit: "1" } }] });
    expect(out).toMatchObject({ transaction: { hash: "abc" } });
    expect(h.handled[1]!).toMatchObject({ method: "near_signAndSendTransaction", params: { receiverId: "bob.testnet" } });

    await expect(provider.signAndSendTransaction({ signerId: "mallory.testnet", receiverId: "x", actions: [] })).rejects.toMatchObject({ code: 4100 });
    await expect(provider.signAndSendTransaction({ receiverId: "x", actions: [], networkId: "mainnet" })).rejects.toMatchObject({ code: 4901 });

    await provider.signMessage({ message: "hi", recipient: "dapp.example", nonce: new Uint8Array(32) });
    expect(h.handled[2]!.params).toEqual({ message: "hi", recipient: "dapp.example", nonce: btoa(String.fromCharCode(...new Uint8Array(32))) });

    await provider.signOut();
    expect(provider.accounts).toEqual([]);
    stop();
  });

  it("announces itself to NEAR Connect and converts ConnectorActions", async () => {
    const win = newWindow();
    const h = harness(() => ({ ok: true }));
    const seen: any[] = [];
    win.addEventListener("near-wallet-injected", (e) => seen.push((e as CustomEvent).detail));
    const { stop } = installNearProvider(win, identity, NETWORKS, h.transport);
    expect(seen).toHaveLength(1);
    win.dispatchEvent(new Event("near-selector-ready"));
    expect(seen).toHaveLength(2);
    const w = seen[0];
    expect(w.manifest).toMatchObject({ id: "org.coldai.clipwallet", type: "injected", features: { testnet: true, mainnet: false, signAndSendTransaction: true, signDelegateActions: false } });
    await w.signIn({ network: "testnet" });
    await w.signAndSendTransaction({
      receiverId: "c.testnet",
      actions: [{ type: "FunctionCall", params: { methodName: "m", args: new Uint8Array([1, 2]), gas: "1", deposit: "0" } }],
    });
    expect(h.handled.at(-1)!.params).toEqual({ receiverId: "c.testnet", actions: [{ type: "FunctionCall", params: { methodName: "m", argsBase64: "AQI=", gas: "1", deposit: "0" } }] });
    await expect(w.signDelegateActions()).rejects.toMatchObject({ code: 4200 });
    stop();
  });

  it("refuses signing before connect", async () => {
    const h = harness();
    const { provider } = installNearProvider(newWindow(), identity, NETWORKS, h.transport);
    await expect(provider.signAndSendTransaction({ receiverId: "x", actions: [] })).rejects.toMatchObject({ code: 4100 });
  });
});

describe("Stellar injected provider (SEP-43)", () => {
  it("returns results and SEP-43 error objects instead of throwing", async () => {
    const h = harness((r) => {
      if (r.method === "stellar:connect") return true;
      if (r.method === "stellar_signXDR") return { signedXDR: "SIGNED" };
      if (r.method === "stellar_signMessage") return { signedMessage: "c2ln", signature: "c2ln", signerAddress: ACCOUNTS.stellar![0]!.address };
      if (r.method === "stellar_signAuthEntry") throw new ProviderRpcError(4001, "You declined.");
      return null;
    });
    const { provider } = installStellarProvider(newWindow(), identity, NETWORKS, h.transport);
    expect(await provider.getAddress()).toEqual({ address: ACCOUNTS.stellar![0]!.address });
    expect(await provider.getNetwork()).toEqual({ network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" });
    expect(await provider.signTransaction("AAAA", { networkPassphrase: "Test SDF Network ; September 2015" })).toEqual({
      signedTxXdr: "SIGNED",
      signerAddress: ACCOUNTS.stellar![0]!.address,
    });
    expect(h.handled.at(-1)!.networkId).toBe("stellar:testnet");
    expect(await provider.signMessage("hello")).toEqual({ signedMessage: "c2ln", signerAddress: ACCOUNTS.stellar![0]!.address });
    expect(await provider.signAuthEntry("AAAA")).toEqual({ error: { code: -4, message: "You declined." } });
    expect((await provider.signTransaction("AAAA", { networkPassphrase: "Public Global Stellar Network ; September 2015" })).error?.code).toBe(-3);
    expect((await provider.signTransaction("AAAA", { submitUrl: "https://evil.example" })).error?.code).toBe(-3);
    expect((await provider.signTransaction("AAAA", { address: "GBOTHER" })).error?.code).toBe(-3);
  });
});

describe("Algorand injected provider", () => {
  it("enables on testnet and signs ARC-1 groups (also WalletConnect's nested array)", async () => {
    const h = harness((r) => (r.method === "algo_signTxn" ? ["c2lnbmVk", null] : r.method === "algo_signAndPostTxn" ? { txId: "TXID" } : true));
    const { provider } = installAlgorandProvider(newWindow(), identity, NETWORKS, h.transport);
    await expect(provider.signTxns([{ txn: "AA" }])).rejects.toMatchObject({ code: 4202 });
    await expect(provider.enable({ genesisID: "mainnet-v1.0" })).rejects.toMatchObject({ code: 4200 });
    const res = await provider.enable({ genesisHash: ALGORAND_GENESIS[ALGO_TESTNET]!.genesisHash });
    expect(res).toEqual({ genesisID: "testnet-v1.0", genesisHash: "SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=", accounts: [ACCOUNTS.algorand![0]!.address] });
    expect(h.handled[0]).toMatchObject({ method: "algorand:connect", networkId: ALGO_TESTNET });
    expect(await provider.signTxns([[{ txn: "AA" }, { txn: "BB", signers: [] }]])).toEqual(["c2lnbmVk", null]);
    expect(h.handled[1]!.params).toEqual([{ txn: "AA" }, { txn: "BB", signers: [] }]);
    expect(await provider.signAndPostTxns([{ txn: "AA" }])).toEqual({ txnIDs: ["TXID"] });
    await expect(provider.signTxns([{ nope: 1 } as never])).rejects.toMatchObject({ code: 4300 });
    await expect(provider.enable({ accounts: ["SOMEONEELSE"] })).rejects.toMatchObject({ code: 4001 });
  });

  it("derives CAIP-2 references from genesis hashes (base64url, 32 chars)", () => {
    expect(algorandChainFromGenesisHash("wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=")).toBe("algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k");
    expect(algorandChainFromGenesisHash("SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=")).toBe("algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe");
  });
});

describe("Tezos Beacon relay", () => {
  it("answers ping with pong and relays addressed messages to the background peer", async () => {
    const win = newWindow();
    const received: unknown[] = [];
    const beacon: BeaconRelay = {
      receive: async (origin, message) => {
        received.push({ origin, message });
        return message.payload ? { replies: [{ payload: "beef" }] } : { replies: [{ encryptedPayload: "aa01" }], pending: "p1" };
      },
      result: async (_o, id) => [{ encryptedPayload: `bb${id === "p1" ? "02" : "00"}` }],
    };
    const h = harness(undefined, beacon);
    const { extensionId, stop } = installTezosBeaconRelay(win, identity, h.transport);
    expect(extensionId).toBe("org.coldai.clipwallet");
    const seen: any[] = [];
    win.addEventListener("message", (e) => seen.push((e as MessageEvent).data));

    win.postMessage({ target: "toExtension", payload: "ping" }, win.location.origin);
    await tick(5);
    expect(seen.find((m) => m.payload === "pong")).toMatchObject({ target: "toPage", sender: { id: extensionId, name: "Clip Wallet" } });

    win.postMessage({ target: "toExtension", payload: "pairing", targetId: "someone.else" }, win.location.origin);
    await tick(5);
    expect(received).toHaveLength(0);

    win.postMessage({ target: "toExtension", payload: "pairing", targetId: extensionId }, win.location.origin);
    await tick(5);
    expect(received[0]).toEqual({ origin: h.ORIGIN, message: { payload: "pairing" } });
    expect(seen.find((m) => m.message?.payload === "beef")).toEqual({ message: { target: "toPage", payload: "beef" }, sender: { id: extensionId } });

    win.postMessage({ target: "toExtension", encryptedPayload: "c0ffee", targetId: extensionId }, win.location.origin);
    await tick(10);
    const enc = seen.filter((m) => m.message?.encryptedPayload).map((m) => m.message.encryptedPayload);
    expect(enc).toEqual(["aa01", "bb02"]);
    stop();
  });

  it("answers tezos_getAccounts with edpk keys once connected", async () => {
    const h = harness();
    await expect(h.transport.request("tezos", "tezos_getAccounts", {})).rejects.toMatchObject({ code: 4100 });
    await h.transport.request("tezos", "tezos:connect", {}, "tezos:NetXsqzbfFenSTS");
    const [acct] = (await h.transport.request("tezos", "tezos_getAccounts", {})) as { algo: string; address: string; pubkey: string }[];
    expect(acct).toMatchObject({ algo: "ed25519", address: ACCOUNTS.tezos![0]!.address });
    expect(acct!.pubkey.startsWith("edpk")).toBe(true);
    await expect(h.transport.request("tezos", "tezos_send", { account: "tz1someoneelse", operations: [] })).rejects.toMatchObject({ code: 4100 });
  });
});
