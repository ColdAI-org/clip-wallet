/**
 * @clip-wallet/desktop-kit: the Clip Wallet desktop app (Electron: macOS, Windows, Linux) as a library. A wallet
 * project keeps clip.config.ts, its icons, electron.vite.config.ts, electron-builder.config.cjs and one-line
 * entrypoints; the main process (vault, engine, approvals, built-in dapp browser with 1Mask, linked devices), the
 * preloads and the pages come from here.
 *
 *   "@clip-wallet/desktop-kit/electron-vite"   clipDesktop({ config }): the electron-vite config (Node)
 *   "@clip-wallet/desktop-kit/builder"         electronBuilderConfig({ config }): the electron-builder config (Node)
 *   "@clip-wallet/desktop-kit/main"            (side effect) the main process
 *   "@clip-wallet/desktop-kit/preload/wallet"  (side effect) the wallet / approval / toolbar preload
 *   "@clip-wallet/desktop-kit/preload/dapp"    (side effect) the dapp-tab preload (1Mask)
 *   "@clip-wallet/desktop-kit/renderer"        mountWallet(), mountApproval(), mountBrowserChrome()
 *   "@clip-wallet/desktop-kit/native-host"     (side effect) the native-messaging host program
 */
export { parseDeepLink, deepLinkFromArgv, type DeepLink } from "./main/deeplink";
export { walletCsp } from "./main/app-paths";
export { stripAppTokens } from "./main/browser/browser-ua";
