/**
 * The desktop app's three renderer pages, one call each (a wallet project's src/renderer/<page>/main.tsx):
 *   wallet    mountWallet()          the wallet window (the extension's screens from @clip-wallet/ui)
 *   approval  mountApproval()        the approval window
 *   browser   mountBrowserChrome()   the built-in browser's toolbar
 *
 * @module
 */
export { mountApproval, mountWallet } from "./shared/mount";
export { mountBrowserChrome } from "./browser/mount";
