import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DefaultTheme } from "vitepress";

type Item = DefaultTheme.SidebarItem;

const guide: Item[] = [
  {
    text: "Getting started",
    items: [
      { text: "What Clip is", link: "/guide/" },
      { text: "Run it locally", link: "/guide/quickstart" },
      { text: "Repository layout", link: "/guide/repo-layout" },
      { text: "Rules that never break", link: "/guide/rules" },
      { text: "Glossary", link: "/guide/glossary" },
    ],
  },
  {
    text: "Architecture",
    items: [
      { text: "Overview", link: "/architecture/" },
      { text: "The signing flow", link: "/architecture/signing-flow" },
      { text: "Networks are invisible", link: "/architecture/networks-invisible" },
      { text: "Vault", link: "/architecture/vault" },
      { text: "Engine and hosts", link: "/architecture/engine" },
      { text: "Extension kit", link: "/architecture/extension-kit" },
      { text: "1Mask connectors", link: "/architecture/onemask" },
      { text: "Chain modules", link: "/architecture/chain-modules" },
      { text: "Route and settle", link: "/architecture/route-settle" },
      { text: "Features", link: "/architecture/features" },
      { text: "Security services", link: "/architecture/security" },
      { text: "Linked devices", link: "/architecture/link" },
      { text: "Plugins", link: "/architecture/plugins" },
      { text: "Social, names and hardware", link: "/architecture/social-names-hardware" },
      { text: "Hosted services", link: "/architecture/services" },
    ],
  },
];

const dapps: Item[] = [
  {
    text: "For dapp developers",
    items: [
      { text: "Clip works with your dapp", link: "/dapps/" },
      { text: "Troubleshooting", link: "/dapps/troubleshooting" },
    ],
  },
  {
    text: "EVM",
    items: [
      { text: "EIP-1193 and EIP-6963", link: "/dapps/evm" },
      { text: "wagmi and RainbowKit", link: "/dapps/wagmi-rainbowkit" },
      { text: "Reown AppKit", link: "/dapps/appkit" },
      { text: "Hedera", link: "/dapps/hedera" },
    ],
  },
  {
    text: "Wallet Standard",
    items: [
      { text: "Solana", link: "/dapps/solana" },
      { text: "Sui", link: "/dapps/sui" },
      { text: "Aptos", link: "/dapps/aptos" },
      { text: "Bitcoin", link: "/dapps/bitcoin" },
    ],
  },
  {
    text: "Other ecosystems",
    items: [
      { text: "Cardano (CIP-30)", link: "/dapps/cardano" },
      { text: "Polkadot (injectWeb3)", link: "/dapps/polkadot" },
      { text: "Starknet", link: "/dapps/starknet" },
      { text: "TON Connect", link: "/dapps/ton" },
      { text: "NEAR", link: "/dapps/near" },
      { text: "Stellar", link: "/dapps/stellar" },
      { text: "Algorand", link: "/dapps/algorand" },
      { text: "Tezos (Beacon)", link: "/dapps/tezos" },
      { text: "WalletConnect", link: "/dapps/walletconnect" },
    ],
  },
  {
    text: "Clip Connect SDK",
    items: [
      { text: "Overview", link: "/connect/" },
      { text: "connect()", link: "/connect/connect" },
      { text: "request()", link: "/connect/request" },
      { text: "pay(), canPay(), balances()", link: "/connect/pay" },
      { text: "Wallet calls (EIP-5792)", link: "/connect/wallet-calls" },
      { text: "React hooks", link: "/connect/react" },
      { text: "wagmi connector", link: "/connect/wagmi" },
      { text: "Solana adapter", link: "/connect/solana" },
      { text: "Compatibility promise", link: "/connect/compatibility" },
    ],
  },
];

