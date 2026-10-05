/**
 * Typed message bus between extension pages (popup, tab, approval window) and the background service
 * worker. Every request is zod-validated in the background before it reaches the service; every reply
 * is an envelope validated in the page. Content scripts (1Mask) use their own port and can never send
 * these messages (the background checks the sender is an extension page).
 */
import { z } from "zod";
import { LOCALE_CODES } from "@clip-wallet/i18n";
import { FAMILIES, type Nft } from "@clip-wallet/core";
import { FEATURE_REQUESTS, type FeatureResponseMap } from "@clip-wallet/features/messages";
import { SOCIAL_REQUESTS, type SocialResponseMap } from "@clip-wallet/social/messages";
import { SECURITY_REQUESTS, type SecurityResponseMap } from "@clip-wallet/security/messages";
import { PluginsRequestSchema, type PendingInstallView, type PluginView, type PluginsStatusView } from "@clip-wallet/plugins";
import type {
  AccountView,
  ActiveAccounts,
  ActivityEntry,
  BackupStatusView,
  HardwareAccountView,
  ApprovalView,
  PasskeyCeremony,
  PortfolioView,
  Prefs,
  ReceiveTarget,
  RecipientResolution,
  SessionView,
  WalletState,
} from "@clip-wallet/ui";
import type { HardwareSignJob } from "./hardware-job";

const password = z.string().min(1).max(1024);
const id = z.string().min(1).max(200);
const b64url = z.string().regex(/^[A-Za-z0-9_-]*$/).max(4096);
const family = z.enum(FAMILIES as [string, ...string[]]);
const origin = z.string().url().max(500);
const backupId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

export const PrefsPatch = z
  .object({
    advanced: z.boolean(),
    autoLockMinutes: z.number().int().min(1).max(60),
    displayCurrency: z.string().regex(/^[A-Z]{3}$/),
    theme: z.enum(["system", "light", "dark"]),
    pinned: z.array(z.string().max(100)).max(200),
    hideSmallBalances: z.boolean(),
    showSpam: z.boolean(),
    rpcOverrides: z.record(z.string().max(200), z.string().url().startsWith("https://").max(500)),
    locale: z.enum(["system", ...LOCALE_CODES]),
  })
  .partial()
  .strict();

