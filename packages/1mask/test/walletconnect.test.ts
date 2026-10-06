import { isWalletOrigin, type DappRequest, type Family } from "@clip-wallet/core";
import { describe, expect, it, vi } from "vitest";
import {
  assessVerify,
  createWalletConnectWallet,
  mapProposalNamespaces,
  namedAccounts,
  parseHederaAccount,
  type AuthUtils,
  type WalletKitLike,
  type WcSessionLike,
} from "../src/walletconnect/index.js";
import * as P from "./fixtures/proposals.js";
import { EVM_ADDR, NETWORKS, SOL_ADDR, BTC_ADDR, tick } from "./helpers.js";

const addressesFor = (chain: string, family: Family): string[] =>
  (({ evm: [EVM_ADDR], solana: [SOL_ADDR], bitcoin: [BTC_ADDR], hedera: chain === "hedera:testnet" ? ["0.0.1234"] : [] }) as Partial<Record<Family, string[]>>)[family] ?? [];
const input = { networks: NETWORKS, addressesFor };

describe("CAIP-25 namespace mapping (fixtures, no network)", () => {
  it("approves only registry chains from optional namespaces and reports the rest", () => {
    const m = mapProposalNamespaces(P.evmOptionalOnly, input);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.namespaces.eip155).toEqual({
      chains: ["eip155:11155111", "eip155:84532"],
      accounts: [`eip155:11155111:${EVM_ADDR}`, `eip155:84532:${EVM_ADDR}`],
      methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "wallet_switchEthereumChain"],
      events: ["chainChanged", "accountsChanged"],
    });
    expect(m.unsupported.chains).toEqual(["eip155:1"]);
    expect(m.unsupported.methods).toEqual(["eth_sign", "wallet_getCapabilities"]);
    expect(m.unsupported.events).toEqual(["message"]);
  });

  it("rejects when a required chain is unsupported", () => {
    const m = mapProposalNamespaces(P.evmRequiresMainnet, input);
    expect(m).toMatchObject({ ok: false, reason: "UNSUPPORTED_CHAINS", unsupported: { chains: ["eip155:1"] } });
  });

  it("keeps required-but-unsupported methods for conformance and reports them", () => {
    const m = mapProposalNamespaces(P.evmRequiresEthSign, input);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.namespaces.eip155!.methods).toContain("eth_sign");
    expect(m.unsupported.methods).toEqual(["eth_sign"]);
  });

  it("handles chain-keyed namespaces", () => {
    const m = mapProposalNamespaces(P.chainKeyed, input);
    expect(m.ok && m.namespaces.eip155).toEqual({
      chains: ["eip155:84532"],
      accounts: [`eip155:84532:${EVM_ADDR}`],
      methods: ["personal_sign"],
      events: ["accountsChanged"],
    });
  });

  it("maps the hedera namespace to account ids, plus eip155:296", () => {
    const m = mapProposalNamespaces(P.hederaDapp, input);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.namespaces.hedera).toMatchObject({
      chains: ["hedera:testnet"],
      accounts: ["hedera:testnet:0.0.1234"],
      events: ["chainChanged", "accountsChanged"],
    });
    expect(m.namespaces.hedera!.methods).toHaveLength(6);
    expect(m.namespaces.eip155!.chains).toEqual(["eip155:296"]);
    expect(m.unsupported.chains).toEqual(["hedera:mainnet"]);
  });

  it("drops a chain the wallet has no account on yet", () => {
    const m = mapProposalNamespaces(P.hederaDapp, { networks: NETWORKS, addressesFor: (c, f) => (f === "hedera" ? [] : addressesFor(c, f)) });
    expect(m.ok && m.namespaces.hedera).toBeFalsy();
    expect(m.unsupported.chains).toContain("hedera:testnet");
  });

  it("maps solana and bip122, ignores optional unknown namespaces", () => {
    const m = mapProposalNamespaces(P.multichain, input);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.namespaces.solana).toMatchObject({
      chains: ["solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"],
      accounts: [`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${SOL_ADDR}`],
    });
    expect(m.namespaces.bip122).toMatchObject({
      chains: ["bip122:000000000933ea01ad0ee984209779ba"],
      accounts: [`bip122:000000000933ea01ad0ee984209779ba:${BTC_ADDR}`],
      methods: ["signMessage", "signPsbt", "sendTransfer", "getAccountAddresses"],
      events: ["bip122_addressesChanged"],
    });
    expect(m.namespaces.cosmos).toBeUndefined();
    expect(m.unsupported.namespaces).toEqual(["cosmos"]);
  });

  it("rejects a required unknown namespace key", () => {
    expect(mapProposalNamespaces(P.requiresCosmos, input)).toMatchObject({ ok: false, reason: "UNSUPPORTED_NAMESPACE_KEY" });
  });
});

