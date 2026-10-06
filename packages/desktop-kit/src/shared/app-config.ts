/**
 * Build-time settings shared by the main process and the renderers. Public identifiers only, never secrets.
 * The wallet's validated clip.config comes from `virtual:clip-wallet/config`, which clipDesktop()
 * ("@clip-wallet/desktop-kit/electron-vite") resolves to the project's clip.config.ts, with the WalletConnect project
 * id from the build environment applied, plus the icon as a data URI (tests alias the module).
 */
import { platformIds, walletKey, type ClipConfig } from "@clip-wallet/config";
// @ts-ignore: a virtual module, resolved by the host bundler (electron-vite.ts) or the test runner.
import raw, { icon as rawIcon } from "virtual:clip-wallet/config";

const clipConfig: ClipConfig = raw;
const icon: string = rawIcon;
const ids = platformIds(clipConfig);
const wcProjectId = clipConfig.walletConnect.projectId || undefined;
const site = clipConfig.homepage ?? `https://${walletKey(clipConfig)}.example`;

export const DESKTOP = {
  config: clipConfig,
  wcProjectId,
  /** WalletConnect metadata: the wallet's homepage, or a placeholder until it has one. */
  siteUrl: site,
  iconUrl: `${site}/icon.png`,
  /** EIP-6963 / Wallet Standard identity (icon must be a data URI). */
  identity: { name: clipConfig.name, rdns: clipConfig.rdns, icon },
  /** Deep links: <scheme>://wc?uri=…, <scheme>://browse?url=…, <scheme>://trade#offer=… */
  scheme: ids.scheme,
  /** Secure Trade share links open the app. */
  tradeLinkBase: `${ids.scheme}://trade`,
  /** Bundle / app id (electron-builder appId, Windows AppUserModelID). */
  appId: ids.desktop.appId,
  /** TON Connect JS bridge key and app name (must match the wallets-list entry). */
  walletKey: walletKey(clipConfig),
} as const;
