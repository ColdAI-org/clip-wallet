/**
 * The native-messaging host program the browser starts for the Clip Wallet extension (Chrome passes the caller's
 * origin as argv[1], Firefox the manifest path and the add-on id). It only pipes length-prefixed frames between the
 * browser's stdio and Clip Desktop's per-user socket; frames are end-to-end encrypted after pairing.
 * Bundled by scripts/build-native-host.mjs to out/native-host/clip-native-host.cjs and run with the app's own
 * executable as Node (src/main/native-hosts.ts writes the launcher).
 *
 * @module
 */
import { nativeHostMain } from "@clip-wallet/link/node";

void nativeHostMain();
