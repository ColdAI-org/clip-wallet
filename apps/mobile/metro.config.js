// Metro for a pnpm monorepo. Expo's default config already watches the workspace root and follows pnpm's
// symlinks; the only addition is TypeScript's ".js → .ts" import convention used by the workspace packages
// (e.g. `import "./bytes.js"` inside packages/vault/src).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
// Workspace packages export their TypeScript source under the "development" condition (dist/ is for npm).
config.resolver.unstable_conditionNames = ["development", ...(config.resolver.unstable_conditionNames ?? ["require", "import"])];
const upstream = config.resolver.resolveRequest;

/** Native modules a dependency requires on a code path the wallet never runs (see each shim). */
const SHIMS = {
  "react-native-fast-pbkdf2": path.join(__dirname, "src/shims/no-pbkdf2.js"),
  // Node's crypto for hdkey (Keystone SDK → bc-ur-registry-eth), backed by @noble/hashes.
  crypto: path.join(__dirname, "src/shims/node-crypto.js"),
  // Node's stream for cipher-base (create-hash → bs58check → @keystonehq/bc-ur-registry): the browser build of
  // readable-stream, which is what bundlers for the web use for the same package.
  stream: require.resolve("readable-stream/readable-browser.js"),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  if (SHIMS[moduleName]) return { type: "sourceFile", filePath: SHIMS[moduleName] };
  // One React: workspace packages with React hooks (@clip-wallet/i18n/react) have their own dev copy of
  // react under pnpm; hooks from a second copy crash ("reading 'useMemo'"). Always use the app's.
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return resolve({ ...context, originModulePath: path.join(__dirname, "index.ts") }, moduleName, platform);
  }
  if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    const from = path.dirname(context.originModulePath);
    if (from.includes(`${path.sep}packages${path.sep}`) && !from.includes(`${path.sep}node_modules${path.sep}`)) {
      for (const ext of [".ts", ".tsx"]) {
        try {
          return resolve(context, moduleName.slice(0, -3) + ext, platform);
        } catch {
          /* try next */
        }
      }
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
