/**
 * Build-time settings shared by the main process and the renderers. Public identifiers only, never secrets.
 * `__CLIP_WC_PROJECT_ID__` is replaced at build time from CLIP_WC_PROJECT_ID (electron.vite.config.ts); unset
 * means WalletConnect is switched off and the UI says so.
 */
import clipConfig from "../../clip.config";

declare const __CLIP_WC_PROJECT_ID__: string | undefined;
const wcProjectId = (typeof __CLIP_WC_PROJECT_ID__ !== "undefined" && __CLIP_WC_PROJECT_ID__) || undefined;

export const DESKTOP = {
  config: { ...clipConfig, walletConnect: { ...clipConfig.walletConnect, projectId: wcProjectId } },
  wcProjectId,
  /** Placeholder metadata URL shown to WalletConnect peers until the app has a site. */
  siteUrl: "https://clipwallet.example",
  iconUrl: "https://clipwallet.example/icon.png",
  /** EIP-6963 / Wallet Standard identity (icon must be a data URI). */
  identity: {
    name: clipConfig.name,
    rdns: clipConfig.rdns,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTI4IDEyOCI+CiAgPHRpdGxlPkNsaXAgV2FsbGV0PC90aXRsZT4KICA8cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjMwIiBmaWxsPSIjRkYzQzAwIi8+CiAgPGcgZmlsbD0iI0ZGRkZGRiIgc3Ryb2tlPSIjRkZGRkZGIiBzdHJva2Utd2lkdGg9IjQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIHRyYW5zZm9ybT0idHJhbnNsYXRlKDY0IDY0KSBza2V3WCgtNikgdHJhbnNsYXRlKC02NCAtNjQpIj48cGF0aCBkPSJNNzIgMThDNDYgMzAgMzIgNTAgMzIgNzJjMCA3IDEgMTIgMyAxNmgzN3oiLz48cGF0aCBkPSJNODQgNDBjMTAgMTIgMTQgMjYgMTMgNDAtNCA0LTkgNy0xMyA4eiIvPjxwYXRoIGQ9Ik0yNCA5OWg4MmMtNiA3LTE1IDExLTI2IDExSDQ4Yy0xMSAwLTE5LTQtMjQtMTF6Ii8+PC9nPgo8L3N2Zz4K",
  },
  /** Deep links: clipwallet://wc?uri=…, clipwallet://browse?url=…, clipwallet://trade#offer=… */
  scheme: "clipwallet",
  /** Secure Trade share links open the app. */
  tradeLinkBase: "clipwallet://trade",
  /** Bundle / app id (electron-builder appId, Windows AppUserModelID). */
  appId: "org.coldai.clipwallet.desktop",
} as const;
