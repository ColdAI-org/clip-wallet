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
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+CiAgPHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIHJ4PSIzMCIgZmlsbD0iI0ZGM0MwMCIvPgogIDxwYXRoIGQ9Ik04NCA0NGEyOCAyOCAwIDEgMCAwIDQwIiBmaWxsPSJub25lIiBzdHJva2U9IiNGRkZGRkYiIHN0cm9rZS13aWR0aD0iMTQiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgogIDxjaXJjbGUgY3g9Ijg4IiBjeT0iNjQiIHI9IjgiIGZpbGw9IiNGRkZGRkYiLz4KPC9zdmc+Cg==",
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
