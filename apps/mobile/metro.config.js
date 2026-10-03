// Metro for a pnpm monorepo. Expo's default config already watches the workspace root and follows pnpm's
// symlinks; the only addition is TypeScript's ".js → .ts" import convention used by the workspace packages
// (e.g. `import "./bytes.js"` inside packages/vault/src).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
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
