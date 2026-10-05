/**
 * Build-time settings. EXPO_PUBLIC_* values are inlined by Expo's bundler at build time; they are public
 * identifiers, never secrets. Nothing here is logged.
 */
import clipConfig from "../clip.config";

const wcProjectId = process.env.EXPO_PUBLIC_WC_PROJECT_ID?.trim() || undefined;
const passkeyRpId = process.env.EXPO_PUBLIC_PASSKEY_RP_ID?.trim() || undefined;

export const APP = {
  config: { ...clipConfig, walletConnect: { ...clipConfig.walletConnect, projectId: wcProjectId } },
  /** Reown project id; WalletConnect is switched off (and the UI says so) without it. */
  wcProjectId,
  /** WebAuthn relying party for real passkeys (needs webcredentials association). */
  passkeyRpId,
  /** Placeholder metadata URL shown to WalletConnect peers until the app has a site. */
  siteUrl: "https://clipwallet.example",
  iconUrl: "https://clipwallet.example/icon.png",
  /** EIP-6963 / Wallet Standard identity (icon must be a data URI). */
  identity: {
    name: clipConfig.name,
    rdns: clipConfig.rdns,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+CiAgPHRpdGxlPkNsaXAgV2FsbGV0PC90aXRsZT4KICA8cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjMwIiBmaWxsPSIjRkYzQzAwIi8+CiAgPGcgZmlsbD0iI0ZGRkZGRiIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDY0IDY0KSBza2V3WCgtNikgdHJhbnNsYXRlKC02NCAtNjQpIj48cGF0aCBkPSJNNzIgMThDNDYgMzAgMzIgNTAgMzIgNzJjMCA3IDEgMTIgMyAxNmgzN3oiLz48cGF0aCBkPSJNODQgNDBjMTAgMTIgMTQgMjYgMTMgNDAtNCA0LTkgNy0xMyA4eiIvPjxwYXRoIGQ9Ik0yNCA5OWg4MmMtNiA3LTE1IDExLTI2IDExSDQ4Yy0xMSAwLTE5LTQtMjQtMTF6Ii8+PC9nPgo8L3N2Zz4K",
  },
  /** Deep links: clipwallet://wc?uri=…, clipwallet://browse?url=… ; universal links once a domain is associated. */
  scheme: "clipwallet",
  /** Secure Trade share links: https://<associated domain>/trade#offer=… (universal link) or clipwallet://trade#offer=…. */
  tradeLinkBase: process.env.CLIP_ASSOCIATED_DOMAIN ? `https://${process.env.CLIP_ASSOCIATED_DOMAIN}/trade` : "clipwallet://trade",
  /**
   * Google / Apple sign-in for passkey backups returns here (an https universal link on the associated domain,
   * listed in the backup service's OIDC_RETURN_URLS). Unset = the buttons stay hidden; email sign-in still works.
   */
  backupReturnUrl: process.env.CLIP_ASSOCIATED_DOMAIN ? `https://${process.env.CLIP_ASSOCIATED_DOMAIN}/backup` : undefined,
} as const;
