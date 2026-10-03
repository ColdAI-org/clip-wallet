/**
 * Typed message bus between extension pages (popup, tab, approval window) and the background service
 * worker. Every request is zod-validated in the background before it reaches the service; every reply
 * is an envelope validated in the page. Content scripts (1Mask) use their own port and can never send
 * these messages (the background checks the sender is an extension page).
 */
import { z } from "zod";
import { FAMILIES, type Nft } from "@clip-wallet/core";
import { FEATURE_REQUESTS, type FeatureResponseMap } from "@clip-wallet/features/messages";
import type {
  AccountView,
  ActiveAccounts,
  ActivityEntry,
  BackupStatusView,
  HardwareAccountView,
  HardwareFamilyView,
  ApprovalView,
  PasskeyCeremony,
  PortfolioView,
  Prefs,
  ReceiveTarget,
  RecipientResolution,
  SessionView,
  WalletState,
} from "@clip-wallet/ui";

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
  })
  .partial()
  .strict();

const hwFamily = z.enum(["evm", "solana", "bitcoin", "hedera"]);
const pathStyle = z.enum(["standard", "ledger-live", "ledger-legacy"]);
const urJson = z.object({ type: z.string().regex(/^[a-z0-9-]{1,40}$/), cborHex: z.string().regex(/^[0-9a-f]*$/).max(200_000) }).strict();
const hwId = z.string().regex(/^hw:(ledger|keystone):[0-9a-f]{8}:[a-z]+:\d{1,10}(:ledger-live|:ledger-legacy)?$/);

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
  z.object({ type: z.literal("devSimulateRequest"), kind: z.enum(["pay", "connect", "blind", "approval-for-all"]) }),
  ...FEATURE_REQUESTS,
  // hardware wallets (Ledger, Keystone)
  z.object({ type: z.literal("hwLedgerAccounts"), family: hwFamily, start: z.number().int().min(0).max(1000), count: z.number().int().min(1).max(20), pathStyle: pathStyle.optional() }),
  z.object({ type: z.literal("hwKeystoneImport"), ur: urJson }),
  z.object({ type: z.literal("hwKeystoneAccounts"), family: hwFamily, start: z.number().int().min(0).max(1000), count: z.number().int().min(1).max(20), pathStyle: pathStyle.optional() }),
  z.object({ type: z.literal("hwAddAccounts"), ids: z.array(hwId).min(1).max(50) }),
  z.object({ type: z.literal("hwListAccounts") }),
  z.object({ type: z.literal("hwRenameAccount"), id: hwId, label: z.string().max(60) }),
  z.object({ type: z.literal("hwForgetDevice"), kind: z.enum(["ledger", "keystone"]), fingerprint: z.string().regex(/^[0-9a-f]{8}$/) }),
  z.object({ type: z.literal("hwSetActive"), family: hwFamily, accountId: hwId.nullable() }),
  z.object({ type: z.literal("hwKeystoneAnswer"), id, ur: urJson }),
  z.object({ type: z.literal("hwCancel"), id }),
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
export interface ResponseMap extends FeatureResponseMap {
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
  hwLedgerAccounts: HardwareAccountView[];
  hwKeystoneImport: { fingerprint: string; families: HardwareFamilyView[] };
  hwKeystoneAccounts: HardwareAccountView[];
  hwAddAccounts: void;
  hwListAccounts: HardwareAccountView[];
  hwRenameAccount: void;
  hwForgetDevice: void;
  hwSetActive: void;
  hwKeystoneAnswer: void;
  hwCancel: void;
}

export const Envelope = z.union([
  // `data` is absent for void replies (JSON drops undefined).
  z.object({ ok: z.literal(true), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: z.object({ userMessage: z.string(), code: z.string() }) }),
]);
export type Envelope = z.infer<typeof Envelope>;

/** Broadcast from background to pages; carries no data, pages re-fetch. */
export const CHANGE_EVENT = "clip:changed";
