/**
 * WalletClient, FeaturesClient, SocialClient, SecurityClient and the hardware client over the desktop IPC bridge:
 * the same contracts the extension's pages use over chrome.runtime messages, so packages/ui runs unchanged.
 */
import {
  createLinkClient,
  createSocialClient,
  PasskeyError,
  b64urlDecode,
  b64urlEncode,
  type FeaturesClient,
  type BrowserConnectorView,
  type FullHardwareClient,
  type LinkClient,
  type PasskeyFactory,
  type SecurityClient,
  type SocialClient,
  type WalletClient,
} from "@clip-wallet/ui";
import type { DesktopInfo } from "../../shared/ipc";
import { BridgeError, callWallet, desktop, unwrap } from "./bridge";

type Msg = { type: string } & Record<string, unknown>;
const call = <T>(msg: Msg) => callWallet<T>(msg);

export function createWalletClient(): WalletClient {
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
    getPortfolio: (o) => call({ type: "getPortfolio", ...(o?.refresh !== undefined ? { refresh: o.refresh } : {}) }),
    getCollectibles: () => call({ type: "getCollectibles" }),
    getActivity: () => call({ type: "getActivity" }),
    resolveRecipient: (p) => call({ type: "resolveRecipient", ...p }),
    rememberRecipientNetwork: (p) => call({ type: "rememberRecipientNetwork", ...p }),
    send: (p) => call({ type: "send", ...p }),
    getReceiveTargets: (p) => call({ type: "getReceiveTargets", ...p }),
    listApprovals: () => call({ type: "listApprovals" }),
    getApproval: (id) => call({ type: "getApproval", id }),
    approve: (id, o) => call({ type: "approve", id, ...(o?.allowBlind !== undefined ? { allowBlind: o.allowBlind } : {}) }),
    reject: (id) => call({ type: "reject", id }),
    listSessions: () => call({ type: "listSessions" }),
    disconnect: (id) => call({ type: "disconnect", id }),
    pairWalletConnect: (uri) => call({ type: "pairWalletConnect", uri }),
    openFullTab: (route) => call({ type: "openFullTab", ...(route ? { route } : {}) }),
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
    onChange: (cb) => desktop().onChange(cb),
  };
}

/** Explore's apps and on-ramp pages open in the built-in browser (https only). */
async function openInBrowser(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new BridgeError("That link can't be opened.", "features/bad-url");
  unwrap(await desktop().desktop({ op: "openBrowser", url: u.toString() }));
}

export function createFeaturesClient(): FeaturesClient {
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
    openExternal: openInBrowser,
  };
}

export function createSocialBridgeClient(): SocialClient {
  // Desktop notifications need no permission prompt (the OS settings decide); Settings → Notifications still has
  // the on/off switch.
  return createSocialClient((msg) => callWallet(msg as Msg), { requestNotificationPermission: async () => true });
}

export function createSecurityClient(): SecurityClient {
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

/** Ledger and Keystone: the engine's hardware module in the main process (device I/O: hid-agent.ts, camera here). */
export function createHardwareClient(): FullHardwareClient {
  return {
    ledgerAccounts: (family, start, count, pathStyle) => call({ type: "hwLedgerAccounts", family, start, count, ...(pathStyle ? { pathStyle } : {}) }),
    keystoneImport: (ur) => call({ type: "hwKeystoneImport", ur }),
    keystoneAccounts: (family, start, count, pathStyle) => call({ type: "hwKeystoneAccounts", family, start, count, ...(pathStyle ? { pathStyle } : {}) }),
    addAccounts: (ids) => call({ type: "hwAddAccounts", ids }),
    listAccounts: () => call({ type: "hwListAccounts" }),
    renameAccount: (id, label) => call({ type: "hwRenameAccount", id, label }),
    forgetDevice: (kind, fingerprint) => call({ type: "hwForgetDevice", kind, fingerprint }),
    setActive: (family, accountId) => call({ type: "hwSetActive", family, accountId }),
    keystoneAnswer: (id, ur) => call({ type: "hwKeystoneAnswer", id, ur }),
    hardwareCancel: (id) => call({ type: "hwCancel", id }),
  };
}

/**
 * Linked devices (r1/connect): pairing, phone as signer, sync, handoff, plus the desktop-only browser-extension
 * connector. A continued page ("Continue on <site>") opens in the built-in browser.
 */
export function createLinkBridgeClient(): LinkClient {
  const connector = (op: "connectorStatus" | "connectorRepair" | "connectorRemove") => async () => unwrap<BrowserConnectorView>(await desktop().desktop({ op }));
  return createLinkClient((msg) => callWallet(msg as Msg), {
    openUrl: (url) => void openInBrowser(url).catch(() => undefined),
    onChange: (cb) => desktop().onChange(cb),
    browserConnector: { status: connector("connectorStatus"), repair: connector("connectorRepair"), remove: connector("connectorRemove") },
  });
}

export async function desktopInfo(): Promise<DesktopInfo | null> {
  try {
    return unwrap<DesktopInfo>(await desktop().desktop({ op: "info" }));
  } catch {
    return null;
  }
}

function asPasskeyError(e: unknown): PasskeyError {
  const code = (e as { code?: string }).code ?? "";
  const msg = (e as { userMessage?: string }).userMessage ?? "Touch ID didn't respond. Your password still works.";
  if (code === "biometric/cancelled") return new PasskeyError(msg, "cancelled", "onboarding.passkeyError.cancelled");
  if (code === "biometric/unavailable") return new PasskeyError(msg, "unsupported", "onboarding.passkeyError.unsupported");
  return new PasskeyError(msg, "failed");
}

/**
 * Touch ID in the vault's passkey slot. The main process prompts Touch ID, computes the PRF and FINISHES the
 * vault's ceremony itself (main/host/wallet.ts), so the PRF output never enters this renderer: what this returns
 * to the UI's ceremony runner is a placeholder that the main process discards (its passkeyFinish is a no-op).
 * Absent (undefined) where Touch ID isn't available: the UI then says biometric unlock isn't available here.
 */
export function touchIdFactory(available: boolean): PasskeyFactory | undefined {
  if (!available) return undefined;
  return {
    canRunHere: true,
    create: (c) => ({
      async enroll(prfInput) {
        try {
          const r = unwrap<{ credentialId: string }>(await desktop().desktop({ op: "bioEnroll", ceremonyId: c.id, prfInput: b64urlEncode(prfInput) }));
          return { credentialId: b64urlDecode(r.credentialId), prfOutput: new Uint8Array(32) };
        } catch (e) {
          throw asPasskeyError(e);
        }
      },
      async evaluate(credentialId, prfInput) {
        try {
          unwrap(await desktop().desktop({ op: "bioEvaluate", ceremonyId: c.id, credentialId: b64urlEncode(credentialId), prfInput: b64urlEncode(prfInput) }));
          return new Uint8Array(32);
        } catch (e) {
          throw asPasskeyError(e);
        }
      },
    }),
  };
}
