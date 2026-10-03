# Integration: stream "move" (Sui + Aptos)

New in this stream (no edits needed to merge them):

- `packages/chains-sui` (`@clip-wallet/chains-sui`): `createSuiModule()`, `SUI_NETWORKS` (`sui:testnet`, `sui:devnet`, `sui:mainnet`), `USDC_COIN_TYPES`, `coinAssetKey`.
- `packages/chains-aptos` (`@clip-wallet/chains-aptos`): `createAptosModule()`, `APTOS_NETWORKS` (`aptos:2` testnet, `aptos:devnet`, `aptos:1` mainnet), `USDC_METADATA`, `assetKey`.
- `packages/1mask/src/inpage/sui.ts`: `ClipSuiWallet` (Sui Wallet Standard), `SUI_FEATURES`, `SUI_SIGNING_METHODS`, `suiChain`.
- `packages/1mask/src/inpage/aptos.ts`: `ClipAptosWallet` (AIP-62), `APTOS_FEATURES`, `APTOS_*_METHODS`, `METHOD_APTOS_NETWORK` (`"1mask_getNetwork"`), `aptosChain`, `toWireArg`.
- `packages/1mask/test/move-wallets.test.ts`: tests for both connectors against an in-memory transport.
- `packages/core/src/index.ts`: one additive change, `Nft.standard` gains `"sui-object" | "aptos-digital-asset"`.
- `packages/1mask/package.json`: new dependencies `@mysten/sui`, `@mysten/wallet-standard`, `@aptos-labs/ts-sdk` and `@aptos-labs/wallet-standard`. These are runtime peers of the two wallet-standard packages. The AIP-62 API exchanges ts-sdk objects (`AccountInfo`, `AccountAuthenticator`, `Ed25519Signature`), so the in-page script needs them.

## What the integration step applies

The diff below is exact. It was applied to this branch, then `pnpm install && pnpm typecheck && pnpm test && pnpm harness`
all passed (1mask 84 tests including the end-to-end file below, extension 16, config 10), and the diff was reverted.
Apply it with `git apply` from the repo root (save the block as a file), then run `pnpm install`. Do that because
`apps/extension/package.json` gains the two workspace packages.

What it does, file by file:

- `packages/1mask/src/background/methods.ts`: `SUI_METHODS_ALLOWED` and `APTOS_METHODS_ALLOWED`, plus the `sui` and `aptos` cases in `injectedAllowlist`.
- `packages/1mask/src/background/router.ts`: sui and aptos go through `dispatchStandard`. Inputs are `{ inputs: [{ account, ... }] }` like Solana's, so the Solana account check is reused. `aptos:connect` and `aptos:disconnect` join the connect/disconnect cases. `1mask_getNetwork` answers `{ networkId }` for the site's selected network. Sui and Aptos addresses compare case-insensitively.
- `packages/1mask/src/inpage/index.ts`: installs and registers both wallets when the registry has networks of the family. The AIP-62 wallet's transport listener is stopped in `destroy`.
- `packages/1mask/src/shared/config.ts`: `providers` gains `sui` and `aptos`.
- `packages/config`: `NETWORK_FAMILIES` and the network pattern accept `"sui"` and `"aptos"`, and the test message is updated.
- `apps/extension`: the modules go in `wiring.ts`. Networks (testnet + mainnet; mainnet still gated by `clip.config`) and USDC assets go in `catalog.ts`. `"aptos:connect"` is added to `CONNECT_METHODS` and ETAs to `real.ts`. `service.ts` gains the families. Its address recognition skips families the build has no module for, because fixture mode has no sui/aptos mocks.

