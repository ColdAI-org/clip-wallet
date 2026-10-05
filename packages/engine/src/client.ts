/**
 * In-process WalletClient over the engine (React Native, tests). Same contract the extension's pages use
 * over the message bus, so screens written against @clip-wallet/ui's WalletClient work unchanged.
 * Requests still go through the zod schema: the UI is trusted code, but the check costs nothing and keeps
 * both hosts identical.
 */
import type { FeaturesClient, PluginsClient, SecurityClient, SocialClient, WalletClient } from "@clip-wallet/ui";
import { createSocialClient } from "@clip-wallet/ui";
import { ClipError } from "@clip-wallet/core";
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
    onChange: (cb) => opts.subscribe(cb),
  };
}

/**
 * In-process FeaturesClient (staking, swaps, buy, Secure Trade, explore) over the engine. `openExternal` is
 * the host's way to open an https page (mobile: Linking.openURL).
 */
export function createEngineFeaturesClient(engine: WalletEngine, opts: { openExternal(url: string): Promise<void> }): FeaturesClient {
  const call = <T>(msg: unknown) => engine.handleUntrusted(msg) as Promise<T>;
  return {
    stakingOverview: () => call({ type: "featStakingOverview" }),
    stakingOptions: (p) => call({ type: "featStakingOptions", ...p }),
    stake: (p) => call({ type: "featStake", ...p }),
    stakeAction: (p) => call({ type: "featStakeAction", ...p }),
    swapStatus: () => call({ type: "featSwapStatus" }),
    swapQuote: (p) => call({ type: "featSwapQuote", ...p }),
    swapExecute: (p) => call({ type: "featSwapExecute", ...p }),
    buyAssets: () => call({ type: "featBuyAssets" }),
    buyOptions: (p) => call({ type: "featBuyOptions", ...p }),
    tradeList: () => call({ type: "featTradeList" }),
    tradeCreate: (p) => call({ type: "featTradeCreate", ...p }),
    tradeReview: (p) => call({ type: "featTradeReview", ...p }),
    tradeAccept: (p) => call({ type: "featTradeAccept", ...p }),
    featured: () => call({ type: "featFeatured" }),
    lpPositions: () => call({ type: "featLpPositions" }),
    openExternal: async (url) => {
      const u = new URL(url);
      if (u.protocol !== "https:") throw new ClipError("That link can't be opened.", "features/bad-url");
      await opts.openExternal(u.toString());
    },
  };
}

/** In-process SocialClient (contacts, handles, notifications, Discover) over the engine. */
export function createEngineSocialClient(engine: WalletEngine, opts: { requestNotificationPermission?: () => Promise<boolean> } = {}): SocialClient {
  return createSocialClient((msg) => engine.handleUntrusted(msg), opts);
}

/**
 * In-process SecurityClient (Settings → Security: app permissions, spam cleanup, scam protection) over the engine's
 * security service. Same `sec*` messages as the extension's bus (docs/phase25/integration/security.md §5); revokes and
 * cleanups come back as an approval queued on the normal approval path.
 */
export function createEngineSecurityClient(engine: WalletEngine): SecurityClient {
  const call = <T>(msg: unknown) => engine.handleUntrusted(msg) as Promise<T>;
  return {
    approvalsScan: () => call({ type: "secApprovalsScan" }),
    revoke: (p) => call({ type: "secRevoke", ...p }),
    cleanupScan: () => call({ type: "secCleanupScan" }),
    cleanupPreview: (p) => call({ type: "secCleanupPreview", ...p }),
    cleanupRun: (p) => call({ type: "secCleanupRun", ...p }),
    unhide: (p) => call({ type: "secUnhide", ...p }),
    threatStatus: () => call({ type: "secThreatStatus" }),
    threatRefresh: () => call({ type: "secThreatRefresh" }),
    checkSite: (p) => call({ type: "secCheckSite", ...p }),
  };
}

/** In-process PluginsClient (Settings → Advanced → Plugins); needs `engine.attachPlugins(...)`. */
export function createEnginePluginsClient(engine: WalletEngine): PluginsClient {
  const call = <T>(msg: unknown) => engine.handleUntrusted(msg) as Promise<T>;
  return {
    pluginsStatus: () => call({ type: "pluginsStatus" }),
    pluginsSetEnabled: (p) => call({ type: "pluginsSetEnabled", ...p }),
    pluginsPrepareInstall: (p) => call({ type: "pluginsPrepareInstall", ...p }),
    pluginsConfirmInstall: (p) => call({ type: "pluginsConfirmInstall", ...p }),
    pluginsCancelInstall: () => call({ type: "pluginsCancelInstall" }),
    pluginsRemove: (p) => call({ type: "pluginsRemove", ...p }),
    pluginsSetPluginEnabled: (p) => call({ type: "pluginsSetPluginEnabled", ...p }),
  };
}
