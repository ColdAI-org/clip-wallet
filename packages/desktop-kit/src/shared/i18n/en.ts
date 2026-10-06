/**
 * The desktop app's own English strings (ids "d.<area>.<name>"): the browser toolbar, site prompts, menus and
 * native dialogs. Wallet screens come from @clip-wallet/ui's catalog, unchanged.
 *
 * Adding a string: add it here, use it via t(), and add it to every locale file (typecheck fails until each has
 * it; test/i18n.test.ts runs @clip-wallet/i18n's structural checks). Never translate the product name ({name}),
 * site names ({site}) or file names ({file}).
 */
export const en = {
  // browser toolbar
  "d.browser.newTab": "New tab",
  "d.browser.closeTab": "Close tab",
  "d.browser.back": "Back",
  "d.browser.forward": "Forward",
  "d.browser.reload": "Reload",
  "d.browser.stop": "Stop",
  "d.browser.address": "Site address",
  "d.browser.placeholder": "Type a site address",
  "d.browser.secure": "Secure connection",
  "d.browser.notSecure": "Not secure",
  "d.browser.connected": "Connected to your wallet",
  "d.browser.bookmark": "Bookmark this site",
  "d.browser.unbookmark": "Remove bookmark",
  "d.browser.openWallet": "Open wallet",
  "d.browser.badUrl": "That isn't a site address. Type one like app.example.com.",
  "d.browser.untitled": "New tab",
  // start page
  "d.start.title": "Where to?",
  "d.start.bookmarks": "Bookmarks",
  "d.start.noBookmarks": "No bookmarks yet. Use the star in the address bar to keep a site here.",
  "d.start.featured": "Featured apps",
  "d.start.remove": "Remove {site}",
  // site prompts
  "d.perm.title": "{site} wants to use your {permission}",
  "d.perm.body": "Sites can't use this without asking. Only allow sites you trust.",
  "d.perm.camera": "camera",
  "d.perm.microphone": "microphone",
  "d.perm.notifications": "notifications",
  "d.perm.clipboard": "clipboard",
  "d.perm.location": "location",
  "d.perm.other": "device features",
  "d.perm.allow": "Allow",
  "d.perm.deny": "Don't allow",
  "d.download.title": "Download {file}?",
  "d.download.body": "{site} wants to save a file ({size}) to your computer. Only download files you expect.",
  "d.download.save": "Save…",
  "d.download.cancel": "Cancel",
  "d.download.unknownSize": "size unknown",
  "d.phish.title": "This site is on a scam list",
  "d.phish.body": "{site} is reported for stealing crypto, so it wasn't opened.",
  "d.phish.leave": "Take me back",
  "d.phish.proceed": "Open anyway (not safe)",
  // menus, tray and native dialogs (main process)
  "d.menu.wallet": "Wallet",
  "d.menu.browser": "Browser",
  "d.menu.newTab": "New Tab",
  "d.menu.lock": "Lock Wallet",
  "d.menu.quit": "Quit {name}",
  "d.menu.window": "Window",
  "d.menu.edit": "Edit",
  "d.menu.view": "View",
  "d.tray.open": "Open {name}",
  "d.hid.title": "Choose your Ledger",
  "d.hid.body": "Pick the Ledger to use with {name}. Only Ledger devices are listed.",
  "d.hid.none": "No Ledger found. Plug it in, unlock it and open the app, then try again.",
  "d.common.cancel": "Cancel",
  "d.bio.enroll": "turn on Touch ID for {name}",
  "d.bio.unlock": "unlock {name}",
  "d.download.saveTitle": "Save download",
} as const;

export type DesktopMessages = { [K in keyof typeof en]: string };
export type DesktopMessageId = keyof typeof en;