```diff
diff --git a/apps/extension/package.json b/apps/extension/package.json
index ff51076..714762f 100644
--- a/apps/extension/package.json
+++ b/apps/extension/package.json
@@ -21,6 +21,8 @@
     "@clip-wallet/chains-evm": "workspace:*",
     "@clip-wallet/chains-hedera": "workspace:*",
     "@clip-wallet/chains-solana": "workspace:*",
+    "@clip-wallet/chains-sui": "workspace:*",
+    "@clip-wallet/chains-aptos": "workspace:*",
     "@clip-wallet/config": "workspace:*",
     "@clip-wallet/core": "workspace:*",
     "@clip-wallet/route": "workspace:*",
diff --git a/apps/extension/src/background/real.ts b/apps/extension/src/background/real.ts
index e363218..1d71185 100644
--- a/apps/extension/src/background/real.ts
+++ b/apps/extension/src/background/real.ts
@@ -9,7 +9,7 @@ import { createOneMaskRouter, EVM_METHODS, type OneMaskRouter, type RouterPort }
 import { createRouteClient, findShortfall, type RouteClient } from "@clip-wallet/route";
 import type { DappConnector, DappHost, DappRegistry, NameResolver, PriceFeed, RoutePlanner, WalletConnectBridge } from "./wiring";
 
-const CONNECT_METHODS = new Set<string>(["eth_requestAccounts", "wallet_requestPermissions", "standard:connect", "bitcoin:connect"]);
+const CONNECT_METHODS = new Set<string>(["eth_requestAccounts", "wallet_requestPermissions", "standard:connect", "bitcoin:connect", "aptos:connect"]);
 const READ_ONLY = new Set<string>(EVM_METHODS.readOnly);
 
 /* ------------------------------------------------------------------ 1Mask */
@@ -145,7 +145,7 @@ export class WalletConnectAdapter implements WalletConnectBridge {
 
 /* ------------------------------------------------------------------ route */
 
-const PLAIN_ETA: Partial<Record<Family, number>> = { evm: 12, hedera: 4, solana: 2, bitcoin: 600 };
+const PLAIN_ETA: Partial<Record<Family, number>> = { evm: 12, hedera: 4, solana: 2, bitcoin: 600, sui: 1, aptos: 1 };
 
 /** CLPRouter funding through @clip-wallet/route. Phase 1 routes pay on Hedera from EVM networks. */
 export class RoutePlannerAdapter implements RoutePlanner {
diff --git a/apps/extension/src/background/service.ts b/apps/extension/src/background/service.ts
index 3a37a67..ab8dae6 100644
--- a/apps/extension/src/background/service.ts
+++ b/apps/extension/src/background/service.ts
@@ -83,7 +83,7 @@ function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
   return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
 }
 const APPROVAL_TTL_MS = 2 * 60_000;
-const FAMILIES: Family[] = ["evm", "hedera", "solana", "bitcoin"];
+const FAMILIES: Family[] = ["evm", "hedera", "solana", "bitcoin", "sui", "aptos"];
 
 function parseUnits(value: string, decimals: number): bigint {
   const [w = "0", f = ""] = value.split(".");
@@ -396,7 +396,7 @@ export class WalletService implements DappHost {
       displayName = hit.displayName;
     }
     const carrying = this.deps.networks.filter((n) => this.deps.assets.some((a) => a.key === assetKey && a.networkId === n.id));
-    const recognised = FAMILIES.filter((f) => this.module(f).isAddress(address));
+    const recognised = FAMILIES.filter((f) => !!this.deps.chains[f]?.isAddress(address));
     if (recognised.length === 0) return { kind: "invalid", message: "That doesn't look like an address. Check it and try again." };
     const candidates = recognised.flatMap((f) => this.module(f).networksForAddress(address, carrying.filter((n) => n.family === f)));
     const symbol = this.deps.assets.find((a) => a.key === assetKey)?.symbol ?? "this";
diff --git a/apps/extension/src/background/wiring.ts b/apps/extension/src/background/wiring.ts
index 9c6e13d..10bcf8d 100644
--- a/apps/extension/src/background/wiring.ts
+++ b/apps/extension/src/background/wiring.ts
@@ -25,6 +25,8 @@ import { createEvmModule } from "@clip-wallet/chains-evm";
 import { createHederaModule, type HederaModule } from "@clip-wallet/chains-hedera";
 import { createSolanaModule } from "@clip-wallet/chains-solana";
 import { createBitcoinModule } from "@clip-wallet/chains-bitcoin";
+import { createSuiModule } from "@clip-wallet/chains-sui";
+import { createAptosModule } from "@clip-wallet/chains-aptos";
 import type { RouterPort } from "@clip-wallet/1mask/background";
 import type { KV } from "../shared/storage";
 import { vaultStorageOf } from "../shared/storage";
@@ -199,7 +201,7 @@ export function createDependencies(opts: WiringOptions): Dependencies {
   return {
     mocks: false,
     vault,
-    chains: { evm: createEvmModule(), hedera, solana: createSolanaModule(), bitcoin: createBitcoinModule() },
+    chains: { evm: createEvmModule(), hedera, solana: createSolanaModule(), bitcoin: createBitcoinModule(), sui: createSuiModule(), aptos: createAptosModule() },
     networks,
     assets: walletAssets(networks),
     route: new RoutePlannerAdapter(opts.config, prices, opts.currency),
diff --git a/apps/extension/src/shared/catalog.ts b/apps/extension/src/shared/catalog.ts
index 44c230c..0fdc83a 100644
--- a/apps/extension/src/shared/catalog.ts
+++ b/apps/extension/src/shared/catalog.ts
@@ -10,6 +10,8 @@ type CuratedToken = (typeof CURATED_TOKENS)[number];
 import { HEDERA_MAINNET, HEDERA_TESTNET, USDC_TOKEN_IDS, ledgerOf, tokenAssetKey as htsKey } from "@clip-wallet/chains-hedera";
 import { SOLANA_DEVNET, SOLANA_MAINNET, USDC_MINTS, tokenAssetKey as splKey } from "@clip-wallet/chains-solana";
 import { BITCOIN_NETWORKS } from "@clip-wallet/chains-bitcoin";
+import { SUI_MAINNET, SUI_TESTNET, USDC_COIN_TYPES, coinAssetKey as suiKey } from "@clip-wallet/chains-sui";
+import { APTOS_MAINNET, APTOS_TESTNET, USDC_METADATA, assetKey as aptosKey } from "@clip-wallet/chains-aptos";
 
 /** Same mapping as chains-evm's (unexported) curatedAsset(). */
 function curatedAsset(t: CuratedToken): AssetRef {
@@ -28,6 +30,10 @@ export function walletNetworks(config: Pick<ClipConfig, "networks" | "mainnet">)
     SOLANA_DEVNET,
     SOLANA_MAINNET,
     ...BITCOIN_NETWORKS.filter((n) => n.name !== "Bitcoin Signet"),
+    SUI_TESTNET,
+    SUI_MAINNET,
+    APTOS_TESTNET,
+    APTOS_MAINNET,
   ];
   return all.filter((n) => (families as readonly string[]).includes(n.family) && (mainnet || n.testnet));
 }
@@ -54,6 +60,14 @@ export function walletAssets(networks: Network[]): AssetRef[] {
       const mint = USDC_MINTS[n.testnet ? "devnet" : "mainnet"];
       if (mint) out.push({ key: splKey(n.id, mint), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: mint });
     }
+    if (n.family === "sui") {
+      const type = USDC_COIN_TYPES[n.testnet ? "testnet" : "mainnet"];
+      if (type) out.push({ key: suiKey(n.id, type), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: type });
+    }
+    if (n.family === "aptos") {
+      const fa = USDC_METADATA[n.testnet ? "testnet" : "mainnet"];
+      if (fa) out.push({ key: aptosKey(n.id, fa), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: fa });
+    }
   }
   return out;
 }
diff --git a/packages/1mask/src/background/methods.ts b/packages/1mask/src/background/methods.ts
index 39ea071..ead0022 100644
--- a/packages/1mask/src/background/methods.ts
+++ b/packages/1mask/src/background/methods.ts
@@ -1,5 +1,7 @@
 import type { Family } from "@clip-wallet/core";
 import { METHOD_PROVIDER_STATE, METHOD_WS_STATE } from "../shared/protocol.js";
+import { APTOS_CONNECT_METHODS, APTOS_LOCAL_METHODS, APTOS_SIGNING_METHODS } from "../inpage/aptos.js";
+import { SUI_SIGNING_METHODS } from "../inpage/sui.js";
 
 /**
  * Method allowlists per family. Anything not listed is answered with 4200 (unsupported method)
@@ -60,6 +62,18 @@ export const BITCOIN_METHODS_ALLOWED = {
   signing: ["bitcoin:signTransaction", "bitcoin:signAndSendTransaction", "bitcoin:signMessage", "bitcoin:sendTransfer"],
 } as const;
 
+export const SUI_METHODS_ALLOWED = {
+  local: [METHOD_WS_STATE, "standard:disconnect"],
+  connect: ["standard:connect"],
+  signing: SUI_SIGNING_METHODS,
+} as const;
+
+export const APTOS_METHODS_ALLOWED = {
+  local: APTOS_LOCAL_METHODS,
+  connect: APTOS_CONNECT_METHODS,
+  signing: APTOS_SIGNING_METHODS,
+} as const;
+
 /**
  * Hedera native methods (hashgraph/hedera-wallet-connect `HederaJsonRpcMethod`). Reached only over
  * WalletConnect (namespace "hedera"); there is no injected Hedera provider in v1.
@@ -86,6 +100,10 @@ export function injectedAllowlist(family: Family): ReadonlySet<string> {
       return new Set<string>([...SOLANA_METHODS.local, ...SOLANA_METHODS.connect, ...SOLANA_METHODS.signIn, ...SOLANA_METHODS.signing]);
     case "bitcoin":
       return new Set<string>([...BITCOIN_METHODS_ALLOWED.local, ...BITCOIN_METHODS_ALLOWED.connect, ...BITCOIN_METHODS_ALLOWED.signing]);
+    case "sui":
+      return new Set<string>([...SUI_METHODS_ALLOWED.local, ...SUI_METHODS_ALLOWED.connect, ...SUI_METHODS_ALLOWED.signing]);
+    case "aptos":
+      return new Set<string>([...APTOS_METHODS_ALLOWED.local, ...APTOS_METHODS_ALLOWED.connect, ...APTOS_METHODS_ALLOWED.signing]);
     case "hedera":
       return new Set<string>();
     default:
diff --git a/packages/1mask/src/background/router.ts b/packages/1mask/src/background/router.ts
index cf266cf..6da363f 100644
--- a/packages/1mask/src/background/router.ts
+++ b/packages/1mask/src/background/router.ts
@@ -20,6 +20,7 @@ import {
   type PortResponse,
 } from "../shared/protocol.js";
 import { BITCOIN_METHODS_ALLOWED, EVM_METHODS, SOLANA_METHODS, injectedAllowlist } from "./methods.js";
+import { METHOD_APTOS_NETWORK } from "../inpage/aptos.js";
 import type { PermissionStore } from "./permissions.js";
 
 /** Background side of a runtime port (chrome.runtime.Port satisfies it). */
@@ -239,7 +240,7 @@ export function createOneMaskRouter(opts: OneMaskRouterOptions): OneMaskRouter {
   };
 
   const sameAddress = (family: Family, a: string, b: string) =>
-    family === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b;
+    family === "evm" || family === "sui" || family === "aptos" ? a.toLowerCase() === b.toLowerCase() : a === b;
 
   const requireOwnAddresses = async (origin: string, family: Family, addresses: unknown[]) => {
     const list = await accounts(origin, family);
@@ -391,7 +392,7 @@ export function createOneMaskRouter(opts: OneMaskRouterOptions): OneMaskRouter {
 
   const dispatchStandard = async (
     origin: string,
-    family: "solana" | "bitcoin",
+    family: "solana" | "bitcoin" | "sui" | "aptos",
     method: string,
     params: unknown,
     chain: string | undefined,
@@ -401,10 +402,14 @@ export function createOneMaskRouter(opts: OneMaskRouterOptions): OneMaskRouter {
         return (await permitted(origin, family)) ? accounts(origin, family) : [];
       case "standard:disconnect":
       case "bitcoin:disconnect":
+      case "aptos:disconnect":
         await revoke(origin, family);
         return null;
+      case METHOD_APTOS_NETWORK:
+        return { networkId: requireNetwork(family, origin, chain).id };
       case "standard:connect":
-      case "bitcoin:connect": {
+      case "bitcoin:connect":
+      case "aptos:connect": {
         if (await permitted(origin, family)) return accounts(origin, family);
         return connect(origin, family, requireNetwork(family, origin, chain), method, params ?? {});
       }
@@ -422,7 +427,7 @@ export function createOneMaskRouter(opts: OneMaskRouterOptions): OneMaskRouter {
 
     await requirePermission(origin, family);
     const inputs = method === "bitcoin:sendTransfer" ? [] : inputsOf(params);
-    if (family === "solana") {
+    if (family === "solana" || family === "sui" || family === "aptos") {
       await requireOwnAddresses(origin, family, inputs.map((i) => i.account));
       if (method === "solana:signAndSendTransaction" && inputs.some((i) => typeof i.chain !== "string")) {
         throw rpcError.invalidParams("solana:signAndSendTransaction needs a chain.");
@@ -455,7 +460,9 @@ export function createOneMaskRouter(opts: OneMaskRouterOptions): OneMaskRouter {
     }
     if (!injectedAllowlist(family).has(method)) throw rpcError.unsupportedMethod(method);
     if (family === "evm") return dispatchEvm(origin, method, params);
-    if (family === "solana" || family === "bitcoin") return dispatchStandard(origin, family, method, params, chain);
+    if (family === "solana" || family === "bitcoin" || family === "sui" || family === "aptos") {
+      return dispatchStandard(origin, family, method, params, chain);
+    }
     throw rpcError.unsupportedMethod(method);
   };
 
diff --git a/packages/1mask/src/inpage/index.ts b/packages/1mask/src/inpage/index.ts
index ff4a9b7..2f471d1 100644
--- a/packages/1mask/src/inpage/index.ts
+++ b/packages/1mask/src/inpage/index.ts
@@ -11,6 +11,8 @@ import { resolveChannel, resolveIdentity, type InpageConfig, type WalletIdentity
 import { ClipBitcoinWallet } from "./bitcoin.js";
 import { ClipEthereumProvider, announceEip6963, claimWindowEthereum, type EIP6963ProviderDetail } from "./evm.js";
 import { ClipSolanaWallet } from "./solana.js";
+import { ClipSuiWallet } from "./sui.js";
+import { ClipAptosWallet } from "./aptos.js";
 import { createInpageTransport, type InpageTransport } from "./transport.js";
 
 export interface InstalledOneMask {
@@ -19,6 +21,8 @@ export interface InstalledOneMask {
   evm?: { provider: ClipEthereumProvider; detail: EIP6963ProviderDetail; claimedWindowEthereum: boolean };
   solana?: ClipSolanaWallet;
   bitcoin?: ClipBitcoinWallet;
+  sui?: ClipSuiWallet;
+  aptos?: ClipAptosWallet;
   destroy(): void;
 }
 
@@ -30,7 +34,7 @@ export function installOneMask(config: InpageConfig, win: Window = window): Inst
     win,
     ...(config.requestTimeoutMs !== undefined ? { timeoutMs: config.requestTimeoutMs } : {}),
   });
-  const want = { evm: true, solana: true, bitcoin: true, ...config.providers };
+  const want = { evm: true, solana: true, bitcoin: true, sui: true, aptos: true, ...config.providers };
   const stops: (() => void)[] = [() => transport.destroy()];
   const out: InstalledOneMask = { identity, transport, destroy: () => stops.forEach((s) => s()) };
 
@@ -49,6 +53,16 @@ export function installOneMask(config: InpageConfig, win: Window = window): Inst
     out.bitcoin = new ClipBitcoinWallet(identity, config.networks, transport);
     registerWallet(out.bitcoin);
   }
+  if (want.sui && config.networks.some((n) => n.family === "sui")) {
+    out.sui = new ClipSuiWallet(identity, config.networks, transport);
+    registerWallet(out.sui);
+  }
+  if (want.aptos && config.networks.some((n) => n.family === "aptos")) {
+    const aptos = new ClipAptosWallet(identity, config.networks, transport);
+    out.aptos = aptos;
+    stops.push(() => aptos.destroy());
+    registerWallet(aptos);
+  }
   return out;
 }
 
@@ -56,5 +70,7 @@ export { ClipEthereumProvider, announceEip6963, claimWindowEthereum } from "./ev
 export type { EIP6963ProviderDetail, EIP6963ProviderInfo, RequestArguments } from "./evm.js";
 export { ClipSolanaWallet, SOLANA_FEATURES } from "./solana.js";
 export { ClipBitcoinWallet, BITCOIN_FEATURES, BITCOIN_METHODS } from "./bitcoin.js";
+export { ClipSuiWallet, SUI_FEATURES, SUI_SIGNING_METHODS, suiChain } from "./sui.js";
+export { ClipAptosWallet, APTOS_FEATURES, METHOD_APTOS_NETWORK, aptosChain, toWireArg } from "./aptos.js";
 export * from "./bitcoin-features.js";
 export { createInpageTransport, type InpageTransport } from "./transport.js";
diff --git a/packages/1mask/src/shared/config.ts b/packages/1mask/src/shared/config.ts
index dca4175..73afa8d 100644
--- a/packages/1mask/src/shared/config.ts
+++ b/packages/1mask/src/shared/config.ts
@@ -36,7 +36,7 @@ export interface InpageConfig {
   /** Also set window.ethereum (only if nothing else owns it). Default false: EIP-6963 only. */
   claimWindowEthereum?: boolean;
   /** Which providers to install. Default: all. */
-  providers?: { evm?: boolean; solana?: boolean; bitcoin?: boolean };
+  providers?: { evm?: boolean; solana?: boolean; bitcoin?: boolean; sui?: boolean; aptos?: boolean };
   /** Per-site compatibility mode. Typed stub, NOT implemented in v1. */
   compatibility?: CompatibilityModeConfig;
   /** Per-request timeout in the page, ms. Default 10 minutes (approvals can take a while). */
diff --git a/packages/config/src/index.ts b/packages/config/src/index.ts
index 9941b23..aca848b 100644
--- a/packages/config/src/index.ts
+++ b/packages/config/src/index.ts
@@ -15,13 +15,13 @@ export const MAINNET_ACKNOWLEDGEMENT =
 
 export const WALLETCONNECT_ENV = "CLIP_WALLETCONNECT_PROJECT_ID";
 
-export const NETWORK_FAMILIES = ["evm", "hedera", "solana", "bitcoin"] as const;
+export const NETWORK_FAMILIES = ["evm", "hedera", "solana", "bitcoin", "sui", "aptos"] as const;
 export const ROUTE_MODES = ["balanced", "cheapest", "fastest", "reliable", "greenest"] as const;
 export const TRUST_TIERS = ["attested", "committee", "light-client", "validity-proof"] as const;
 export const HARDWARE = ["ledger", "keystone"] as const;
 
 /** "evm:*", "evm:8453", "evm:base-sepolia", "hedera", "solana", "bitcoin". */
-const NETWORK_PATTERN = /^(?:evm:(?:\*|[1-9]\d*|[a-z][a-z0-9-]*)|hedera|solana|bitcoin)$/;
+const NETWORK_PATTERN = /^(?:evm:(?:\*|[1-9]\d*|[a-z][a-z0-9-]*)|hedera|solana|bitcoin|sui|aptos)$/;
 const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
 const RDNS = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
 
@@ -115,7 +115,7 @@ export const clipConfigSchema = z
     rdns: z.string("set rdns to a reverse domain you own, like com.example.wallet").regex(RDNS, "use a reverse domain you own, like com.example.wallet (lowercase)"),
     theme: theme.default({ accent: "#4F46E5", accentText: "#FFFFFF", font: "Inter", radius: 12 }),
     networks: z
-      .array(z.string().regex(NETWORK_PATTERN, 'use "evm:*", "evm:<chain id>", "hedera", "solana" or "bitcoin"'))
+      .array(z.string().regex(NETWORK_PATTERN, 'use "evm:*", "evm:<chain id>", "hedera", "solana", "bitcoin", "sui" or "aptos"'))
       .min(1, "turn on at least one network")
       .refine((n) => new Set(n).size === n.length, "each network is listed once")
       .default(["evm:*", "hedera", "solana", "bitcoin"]),
diff --git a/packages/config/test/config.test.ts b/packages/config/test/config.test.ts
index 60675f2..249cf28 100644
--- a/packages/config/test/config.test.ts
+++ b/packages/config/test/config.test.ts
@@ -80,7 +80,7 @@ describe("validation errors in plain words", () => {
 
   it("explains network patterns", () => {
     expect(problems({ ...base, networks: ["ethereum"] })).toEqual([
-      'networks.0: use "evm:*", "evm:<chain id>", "hedera", "solana" or "bitcoin"',
+      'networks.0: use "evm:*", "evm:<chain id>", "hedera", "solana", "bitcoin", "sui" or "aptos"',
     ]);
     expect(problems({ ...base, networks: [] })).toEqual(["networks: turn on at least one network"]);
     expect(problems({ ...base, networks: ["hedera", "hedera"] })).toEqual(["networks: each network is listed once"]);
```