describe("Verify API → warnings", () => {
  const ctx = (validation: "VALID" | "INVALID" | "UNKNOWN", origin: string, isScam?: boolean) => ({
    verified: { origin, validation, verifyUrl: "https://verify.walletconnect.org", ...(isScam ? { isScam } : {}) },
  });
  it("VALID uses the attested origin and adds nothing", () => {
    expect(assessVerify(ctx("VALID", "https://app.uniswap.org"), "https://app.uniswap.org")).toEqual({
      origin: "https://app.uniswap.org",
      verification: "verified",
      warnings: [],
    });
  });
  it("INVALID → domain-mismatch danger", () => {
    const a = assessVerify(ctx("INVALID", "https://uniswap-airdrop.example"), "https://app.uniswap.org");
    expect(a.verification).toBe("mismatch");
    expect(a.warnings).toEqual([expect.objectContaining({ level: "danger", code: "domain-mismatch" })]);
    // Audit WC-01: a claim Verify contradicts is never attributed to the claimed site.
    expect(a.origin).toBe("https://app.uniswap.org.unverified.invalid");
  });
  it("audit WC-01: an unconfirmed claim gets a pseudo-origin and a caution, never the real site or the wallet", () => {
    const a = assessVerify(ctx("UNKNOWN", ""), "https://app.uniswap.org/swap");
    expect(a.origin).toBe("https://app.uniswap.org.unverified.invalid");
    expect(a.verification).toBe("unverified");
    expect(a.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "domain-mismatch" }));
    const noCtx = assessVerify(undefined, "https://victim.example");
    expect(noCtx.origin).toBe("https://victim.example.unverified.invalid");
    // WC-02: a peer can't pass for the wallet's own requests.
    for (const claim of ["clip-wallet", "wallet", "javascript:alert(1)", undefined]) {
      const w = assessVerify(undefined, claim);
      expect(isWalletOrigin(w.origin)).toBe(false);
      expect(w.origin).toBe("https://unknown.unverified.invalid");
    }
    // A Verify-attested web origin is used as is.
    expect(assessVerify(ctx("VALID", "https://app.uniswap.org"), "https://app.uniswap.org").origin).toBe("https://app.uniswap.org");
    expect(assessVerify(ctx("VALID", "clip-wallet"), "clip-wallet").origin).toBe("https://unknown.unverified.invalid");
  });
  it("isScam or local blocklist → known-scam danger", () => {
    expect(assessVerify(ctx("VALID", "https://x.example", true), "https://x.example").warnings).toEqual([
      expect.objectContaining({ level: "danger", code: "known-scam" }),
    ]);
    const a = assessVerify(undefined, "https://drainer.example/app", (o) => o === "https://drainer.example");
    expect(a.verification).toBe("scam");
  });
});

/* ------------------------------------------------------------------ fake WalletKit */

