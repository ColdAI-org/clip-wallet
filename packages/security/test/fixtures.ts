import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Route } from "./helpers.js";

const read = (f: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url)), "utf8");

/** Excerpts in each list's real format (domains replaced with .example ones). */
export const LIST_BODIES = {
  metamask: read("metamask-config.json"),
  scamsniffer: read("scamsniffer-domains.json"),
  "scamsniffer-addresses": read("scamsniffer-address.json"),
  phantom: read("phantom-blocklist.yaml"),
  polkadot: read("polkadot-all.json"),
  "polkadot-addresses": read("polkadot-address.json"),
};

export const LIST_ROUTES: Route[] = [
  [/eth-phishing-detect\/main\/src\/config\.json$/, LIST_BODIES.metamask],
  [/scam-database\/main\/blacklist\/domains\.json$/, LIST_BODIES.scamsniffer],
  [/scam-database\/main\/blacklist\/address\.json$/, LIST_BODIES["scamsniffer-addresses"]],
  [/phantom\/blocklist\/master\/blocklist\.yaml$/, LIST_BODIES.phantom],
  [/polkadot-js\/phishing\/master\/all\.json$/, LIST_BODIES.polkadot],
  [/polkadot-js\/phishing\/master\/address\.json$/, LIST_BODIES["polkadot-addresses"]],
];
