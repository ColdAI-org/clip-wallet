// src/entrypoints/background.ts
import { defineBackground } from "wxt/utils/define-background";
import { startBackground } from "@clip-wallet/extension-kit/background";

export default defineBackground({
  type: { firefox: "module" }, // Firefox: an ES-module event page; Chrome keeps one service-worker script
  main() {
    startBackground();
  },
});