## Optional: end-to-end test after integration

Add as `packages/1mask/test/move-e2e.test.ts` once the diff is in. It drives both in-page wallets through the real router:

```ts
import type { Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { ClipAptosWallet } from "../src/inpage/aptos.js";
import { ClipSuiWallet } from "../src/inpage/sui.js";
import { createInpageTransport } from "../src/inpage/transport.js";
import { resolveIdentity } from "../src/shared/config.js";
import { ACCOUNTS, NETWORKS, makeHarness } from "./helpers.js";

const asset = (key: string, networkId: string) => ({ key, symbol: key.toUpperCase(), name: key, decimals: 9, networkId });
const NETS: Network[] = [
  ...NETWORKS,
  { id: "sui:testnet", family: "sui", name: "Sui Testnet", nativeAsset: asset("sui", "sui:testnet"), testnet: true, rpcUrls: [], explorerUrl: "" },
  { id: "aptos:2", family: "aptos", name: "Aptos Testnet", nativeAsset: asset("apt", "aptos:2"), testnet: true, rpcUrls: [], explorerUrl: "" },
];
const SUI = "0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1";
const APT = "0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf";
ACCOUNTS.sui = [{ address: SUI, publicKey: "900b4d81eecea3df2f74b14200c4f4cf3f49afaca7a634ffd2cf6ff82bdaecf2" }];
ACCOUNTS.aptos = [{ address: APT, publicKey: "a686f0309ab80312979606cfccc10ea2740147ae6888351488d11c46f08fbf60" }];

describe("Sui and Aptos through the router (integration)", () => {
  it("connects and signs end to end", async () => {
    const h = makeHarness({
      networks: NETS,
      handleImpl: (r) => {
        if (r.method === "sui:signTransaction") return { bytes: "AQID", signature: "AAAA" };
        if (r.method === "aptos:signMessage") return { fullMessage: "APTOS\nmessage: hi\nnonce: 1", message: "hi", nonce: "1", prefix: "APTOS", signature: `0x${"11".repeat(64)}` };
        return true;
      },
    });
    const t = createInpageTransport({ channel: h.channel, win: h.win });
    const id = resolveIdentity();
    const sui = new ClipSuiWallet(id, NETS, t);
    const { accounts } = await (sui.features as any)["standard:connect"].connect();
    expect(accounts[0].address).toBe(SUI);
    await (sui.features as any)["sui:signTransaction"].signTransaction({ transaction: { toJSON: async () => "{}" }, account: accounts[0], chain: "sui:testnet" });
    expect(h.handled.at(-1)).toMatchObject({ family: "sui", networkId: "sui:testnet", method: "sui:signTransaction" });

    const aptos = new ClipAptosWallet(id, NETS, t);
    expect((await aptos.features["aptos:connect"].connect()).status).toBe("Approved");
    expect(await aptos.features["aptos:network"].network()).toEqual({ name: "testnet", chainId: 2 });
    const m = await aptos.features["aptos:signMessage"].signMessage({ message: "hi", nonce: "1" });
    expect(m.status).toBe("Approved");
    expect(h.handled.at(-1)).toMatchObject({ family: "aptos", networkId: "aptos:2", method: "aptos:signMessage" });
    expect(h.handled.map((r) => r.method)).toEqual(["standard:connect", "sui:signTransaction", "aptos:connect", "aptos:signMessage"]);
  });

  it("refuses signing before connect", async () => {
    const h = makeHarness({ networks: NETS });
    await expect(h.router.dispatch("https://x.example", { family: "aptos", method: "aptos:signMessage", params: { inputs: [{ account: APT, message: "m", nonce: "1" }] } })).rejects.toMatchObject({ code: 4100 });
  });
});
```

