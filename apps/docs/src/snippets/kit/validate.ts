import { ConfigError, defineConfig, validateConfig } from "@clip-wallet/config";

// validateConfig() never throws: it returns plain sentences, one per problem.
const result = validateConfig({ name: "Acme Wallet", rdns: "Acme", theme: { accent: "#FFFFFF" }, networks: ["evm:*", "dogecoin"] });
if (!result.ok) for (const problem of result.problems) console.log(problem);
// rdns: use a reverse domain you own, like com.example.wallet (lowercase)
// theme: the accent and its text colour are too close; pick colours with a contrast ratio of at least 3:1 …
// networks.1: use "evm:*", "evm:<chain id>", "hedera", "solana", …

// defineConfig() throws a ConfigError with the same list (the build prints it).
try {
  defineConfig({ name: "", rdns: "com.acme.wallet" });
} catch (e) {
  if (e instanceof ConfigError) console.log(e.problems); // ["name: give your wallet a name"]
}
