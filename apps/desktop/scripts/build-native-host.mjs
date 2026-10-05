// Bundles src/native-host/main.ts (the native-messaging host program) into out/native-host/clip-native-host.cjs:
// one CommonJS file, Node built-ins only, run by the app's executable with ELECTRON_RUN_AS_NODE=1.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  entryPoints: [join(root, "src/native-host/main.ts")],
  outfile: join(root, "out/native-host/clip-native-host.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  minify: false,
  legalComments: "none",
  logLevel: "warning",
});
console.log("native host: out/native-host/clip-native-host.cjs");
