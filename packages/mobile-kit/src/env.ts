/**
 * Build-time settings. The wallet's validated clip.config comes from `virtual:clip-wallet/config`, which
 * withClipWallet() ("@clip-wallet/mobile-kit/metro") writes from the project's clip.config.ts with the build
 * environment applied (and the icon inlined); tests alias it. EXPO_PUBLIC_* values are inlined by Expo's bundler at
 * build time; they are public identifiers, never secrets. Nothing here is logged.
 */
import { platformIds, walletKey, type ClipConfig } from "@clip-wallet/config";
// @ts-ignore: a virtual module, resolved by the host bundler (metro.cjs) or the test runner.
import raw, { icon as rawIcon } from "virtual:clip-wallet/config";

const clipConfig: ClipConfig = raw;
const icon: string = rawIcon;
const ids = platformIds(clipConfig);
const wcProjectId = clipConfig.walletConnect.projectId || process.env.EXPO_PUBLIC_WC_PROJECT_ID?.trim() || undefined;
const passkeyRpId = process.env.EXPO_PUBLIC_PASSKEY_RP_ID?.trim() || undefined;
const site = clipConfig.homepage ?? `https://${walletKey(clipConfig)}.example`;
const domain = process.env.CLIP_ASSOCIATED_DOMAIN;

export const APP = {
  config: { ...clipConfig, walletConnect: { ...clipConfig.walletConnect, projectId: wcProjectId } },
  /** Reown project id; WalletConnect is switched off (and the UI says so) without it. */
  wcProjectId,
  /** WebAuthn relying party for real passkeys (needs webcredentials association). */
  passkeyRpId,
  /** WalletConnect metadata: the wallet's homepage, or a placeholder until it has one. */
  siteUrl: site,
  iconUrl: `${site}/icon.png`,
  /** EIP-6963 / Wallet Standard identity (icon must be a data URI). */
  identity: { name: clipConfig.name, rdns: clipConfig.rdns, icon },
  /** TON Connect JS bridge key and app name (must match the wallets-list entry). */
  walletKey: walletKey(clipConfig),
  /** Deep links: <scheme>://wc?uri=…, <scheme>://browse?url=… ; universal links once a domain is associated. */
  scheme: ids.scheme,
  /** Secure Trade share links: https://<associated domain>/trade#offer=… (universal link) or <scheme>://trade#offer=…. */
  tradeLinkBase: domain ? `https://${domain}/trade` : `${ids.scheme}://trade`,
  /**
   * Google / Apple sign-in for passkey backups returns here (an https universal link on the associated domain,
   * listed in the backup service's OIDC_RETURN_URLS). Unset = the buttons stay hidden; email sign-in still works.
   */
  backupReturnUrl: domain ? `https://${domain}/backup` : undefined,
} as const;
