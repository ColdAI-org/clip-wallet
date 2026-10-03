// prepack: ship the monorepo's harness inside the package so generated wallets get `pnpm harness`.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(pkg, "harness"), { recursive: true });
copyFileSync(join(pkg, "..", "..", "tools", "harness", "check.mjs"), join(pkg, "harness", "check.mjs"));
