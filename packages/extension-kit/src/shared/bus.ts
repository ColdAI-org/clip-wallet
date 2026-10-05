/** Page-side WalletClient over the message bus. */
import type { PluginsClient, WalletClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { CHANGE_EVENT, Envelope, type Request, type RequestType, type ResponseMap } from "./messages";
import type {} from "../globals";

export type Transport = (msg: Request) => Promise<unknown>;

const runtimeTransport: Transport = (msg) => browser.runtime.sendMessage(msg);

export class BusError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

export function createBusClient(transport: Transport = runtimeTransport, mocks = false, withPlugins = import.meta.env.BROWSER !== "firefox"): WalletClient {
  async function call<T extends RequestType>(msg: Extract<Request, { type: T }>): Promise<ResponseMap[T]> {
    let raw: unknown;
    try {
      raw = await transport(msg);
    } catch {
      throw new BusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
    }
    const env = Envelope.safeParse(raw);
    if (!env.success) throw new BusError("Something went wrong. Please try again.", "bus/bad-reply");
    if (!env.data.ok) throw new BusError(env.data.error.userMessage, env.data.error.code);
    return env.data.data as ResponseMap[T];
  }

  const client: WalletClient = {
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
    backupStatus: () => call({ type: "backupStatus" }),
    backupStartSignIn: (p) => call({ type: "backupStartSignIn", ...p }),
    backupCompleteSignIn: (p) => call({ type: "backupCompleteSignIn", ...p }),
    backupSignOut: () => call({ type: "backupSignOut" }),
    backupDelete: (p) => call({ type: "backupDelete", ...p }),
    passkeyBackupBegin: (p) => call({ type: "passkeyBackupBegin", ...p }),
    passkeyRestoreBegin: (p) => call({ type: "passkeyRestoreBegin", ...p }),
    markPhraseBackedUp: () => call({ type: "markPhraseBackedUp" }),
    listAccounts: () => call({ type: "listAccounts" }),
    addAccount: (p) => call({ type: "addAccount", family: p.family }),
    renameAccount: (p) => call({ type: "renameAccount", ...p }),
    getActiveAccounts: (p) => call({ type: "getActiveAccounts", ...(p?.origin ? { origin: p.origin } : {}) }),
    setActiveAccount: (p) => call({ type: "setActiveAccount", ...p }),
    lookupName: (p) => call({ type: "lookupName", ...p }),
    backupProviders: () => call({ type: "backupProviders" }),
    backupSocialSignIn: (p) => call({ type: "backupSocialSignIn", ...p }),
    onChange: (cb) => {
      const on = (m: unknown) => {
        if (m && typeof m === "object" && (m as { event?: string }).event === CHANGE_EVENT) cb();
      };
      browser.runtime.onMessage.addListener(on);
      return () => browser.runtime.onMessage.removeListener(on);
    },
  };
  if (mocks) client.devSimulateRequest = (kind) => call({ type: "devSimulateRequest", kind });
  // Clip Plugins need chrome.offscreen and manifest sandbox pages (not in Firefox): without these methods the
  // UI hides the Plugins entry (asPlugins(client) is null).
  if (withPlugins) {
    Object.assign(client, {
      pluginsStatus: () => call({ type: "pluginsStatus" }),
      pluginsSetEnabled: (p: { enabled: boolean }) => call({ type: "pluginsSetEnabled", ...p }),
      pluginsPrepareInstall: (p: { name: string }) => call({ type: "pluginsPrepareInstall", ...p }),
      pluginsConfirmInstall: (p: { id: string; version: string }) => call({ type: "pluginsConfirmInstall", ...p }),
      pluginsCancelInstall: () => call({ type: "pluginsCancelInstall" }),
      pluginsRemove: (p: { id: string }) => call({ type: "pluginsRemove", ...p }),
      pluginsSetPluginEnabled: (p: { id: string; enabled: boolean }) => call({ type: "pluginsSetPluginEnabled", ...p }),
    } satisfies PluginsClient);
  }
  return client;
}
