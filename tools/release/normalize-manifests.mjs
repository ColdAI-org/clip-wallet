#!/usr/bin/env node
/**
 * Rewrite every publishable package.json into the published shape (manifest.mjs): exports with "development"
 * source conditions, publishConfig (public, provenance, dist-only exports), files allowlist, repository,
 * peers. Idempotent. `--check` exits 1 instead of writing when a manifest is out of shape.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize, publishablePackages } from "./manifest.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const check = process.argv.includes("--check");

const reactPeer = { react: "^19.0.0", "react-dom": "^19.0.0" };

/** Descriptions, keywords and peers per package. */
export const EXTRA = {
  "@clip-wallet/core": { description: "Clip Wallet's shared contract: networks, assets, the Vault and ChainModule interfaces, DecodedRequest, ClipError" },
  "@clip-wallet/config": { description: "The typed clip.config.ts schema for Clip Wallet and kit-built wallets: identity, networks, routing, mainnet checklist" },
  "@clip-wallet/vault": { description: "The only Clip Wallet package that touches recovery phrases and private keys: derivation, encrypted storage, approval-bound signing, passkey unlock" },
  "@clip-wallet/1mask": { description: "1Mask: one wallet for every dapp. EIP-1193/6963, Wallet Standard, CIP-30, TON Connect, NEAR, Stellar, Algorand, Beacon and WalletConnect connectors" },
  "@clip-wallet/engine": { description: "Clip Wallet's environment-free orchestration: approvals, permissions, portfolio, send/receive, 1Mask and WalletConnect hosting" },
  "@clip-wallet/extension-kit": {
    description: "Build a branded Clip Wallet browser extension with WXT: background, pages, 1Mask wiring and the security floor, configured by clip.config.ts",
    peerDependencies: { wxt: "^0.21.0", "@wxt-dev/module-react": "^1.2.0", ...reactPeer },
  },
  "@clip-wallet/ui": { description: "Clip Wallet's React screens, components and theme tokens", peerDependencies: reactPeer },
  "@clip-wallet/i18n": {
    description: "Clip Wallet's translation layer: a small ICU message subset over Intl, 11 languages, optional React bindings",
    peerDependencies: { react: "^19.0.0" },
    peerDependenciesMeta: { react: { optional: true } },
  },
  "@clip-wallet/connect": {
    description: "Clip Connect: wallet-agnostic dapp SDK. One connect() for Clip Wallet and any EIP-6963, Wallet Standard or WalletConnect wallet; CAIP-10 accounts, pay() with EIP-5792 + ERC-7682 auxiliary funds, React, wagmi and Solana adapters",
    keywords: ["clip-wallet", "wallet", "web3", "eip-6963", "eip-5792", "erc-7682", "wallet-standard", "walletconnect", "wagmi", "react"],
    peerDependencies: {
      react: "^18.0.0 || ^19.0.0",
      "@wagmi/core": "^2.0.0 || ^3.0.0",
      "@solana/wallet-standard-wallet-adapter-base": "^1.1.0",
      "@walletconnect/ethereum-provider": "^2.0.0",
    },
    peerDependenciesMeta: {
      react: { optional: true },
      "@wagmi/core": { optional: true },
      "@solana/wallet-standard-wallet-adapter-base": { optional: true },
      "@walletconnect/ethereum-provider": { optional: true },
    },
  },
  "@clip-wallet/route": { description: "Route and fund on CLPRouter: shortfalls, quotes, pay-on-Hedera and settle-on-Hedera planning" },
  "@clip-wallet/security": { description: "Clip Wallet security services: phishing lists, transaction checks, approvals review, address poisoning and hidden-token cleanup" },
  "@clip-wallet/features": { description: "Clip Wallet features as background services: staking, swaps, on-ramps, prices, featured dapps" },
  "@clip-wallet/social": { description: "Clip Wallet social layer: contacts, Clip handles on Hedera, notifications and Discover" },
  "@clip-wallet/plugins": { description: "Clip Plugins: small, SES-sandboxed wallet extensions installed from npm with integrity checks" },
  "@clip-wallet/hardware": { description: "Hardware wallet accounts for Clip Wallet: Ledger (WebHID) and Keystone (QR); every signature is checked against what was approved" },
  "@clip-wallet/names": { description: "Name resolution for Clip Wallet: ENS, SNS, HNS and Clip handles to an address and the network it implies" },
  "@clip-wallet/backup-client": { description: "Client for the Clip Wallet passkey backup service; moves opaque encrypted blobs, never keys" },
  "@clip-wallet/link": { description: "Linked devices for Clip Wallet: phone or desktop as signer, end-to-end encrypted settings sync, handoffs and native messaging" },
  "@clip-wallet/media-client": { description: "Decides what an untrusted NFT media URL may become; shared by the wallet UI and the media proxy" },
  "@clip-wallet/kit-modules": { description: "Clip Wallet modules for ecosystem wallet pickers: NEAR Wallet Selector, Stellar Wallets Kit, Beacon, use-wallet" },
  "create-clip-wallet": {
    description: "Scaffold your own wallet on the Clip Wallet kit: its own name, icon, extension id and rdns, testnet by default",
    keywords: ["clip-wallet", "wallet", "scaffold-hbar", "hedera", "create", "template", "browser-extension"],
  },
};
const FAMILY = {
  evm: "EVM",
  hedera: "Hedera",
  solana: "Solana",
  bitcoin: "Bitcoin",
  sui: "Sui",
  aptos: "Aptos",
  cardano: "Cardano",
  substrate: "Polkadot SDK (Substrate)",
  starknet: "Starknet",
  ton: "TON",
  near: "NEAR",
  stellar: "Stellar",
  tezos: "Tezos",
  algorand: "Algorand",
};
for (const [f, label] of Object.entries(FAMILY)) {
  EXTRA[`@clip-wallet/chains-${f}`] = {
    description: `${label} ChainModule for Clip Wallet: builds and decodes transactions in plain words; never touches keys`,
    keywords: ["clip-wallet", "wallet", f, "chain-module"],
  };
}

let bad = 0;
for (const { dir, path, pkg } of publishablePackages(root)) {
  const next = normalize(pkg, dir, EXTRA[pkg.name] ?? {});
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const current = readFileSync(join(path, "package.json"), "utf8");
  const license = join(path, "LICENSE");
  if (text !== current || !existsSync(license)) {
    if (check) {
      process.stderr.write(`${dir}/package.json is not in the published shape: run node tools/release/normalize-manifests.mjs\n`);
      bad++;
    } else {
      writeFileSync(join(path, "package.json"), text);
      copyFileSync(join(root, "LICENSE"), license);
      process.stdout.write(`normalized ${dir}\n`);
    }
  }
}
process.exit(bad ? 1 : 0);