function fakeKit() {
  const handlers = new Map<string, (a: any) => void>();
  const sessions: Record<string, WcSessionLike> = {};
  const calls: { name: string; args: any }[] = [];
  const rec = (name: string) => async (args: any) => void calls.push({ name, args });
  const kit: WalletKitLike = {
    pair: rec("pair"),
    approveSession: async (args) => {
      calls.push({ name: "approveSession", args });
      return { topic: "t1" };
    },
    rejectSession: rec("rejectSession"),
    respondSessionRequest: rec("respondSessionRequest"),
    disconnectSession: rec("disconnectSession"),
    getActiveSessions: () => sessions,
    emitSessionEvent: rec("emitSessionEvent"),
    updateSession: rec("updateSession"),
    approveSessionAuthenticate: rec("approveSessionAuthenticate"),
    rejectSessionAuthenticate: rec("rejectSessionAuthenticate"),
    formatAuthMessage: ({ iss }) => `dapp.example wants you to sign in with ${iss}`,
    on: (e, l) => void handlers.set(e, l),
    off: (e) => void handlers.delete(e),
  };
  return { kit, handlers, sessions, calls, fire: async (e: string, a: any) => (handlers.get(e)!(a), tick(5)) };
}

const peer = { name: "Dapp", description: "", url: "https://dapp.example", icons: [] };

async function wallet(over: Partial<Parameters<typeof createWalletConnectWallet>[0]> = {}) {
  const f = fakeKit();
  const handled: { req: DappRequest; ctx: any }[] = [];
  const authUtils: AuthUtils = {
    populateAuthPayload: ({ authPayload, chains }) => ({ ...authPayload, chains }),
    buildAuthObject: (payload, s, iss) => ({ h: { t: "caip122" }, p: { ...payload, iss }, s }),
  };
  const w = await createWalletConnectWallet({
    projectId: "test-project-id",
    metadata: { name: "Clip Wallet", description: "", url: "https://clip.example", icons: [] },
    networks: NETWORKS,
    addressesFor,
    approveProposal: async () => true,
    handle: async (req, ctx) => (handled.push({ req, ctx }), req.method === "wallet_authenticate" ? "0xsiwe" : "0xresult"),
    walletKitFactory: async () => f.kit,
    authUtils,
    ...over,
  });
  return { w, f, handled };
}

