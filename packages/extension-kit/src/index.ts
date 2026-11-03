/**
 * @coldai/clip-wallet-extension-kit: the Clip Wallet browser extension as a library. A wallet project keeps clip.config.ts,
 * its icon, wxt.config.ts and one-line entrypoints; everything else (background, approvals, pages, 1Mask wiring,
 * security floor) comes from here, versioned and signed like the other `@coldai/clip-wallet-*` packages.
 *
 *   "@coldai/clip-wallet-extension-kit/wxt"            clipWallet({ config }): the WXT config (Node)
 *   "@coldai/clip-wallet-extension-kit/background"     startBackground()
 *   "@coldai/clip-wallet-extension-kit/content"        startContentBridge(), CONTENT_MATCHES
 *   "@coldai/clip-wallet-extension-kit/inpage"         installInpage(), CONTENT_MATCHES
 *   "@coldai/clip-wallet-extension-kit/pages"          mountWallet("popup" | "tab"), mountApprovalWindow()
 *   "@coldai/clip-wallet-extension-kit/plugin-host"    startPluginHost()
 *   "@coldai/clip-wallet-extension-kit/plugin-sandbox" (side effect: runs one Clip Plugin under SES)
 *
 * @module
 */
export { extensionIdFromDigest, passkeyBridgeUrl } from "./identity";