const build: Item[] = [
  {
    text: "Launch your own wallet",
    items: [
      { text: "Overview", link: "/kit/" },
      { text: "create-clip-wallet", link: "/kit/create-clip-wallet" },
      { text: "Scaffold-HBAR template", link: "/kit/scaffold-hbar" },
      { text: "Configure clip.config.ts", link: "/kit/config" },
      { text: "Build and ship", link: "/kit/build-and-ship" },
      { text: "Work with AI agents", link: "/kit/ai-agents" },
    ],
  },
  {
    text: "Extending Clip",
    items: [
      { text: "Write a chain module", link: "/extend/chain-module" },
      { text: "Add a network or token", link: "/extend/networks-and-tokens" },
      { text: "Write a plugin", link: "/extend/plugins" },
      { text: "Add a language", link: "/extend/languages" },
      { text: "Add a scam-check source", link: "/extend/threat-provider" },
    ],
  },
  {
    text: "Services",
    items: [
      { text: "Overview", link: "/services/" },
      { text: "Self-host on Cloudflare", link: "/services/self-hosting" },
      { text: "Backup", link: "/services/backup" },
      { text: "Media proxy", link: "/services/media-proxy" },
      { text: "Link relay", link: "/services/link-relay" },
    ],
  },
];

const trust: Item[] = [
  {
    text: "Security model",
    items: [
      { text: "Threat model", link: "/security/" },
      { text: "Vault cryptography", link: "/security/vault-crypto" },
      { text: "Approval-bound signing", link: "/security/approval-signing" },
      { text: "Sanitising what you see", link: "/security/sanitization" },
      { text: "Phishing and scam checks", link: "/security/scam-checks" },
      { text: "Hardware wallets", link: "/security/hardware" },
      { text: "Report a vulnerability", link: "/security/disclosure" },
    ],
  },
  {
    text: "Testing",
    items: [
      { text: "Overview", link: "/testing/" },
      { text: "Extension end-to-end", link: "/testing/extension-e2e" },
      { text: "Dapp and picker matrices", link: "/testing/matrices" },
      { text: "Fund a test wallet", link: "/testing/test-wallet" },
      { text: "Reproducible builds", link: "/testing/reproducible-builds" },
      { text: "Dapp matrix results", link: "/testing/results/dapp-matrix" },
      { text: "Picker matrix results", link: "/testing/results/picker-matrix" },
    ],
  },
  {
    text: "Contributing",
    items: [
      { text: "How to contribute", link: "/contributing/" },
      { text: "Changesets and releases", link: "/contributing/releases" },
      { text: "Working on these docs", link: "/contributing/docs" },
    ],
  },
];

function apiItems(): Item[] {
  const file = fileURLToPath(new URL("../src/reference/api/typedoc-sidebar.json", import.meta.url));
  if (!existsSync(file)) return [{ text: "Run pnpm --filter docs gen", link: "/reference/" }];
  return JSON.parse(readFileSync(file, "utf8")) as Item[];
}

const reference = (): Item[] => [
  {
    text: "Reference",
    items: [
      { text: "Overview", link: "/reference/" },
      { text: "clip.config.ts schema", link: "/reference/config" },
      { text: "Error codes", link: "/reference/errors" },
      { text: "Warning codes", link: "/reference/warnings" },
      { text: "Dapp-facing error codes", link: "/reference/dapp-errors" },
      { text: "create-clip-wallet CLI", link: "/reference/cli" },
    ],
  },
  { text: "API (generated)", collapsed: false, items: apiItems() },
];

export function sidebar(): DefaultTheme.Sidebar {
  return {
    "/guide/": guide,
    "/architecture/": guide,
    "/dapps/": dapps,
    "/connect/": dapps,
    "/kit/": build,
    "/extend/": build,
    "/services/": build,
    "/security/": trust,
    "/testing/": trust,
    "/contributing/": trust,
    "/reference/": reference(),
  };
}

export const nav: DefaultTheme.NavItem[] = [
  { text: "Guide", link: "/guide/", activeMatch: "^/(guide|architecture)/" },
  { text: "Dapps", link: "/dapps/", activeMatch: "^/(dapps|connect)/" },
  { text: "Build a wallet", link: "/kit/", activeMatch: "^/(kit|extend|services)/" },
  { text: "Security", link: "/security/", activeMatch: "^/(security|testing|contributing)/" },
  { text: "Reference", link: "/reference/", activeMatch: "^/reference/" },
];