describe("WalletConnect wallet (fake WalletKit)", () => {
  it("requires a projectId from options", async () => {
    await expect(createWalletConnectWallet({ projectId: "" } as any)).rejects.toThrow(/projectId/);
  });

  it("passes the projectId to the factory and validates pairing URIs", async () => {
    const factory = vi.fn(async () => fakeKit().kit);
    const { w } = await wallet({ walletKitFactory: factory, projectId: "from-config" });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ projectId: "from-config" }));
    expect(() => w.pair("https://not-wc")).toThrow();
  });

  it("approves a proposal with mapped namespaces after the user says yes, with warnings", async () => {
    const approveProposal = vi.fn(async () => true);
    const { f } = await wallet({ approveProposal });
    await f.fire("session_proposal", {
      id: 7,
      params: { id: 7, proposer: { metadata: peer }, ...P.evmOptionalOnly },
      verifyContext: { verified: { origin: "https://evil.example", validation: "INVALID", verifyUrl: "" } },
    });
    expect(approveProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedChains: ["eip155:11155111", "eip155:84532"],
        warnings: [expect.objectContaining({ code: "domain-mismatch" })],
        unsupported: expect.objectContaining({ chains: ["eip155:1"] }),
      }),
    );
    expect(f.calls.at(-1)).toMatchObject({ name: "approveSession", args: { id: 7 } });
  });

  it("audit WC-04: a proposal that shares other kinds of address says so on the connect screen", async () => {
    const approveProposal = vi.fn(async () => true);
    const { f } = await wallet({ approveProposal });
    await f.fire("session_proposal", { id: 8, params: { id: 8, proposer: { metadata: peer }, ...P.multichain } });
    const arg = (approveProposal.mock.calls[0] as unknown as [{ warnings: { code: string; level: string; message: string }[] }])[0];
    expect(arg.warnings).toContainEqual(expect.objectContaining({ level: "info", code: "network-matters", message: expect.stringMatching(/addresses on \d+ networks/) }));
  });

  it("rejects unsupported proposals with SDK codes, and user rejection with 5000", async () => {
    const { f } = await wallet({ approveProposal: async () => false });
    await f.fire("session_proposal", { id: 1, params: { id: 1, proposer: { metadata: peer }, ...P.evmRequiresMainnet } });
    expect(f.calls.at(-1)).toMatchObject({ name: "rejectSession", args: { id: 1, reason: { code: 5100 } } });
    await f.fire("session_proposal", { id: 2, params: { id: 2, proposer: { metadata: peer }, ...P.evmOptionalOnly } });
    expect(f.calls.at(-1)).toMatchObject({ name: "rejectSession", args: { id: 2, reason: { code: 5000 } } });
  });

  function withSession(f: ReturnType<typeof fakeKit>) {
    f.sessions.t1 = {
      topic: "t1",
      expiry: 0,
      peer: { metadata: peer },
      namespaces: {
        eip155: {
          chains: ["eip155:11155111", "eip155:84532"],
          accounts: [`eip155:11155111:${EVM_ADDR}`, `eip155:84532:${EVM_ADDR}`],
          methods: ["personal_sign", "eth_sendTransaction", "eth_sign", "wallet_switchEthereumChain", "eth_accounts"],
          events: ["chainChanged", "accountsChanged"],
        },
        hedera: {
          chains: ["hedera:testnet"],
          accounts: ["hedera:testnet:0.0.1234"],
          methods: ["hedera_signAndExecuteTransaction"],
          events: ["accountsChanged"],
        },
      },
    };
  }
  const reqEv = (id: number, chainId: string, method: string, params: unknown) => ({
    id,
    topic: "t1",
    params: { chainId, request: { method, params } },
    verifyContext: { verified: { origin: "https://dapp.example", validation: "VALID", verifyUrl: "" } },
  });

  it("turns session_request into DappRequest{via:'walletconnect'} and responds", async () => {
    const { f, handled } = await wallet();
    withSession(f);
    await f.fire("session_request", reqEv(11, "eip155:84532", "personal_sign", ["0x68", EVM_ADDR]));
    expect(handled[0]!.req).toMatchObject({
      via: "walletconnect",
      origin: "https://dapp.example",
      family: "evm",
      networkId: "eip155:84532",
      method: "personal_sign",
    });
    expect(handled[0]!.ctx).toMatchObject({ verification: "verified", warnings: [] });
    expect(f.calls.at(-1)).toMatchObject({ name: "respondSessionRequest", args: { topic: "t1", response: { id: 11, result: "0xresult" } } });

    await f.fire("session_request", reqEv(12, "hedera:testnet", "hedera_signAndExecuteTransaction", { signerAccountId: "hedera:testnet:0.0.1234", transactionList: "AA==" }));
    expect(handled[1]!.req).toMatchObject({ family: "hedera", networkId: "hedera:testnet", method: "hedera_signAndExecuteTransaction" });
  });

  it("refuses eth_sign even when the session lists it, and unapproved methods/chains", async () => {
    const { f, handled } = await wallet();
    withSession(f);
    await f.fire("session_request", reqEv(21, "eip155:84532", "eth_sign", [EVM_ADDR, "0x00"]));
    expect(f.calls.at(-1)!.args.response).toMatchObject({ id: 21, error: { code: 5101 } });
    await f.fire("session_request", reqEv(22, "eip155:84532", "eth_signTypedData_v4", [EVM_ADDR, "{}"]));
    expect(f.calls.at(-1)!.args.response).toMatchObject({ id: 22, error: { code: 3001 } });
    await f.fire("session_request", reqEv(23, "eip155:1", "personal_sign", ["0x", EVM_ADDR]));
    expect(f.calls.at(-1)!.args.response).toMatchObject({ id: 23, error: { code: 5100 } });
    expect(handled).toEqual([]);
  });

  it("audit WC-05: a request naming an account or chain the session didn't approve gets 5103 / 5100 and never reaches the wallet", async () => {
    const { f, handled } = await wallet();
    withSession(f);
    const OTHER = "0x2222222222222222222222222222222222222222";
    const cases: [number, string, string, unknown, number][] = [
      [61, "eip155:84532", "personal_sign", ["0x68", OTHER], 5103],
      [62, "eip155:84532", "eth_sendTransaction", [{ from: OTHER, to: EVM_ADDR, value: "0x1" }], 5103],
      [63, "eip155:84532", "eth_sendTransaction", [{ from: EVM_ADDR, to: EVM_ADDR, value: "0x1", chainId: "0x1" }], 5100],
      [64, "eip155:84532", "personal_sign", ["0x68", 7], 5103],
      [65, "hedera:testnet", "hedera_signAndExecuteTransaction", { signerAccountId: "hedera:testnet:0.0.9999", transactionList: "AA==" }, 5103],
      [66, "hedera:testnet", "hedera_signAndExecuteTransaction", { signerAccountId: "hedera:mainnet:0.0.1234", transactionList: "AA==" }, 5100],
    ];
    for (const [id, chain, method, params, code] of cases) {
      await f.fire("session_request", reqEv(id, chain, method, params));
      expect(f.calls.at(-1)!.args.response).toMatchObject({ id, error: { code } });
    }
    expect(handled).toEqual([]);
    // The session's own account (any case; Hedera with a checksum) still goes through.
    await f.fire("session_request", reqEv(67, "eip155:84532", "personal_sign", ["0x68", EVM_ADDR.toLowerCase()]));
    await f.fire("session_request", reqEv(68, "eip155:84532", "eth_sendTransaction", [{ from: EVM_ADDR, to: EVM_ADDR, value: "0x1", chainId: "0x14a34" }]));
    await f.fire("session_request", reqEv(69, "hedera:testnet", "hedera_signAndExecuteTransaction", { signerAccountId: "hedera:testnet:0.0.1234-abcde", transactionList: "AA==" }));
    expect(handled.map((h) => h.req.method)).toEqual(["personal_sign", "eth_sendTransaction", "hedera_signAndExecuteTransaction"]);
  });

  it("audit WC-05: the accounts each namespace's requests name", () => {
    expect(namedAccounts("eip155", "eth_signTypedData_v4", [EVM_ADDR, "{}"]).accounts).toEqual([EVM_ADDR]);
    expect(namedAccounts("solana", "solana_signMessage", { message: "x", pubkey: SOL_ADDR }).accounts).toEqual([SOL_ADDR]);
    expect(namedAccounts("bip122", "signMessage", { account: BTC_ADDR, address: "tb1other", message: "x" }).accounts).toEqual([BTC_ADDR, "tb1other"]);
    expect(namedAccounts("near", "near_signIn", { contractId: "c.testnet", accounts: [{ accountId: "me.testnet" }] }).accounts).toEqual(["me.testnet"]);
    expect(namedAccounts("tezos", "tezos_send", { account: "tz1x", operations: [] }).accounts).toEqual(["tz1x"]);
    expect(namedAccounts("stellar", "stellar_signMessage", { address: "GABC", message: "x" }).accounts).toEqual(["GABC"]);
    expect(namedAccounts("algorand", "algo_signTxn", [[{ txn: "AA==", signers: ["ALGO1"] }, { txn: "AA==" }]]).accounts).toEqual(["ALGO1"]);
    expect(namedAccounts("tezos", "tezos_send", { account: 5 }).malformed).toBe(true);
    expect(parseHederaAccount("hedera:testnet:0.0.42-vfmkw")).toEqual({ chain: "hedera:testnet", account: "0.0.42" });
  });

  it("answers session-local methods without a prompt; switch within the session only", async () => {
    const { f, handled } = await wallet();
    withSession(f);
    await f.fire("session_request", reqEv(31, "eip155:84532", "eth_accounts", []));
    expect(f.calls.at(-1)!.args.response).toMatchObject({ result: [EVM_ADDR] });
    await f.fire("session_request", reqEv(32, "eip155:84532", "wallet_switchEthereumChain", [{ chainId: "0xaa36a7" }]));
    expect(f.calls.find((c) => c.name === "emitSessionEvent")).toMatchObject({ args: { event: { name: "chainChanged", data: 11155111 }, chainId: "eip155:11155111" } });
    await f.fire("session_request", reqEv(33, "eip155:84532", "wallet_switchEthereumChain", [{ chainId: "0x1" }]));
    expect(f.calls.at(-1)!.args.response).toMatchObject({ id: 33, error: { code: 5100 } });
    expect(handled).toEqual([]);
  });

  it("maps user rejection to 5000", async () => {
    const { f } = await wallet({ handle: async () => Promise.reject({ code: 4001, message: "no" }) });
    withSession(f);
    await f.fire("session_request", reqEv(41, "eip155:84532", "personal_sign", ["0x68", EVM_ADDR]));
    expect(f.calls.at(-1)!.args.response).toMatchObject({ id: 41, error: { code: 5000 } });
  });

  it("one-click auth: signs a SIWE/CAIP-122 message once and approves with a CACAO", async () => {
    const { f, handled } = await wallet();
    await f.fire("session_authenticate", {
      id: 51,
      topic: "p1",
      params: {
        requester: { metadata: peer },
        authPayload: { chains: ["eip155:1", "eip155:84532"], domain: "dapp.example", aud: "https://dapp.example", nonce: "n", type: "caip122", version: "1", iat: "now" },
      },
    });
    expect(handled[0]!.req).toMatchObject({ method: "wallet_authenticate", networkId: "eip155:84532", via: "walletconnect" });
    expect((handled[0]!.req.params as any).message).toContain(`did:pkh:eip155:84532:${EVM_ADDR}`);
    expect(f.calls.at(-1)).toMatchObject({
      name: "approveSessionAuthenticate",
      args: { id: 51, auths: [{ s: { t: "eip191", s: "0xsiwe" }, p: { iss: `did:pkh:eip155:84532:${EVM_ADDR}`, chains: ["eip155:84532"] } }] },
    });
  });

  it("one-click auth with no supported chain is rejected", async () => {
    const { f } = await wallet();
    await f.fire("session_authenticate", {
      id: 52,
      topic: "p1",
      params: { requester: { metadata: peer }, authPayload: { chains: ["eip155:1"], domain: "d", aud: "a", nonce: "n" } },
    });
    expect(f.calls.at(-1)).toMatchObject({ name: "rejectSessionAuthenticate", args: { id: 52, reason: { code: 5100 } } });
  });

  it("lists and disconnects sessions", async () => {
    const { w, f } = await wallet();
    withSession(f);
    expect(w.sessions()).toEqual([
      { topic: "t1", peer, expiry: 0, chains: ["eip155:11155111", "eip155:84532", "hedera:testnet"] },
    ]);
    await w.disconnect("t1");
    expect(f.calls.at(-1)).toMatchObject({ name: "disconnectSession", args: { topic: "t1", reason: { code: 6000 } } });
  });
});

describe("real SDK surface (import only, no network)", () => {
  it("@reown/walletkit exports WalletKit.init and @walletconnect/core exports Core", async () => {
    const [{ WalletKit }, { Core }, utils] = await Promise.all([
      import("@reown/walletkit"),
      import("@walletconnect/core"),
      import("@walletconnect/utils"),
    ]);
    expect(typeof WalletKit.init).toBe("function");
    expect(typeof Core).toBe("function");
    expect(typeof utils.populateAuthPayload).toBe("function");
    expect(typeof utils.buildAuthObject).toBe("function");
    expect(utils.getSdkError("USER_REJECTED").code).toBe(5000);
    expect(utils.getSdkError("UNSUPPORTED_CHAINS").code).toBe(5100);
    expect(utils.getSdkError("UNSUPPORTED_METHODS").code).toBe(5101);
    expect(utils.getSdkError("UNAUTHORIZED_METHOD").code).toBe(3001);
    expect(utils.getSdkError("USER_DISCONNECTED").code).toBe(6000);
  });
});
