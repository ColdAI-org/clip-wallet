/**
 * In-process WalletClient over the engine (React Native, tests). Same contract the extension's pages use
 * over the message bus, so screens written against @clip-wallet/ui's WalletClient work unchanged.
 * Requests still go through the zod schema: the UI is trusted code, but the check costs nothing and keeps
 * both hosts identical.
 */
import type { WalletClient } from "@clip-wallet/ui";
import type { WalletEngine } from "./engine.js";

export function createEngineClient(engine: WalletEngine, opts: { subscribe(cb: () => void): () => void }): WalletClient {
  const call = <T>(msg: unknown) => engine.handleUntrusted(msg) as Promise<T>;
  return {
    getState: () => call({ type: "getState" }),
    setPrefs: (patch) => call({ type: "setPrefs", patch }),
    createWallet: (password) => call({ type: "createWallet", password }),
    revealPhrase: (password) => call({ type: "revealPhrase", password }),
    importWallet: (phrase, password) => call({ type: "importWallet", phrase, password }),
    unlock: (password) => call({ type: "unlock", password }),
    lock: () => call({ type: "lock" }),
    passkeyBegin: (begin) => call({ type: "passkeyBegin", begin }),
    passkeyFinish: (result) => call({ type: "passkeyFinish", result }),
    passkeyRemove: () => call({ type: "passkeyRemove" }),
    getPortfolio: (o) => call({ type: "getPortfolio", refresh: o?.refresh }),
    getCollectibles: () => call({ type: "getCollectibles" }),
    getActivity: () => call({ type: "getActivity" }),
    resolveRecipient: (p) => call({ type: "resolveRecipient", ...p }),
    rememberRecipientNetwork: (p) => call({ type: "rememberRecipientNetwork", ...p }),
    send: (p) => call({ type: "send", ...p }),
    getReceiveTargets: (p) => call({ type: "getReceiveTargets", ...p }),
    listApprovals: () => call({ type: "listApprovals" }),
    getApproval: (id) => call({ type: "getApproval", id }),
    approve: (id, o) => call({ type: "approve", id, allowBlind: o?.allowBlind }),
    reject: (id) => call({ type: "reject", id }),
    listSessions: () => call({ type: "listSessions" }),
    disconnect: (id) => call({ type: "disconnect", id }),
    pairWalletConnect: (uri) => call({ type: "pairWalletConnect", uri }),
    openFullTab: (route) => call({ type: "openFullTab", route }),
    onChange: (cb) => opts.subscribe(cb),
  };
}