## Notes for the integrator

- **Vault**: Sui `m/44'/784'/i'/0'/0'` with address BLAKE2b-256(0x00 ‖ pk), and Aptos `m/44'/637'/i'/0'/0'` with address SHA3-256(pk ‖ 0x00). Both match the merged vault. The test fixture accounts are the vault's own "abandon … about" addresses (`0x5e93…61f1`, `0xeb66…d3bf`).
- **Signing payloads**: Sui gives the vault the 32-byte BLAKE2b-256(intent ‖ BCS) digest; Sui's ed25519 signature covers that digest. Aptos gives it sha3-256(domain) ‖ BCS, or the UTF-8 fullMessage for messages. Both use scheme `ed25519`, and the approval hash covers those bytes.
- **Request state**: both modules cache the resolved transaction per `DappRequest.id` between decode → prepare → finalize, so keep one module instance per family (wiring already does).
- **Fixture mode**: `mocks/mock-chains.ts` and `mocks/networks.ts` have no sui/aptos entries yet. The `service.ts` change keeps fixture mode working without them.
- **Sui RPC**: Sui Foundation's public fullnodes stopped serving JSON-RPC in July 2026. `Network.rpcUrls[0]` for Sui is the **GraphQL** endpoint.
- **Aptos devnet**: its numeric chain id changes on reset, so it is fetched from the node when signing and reported as `0` by `aptos:network`. The catalog ships testnet and mainnet only.
