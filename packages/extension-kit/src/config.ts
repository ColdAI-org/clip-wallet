/**
 * The wallet's validated clip.config.ts. The host build supplies it: `clipWallet()` from
 * "@clip-wallet/extension-kit/wxt" resolves the virtual module to the project's clip.config.ts (tests alias it).
 */
import type { ClipConfig } from "@clip-wallet/config";
// @ts-ignore: a virtual module, resolved by the host bundler (see wxt.ts) or the test runner.
import raw from "virtual:clip-wallet/config";

const config: ClipConfig = raw;
export default config;
