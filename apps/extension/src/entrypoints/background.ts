import "../shared/node-globals";
import { defineBackground } from "wxt/utils/define-background";
import { startBackground } from "../background/main";

export default defineBackground({
  // Firefox: an ES-module event page so the background shares chunks with the pages. As one IIFE it is over
  // addons-linter's 5 MB parse limit (FILE_TOO_LARGE), and AMO reviewers can't read it. Chrome keeps the single
  // IIFE: its service worker forbids import(), which the chain packages use for lazy loading.
  type: { firefox: "module" },
  main() {
    startBackground();
  },
});