const hwFamily = z.enum(["evm", "solana", "bitcoin", "hedera"]);
const pathStyle = z.enum(["standard", "ledger-live", "ledger-legacy"]);
const hwId = z.string().regex(/^hw:(ledger|keystone):[0-9a-f]{8}:[a-z]+:\d{1,10}(:ledger-live|:ledger-legacy)?$/);
const hex = (max: number) => z.string().regex(/^[0-9a-f]*$/).max(max);
const bip32Path = z.string().regex(/^m(\/\d{1,10}'?)*$/).max(120);
const smallInt = z.number().int().min(0).max(0x7fffffff);
/**
 * A hardware account as the page that ran the device found it (public data). The background's keyring also
 * checks the record against its id before storing it.
 */
const hwAccount = z
  .object({
    id: hwId,
    family: hwFamily,
    index: smallInt,
    curve: z.enum(["secp256k1", "ed25519"]),
    derivationPath: bip32Path,
    publicKey: hex(130),
    address: z.string().min(1).max(120),
    label: z.string().max(60).optional(),
    hederaAccountId: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    hardware: z
      .object({
        kind: z.enum(["ledger", "keystone"]),
        fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
        path: bip32Path,
        pathStyle,
        accountXpub: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{100,120}$/).optional(),
        accountPath: bip32Path.optional(),
        change: smallInt.optional(),
        addressIndex: smallInt.optional(),
        keyIndex: smallInt.optional(),
        deviceName: z.string().max(60).optional(),
      })
      .strict(),
  })
  .strict();
/** A device signature coming back from the approval window. The background verifies it before use. */
const signatureWire = z
  .object({ scheme: z.enum(["ecdsa-secp256k1", "ed25519"]), bytes: hex(128), recovery: z.number().int().min(0).max(3).optional(), publicKey: hex(130) })
  .strict();
const jobId = z.string().uuid();

export const Request = z.discriminatedUnion("type", [
  z.object({ type: z.literal("getState") }),
  z.object({ type: z.literal("setPrefs"), patch: PrefsPatch }),
  z.object({ type: z.literal("createWallet"), password }),
  z.object({ type: z.literal("revealPhrase"), password }),
  z.object({ type: z.literal("importWallet"), phrase: z.string().min(1).max(1000), password }),
  z.object({ type: z.literal("unlock"), password }),
  z.object({ type: z.literal("lock") }),
  z.object({
    type: z.literal("passkeyBegin"),
    begin: z.discriminatedUnion("op", [z.object({ op: z.literal("enroll"), password }), z.object({ op: z.literal("unlock") })]),
  }),
  z.object({
    type: z.literal("passkeyFinish"),
    result: z.union([
      z.object({ id, credentialId: b64url.min(1), prfOutput: b64url.min(43) }).strict(),
      z.object({ id, error: z.string().max(100) }).strict(),
    ]),
  }),
  z.object({ type: z.literal("passkeyRemove") }),
  z.object({ type: z.literal("getPortfolio"), refresh: z.boolean().optional() }),
  z.object({ type: z.literal("getCollectibles") }),
  z.object({ type: z.literal("getActivity") }),
  z.object({ type: z.literal("resolveRecipient"), input: z.string().min(1).max(200), assetKey: z.string().min(1).max(100) }),
  z.object({ type: z.literal("rememberRecipientNetwork"), address: z.string().min(1).max(200), assetKey: z.string().max(100), networkId: id }),
  z.object({
    type: z.literal("send"),
    assetKey: z.string().min(1).max(100),
    networkId: id,
    to: z.string().min(1).max(200),
    amount: z.string().regex(/^\d+(\.\d+)?$/).max(80),
  }),
  z.object({ type: z.literal("getReceiveTargets"), assetKey: z.string().min(1).max(100) }),
  z.object({ type: z.literal("listApprovals") }),
  z.object({ type: z.literal("getApproval"), id }),
  z.object({ type: z.literal("approve"), id, allowBlind: z.boolean().optional() }),
  z.object({ type: z.literal("reject"), id }),
  z.object({ type: z.literal("listSessions") }),
  z.object({ type: z.literal("disconnect"), id }),
  z.object({ type: z.literal("pairWalletConnect"), uri: z.string().startsWith("wc:").max(1000) }),
  z.object({ type: z.literal("openFullTab"), route: z.string().max(200).optional() }),
  z.object({ type: z.literal("devSimulateRequest"), kind: z.enum(["pay", "connect", "blind", "approval-for-all", "settle", "settle-late"]) }),
  ...FEATURE_REQUESTS,
  ...SOCIAL_REQUESTS,
  ...SECURITY_REQUESTS,
  // Clip Plugins (Advanced mode; @clip-wallet/plugins validates again in PluginsService)
  ...PluginsRequestSchema.options,
  // Google / Apple sign-in for passkey backups (engine/social-signin)
  z.object({ type: z.literal("backupProviders") }),
  z.object({ type: z.literal("backupSocialSignIn"), provider: z.enum(["google", "apple"]) }),
  // hardware wallets (Ledger, Keystone)
  // Device I/O (Ledger WebHID, Keystone QR) runs in the pages; the background stores accounts and verifies signatures.
  z.object({ type: z.literal("hwAddAccounts"), accounts: z.array(hwAccount).min(1).max(50) }),
  z.object({ type: z.literal("hwListAccounts") }),
  z.object({ type: z.literal("hwRenameAccount"), id: hwId, label: z.string().max(60) }),
  z.object({ type: z.literal("hwForgetDevice"), kind: z.enum(["ledger", "keystone"]), fingerprint: z.string().regex(/^[0-9a-f]{8}$/) }),
  z.object({ type: z.literal("hwSetActive"), family: hwFamily, accountId: hwId.nullable() }),
  z.object({ type: z.literal("hwCancel"), id }),
  z.object({ type: z.literal("hwSignJobs") }),
  z.object({ type: z.literal("hwSignResult"), id, jobId, signature: signatureWire }),
  z.object({ type: z.literal("hwSignFailed"), id, jobId, code: z.string().regex(/^hw\/[a-z0-9-]{1,40}$/), message: z.string().min(1).max(300) }),
  // platform: passkey backup, phrase backup flag, multiple accounts, names
  z.object({ type: z.literal("backupStatus") }),
  z.object({ type: z.literal("backupStartSignIn"), email: z.string().min(3).max(254) }),
  z.object({ type: z.literal("backupCompleteSignIn"), link: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("backupSignOut") }),
  z.object({ type: z.literal("backupDelete"), id: backupId }),
  z.object({ type: z.literal("passkeyBackupBegin"), password }),
  z.object({ type: z.literal("passkeyRestoreBegin"), backupId, password }),
  z.object({ type: z.literal("markPhraseBackedUp") }),
  z.object({ type: z.literal("listAccounts") }),
  z.object({ type: z.literal("addAccount"), family }),
  z.object({ type: z.literal("renameAccount"), id, label: z.string().min(1).max(64) }),
  z.object({ type: z.literal("getActiveAccounts"), origin: origin.optional() }),
  z.object({ type: z.literal("setActiveAccount"), family, accountId: id.nullable(), origin: origin.optional() }),
  z.object({ type: z.literal("lookupName"), address: z.string().min(1).max(200), family, networkId: id.optional() }),
]);

export type Request = z.infer<typeof Request>;
export type RequestType = Request["type"];

/** What each request returns. Kept beside the schema so client and service can't drift. */
export interface ResponseMap extends FeatureResponseMap, SocialResponseMap, SecurityResponseMap {
  pluginsStatus: PluginsStatusView;
  pluginsSetEnabled: void;
  pluginsPrepareInstall: PendingInstallView;
  pluginsConfirmInstall: PluginView;
  pluginsCancelInstall: void;
  pluginsRemove: void;
  pluginsSetPluginEnabled: void;
  backupProviders: { email: boolean; google: boolean; apple: boolean };
  backupSocialSignIn: void;
  getState: WalletState;
  setPrefs: Prefs;
  createWallet: void;
  revealPhrase: string;
  importWallet: void;
  unlock: void;
  lock: void;
  passkeyBegin: PasskeyCeremony;
  passkeyFinish: void;
  passkeyRemove: void;
  getPortfolio: PortfolioView;
  getCollectibles: Nft[];
  getActivity: ActivityEntry[];
  resolveRecipient: RecipientResolution;
  rememberRecipientNetwork: void;
  send: string;
  getReceiveTargets: ReceiveTarget[];
  listApprovals: ApprovalView[];
  getApproval: ApprovalView | null;
  approve: void;
  reject: void;
  listSessions: SessionView[];
  disconnect: void;
  pairWalletConnect: void;
  openFullTab: void;
  devSimulateRequest: string;
  backupStatus: BackupStatusView;
  backupStartSignIn: void;
  backupCompleteSignIn: void;
  backupSignOut: void;
  backupDelete: void;
  passkeyBackupBegin: PasskeyCeremony;
  passkeyRestoreBegin: PasskeyCeremony;
  markPhraseBackedUp: void;
  listAccounts: AccountView[];
  addAccount: AccountView;
  renameAccount: void;
  getActiveAccounts: ActiveAccounts;
  setActiveAccount: void;
  lookupName: string | null;
  hwAddAccounts: void;
  hwListAccounts: HardwareAccountView[];
  hwRenameAccount: void;
  hwForgetDevice: void;
  hwSetActive: void;
  hwCancel: void;
  hwSignJobs: HardwareSignJob[];
  hwSignResult: void;
  hwSignFailed: void;
}

export const Envelope = z.union([
  // `data` is absent for void replies (JSON drops undefined).
  z.object({ ok: z.literal(true), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: z.object({ userMessage: z.string(), code: z.string() }) }),
]);
export type Envelope = z.infer<typeof Envelope>;

/** Broadcast from background to pages; carries no data, pages re-fetch. */
export const CHANGE_EVENT = "clip:changed";
