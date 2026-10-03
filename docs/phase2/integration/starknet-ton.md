# Integration: stream "starknet-ton"

This stream adds new files only, except for the edits listed under "Already changed in this branch". Apply the
edits below in order, then run `pnpm install && pnpm typecheck && pnpm test && pnpm harness`.

These exact edits were trial-applied to this branch. With them in place, typecheck and every package's tests passed,
and a throwaway end-to-end test also passed. It went page → content bridge → `createOneMaskRouter` → `handle` and
covered `window.starknet_clipwallet` (requestChainId, requestAccounts, addInvokeTransaction) and
`window.clipwallet.tonconnect` (connect, sendTransaction). The edits were then reverted.

## Already changed in this branch

| file | change |
|---|---|
| `packages/core/src/index.ts` | `Nft.standard` gains `"tep62"` (TON NFTs). Additive. |
| `packages/1mask/package.json` | devDependencies `jsdom ^30.1.1`, `@types/jsdom ^30.0.0` (connector tests run under `// @vitest-environment jsdom`) |
| `pnpm-lock.yaml` | new packages and dev deps |

New: `packages/chains-starknet/**`, `packages/chains-ton/**`, `packages/1mask/src/inpage/starknet.ts`,
`packages/1mask/src/inpage/ton.ts`, `packages/1mask/src/background/starknet-ton.ts`,
`packages/1mask/test/{inpage-starknet,inpage-ton}.test.ts`, `packages/1mask/test/starknet-ton-harness.ts`,
`docs/listings/ton-connect.md`.

## 1. `packages/config/src/index.ts`: allow the families in `clip.config` `networks`

```ts
// before
export const NETWORK_FAMILIES = ["evm", "hedera", "solana", "bitcoin"] as const;
// after (other Phase 2 streams add theirs to the same list)
export const NETWORK_FAMILIES = ["evm", "hedera", "solana", "bitcoin", "starknet", "ton"] as const;
```

Then add `"starknet"` and `"ton"` to `networks` in `apps/extension/clip.config.ts` to switch them on.

## 2. `apps/extension/package.json` dependencies

```json
"@clip-wallet/chains-starknet": "workspace:*",
"@clip-wallet/chains-ton": "workspace:*",
```

## 3. `apps/extension/src/shared/catalog.ts`

Imports, after the `@clip-wallet/chains-bitcoin` import:

```ts
import { STARKNET_MAINNET, STARKNET_SEPOLIA, CURATED_TOKENS as STARKNET_TOKENS, STARKNET_CHAINS } from "@clip-wallet/chains-starknet";
import { TON_MAINNET, TON_TESTNET } from "@clip-wallet/chains-ton";
```

In `walletNetworks`, add these to the `all` array after `...BITCOIN_NETWORKS.filter(...)`:

```ts
    STARKNET_SEPOLIA,
    STARKNET_MAINNET,
    TON_TESTNET,
    TON_MAINNET,
```

In `walletAssets`, add inside `for (const n of networks) { … }`, after the solana block:

```ts
    if (n.family === "starknet") {
      for (const t of STARKNET_TOKENS) {
        if (STARKNET_CHAINS[t.chain].caip2 !== n.id || t.key === "strk") continue;
        out.push({ key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, networkId: n.id, address: t.address, ...(t.bridged ? { bridged: true } : {}) });
      }
    }
```

TON has no curated testnet jettons. On mainnet, USD₮ shows up from balances.

## 4. `apps/extension/src/background/wiring.ts`

Imports, after `import { createBitcoinModule } from "@clip-wallet/chains-bitcoin";`:

```ts
import { createStarknetModule } from "@clip-wallet/chains-starknet";
import { createTonModule } from "@clip-wallet/chains-ton";
```

In the real-dependencies branch, replace the `chains:` line and the `dapps:` line:

```ts
  const starknet = createStarknetModule(); // OpenZeppelin v0.17.0 = the vault's default address; { account: "argent" } for Argent X accounts
  const ton = createTonModule(); // v5r1 = the vault's default; pass { walletVersion: "v4r2" } together with vaultOptions.tonWalletVersion "v4r2"
  // …
    chains: { evm: createEvmModule(), hedera, solana: createSolanaModule(), bitcoin: createBitcoinModule(), starknet, ton },
  // …
    dapps: new OneMaskConnector(networks, { starknet, ton }),
```

The vault and the modules must agree:
- `vaultOptions.starknetAccountClassHash` (default = `OZ_ACCOUNT_CLASS_HASH`) must match the starknet module's
  `account` / `accountClassHash`. For Argent, inject the vault's `addressOf`:
  ```ts
  addressOf: (f, pk) => f === "starknet" ? accountAddress(pk, { kind: "argent", classHash: ARGENT_ACCOUNT_CLASS_HASH }) : undefined
  ```
- `vaultOptions.tonWalletVersion` must match the ton module's `walletVersion`.

## 5. `apps/extension/src/background/real.ts` (`OneMaskConnector`)

```ts
// imports
import type { ChainModule } from "@clip-wallet/core";
import type { createStarknetModule } from "@clip-wallet/chains-starknet";
import type { createTonModule } from "@clip-wallet/chains-ton";

// CONNECT_METHODS gains the two connect methods
const CONNECT_METHODS = new Set<string>(["eth_requestAccounts", "wallet_requestPermissions", "standard:connect", "bitcoin:connect", "wallet_requestAccounts", "tonconnect:connect"]);

// constructor
constructor(
  private readonly networks: Network[],
  private readonly mods: { starknet?: ReturnType<typeof createStarknetModule>; ton?: ReturnType<typeof createTonModule> } = {},
) {}

// in start(host), add to the createOneMaskRouter({...}) options:
      starknetDeploymentData: async (origin, net) => {
        const [account] = await host.accountsFor(origin, "starknet");
        return account && this.mods.starknet ? this.mods.starknet.deploymentDataFor({ network: net, account, fetch }) : null;
      },
      tonAddrItem: async (origin, net) => {
        const [account] = await host.accountsFor(origin, "ton");
        if (!account || !this.mods.ton) throw new ClipError("Connect a TON account first.", "ton/no-account");
        return this.mods.ton.tonAddrItem(Uint8Array.from(account.publicKey.match(/../g)!.map((h) => parseInt(h, 16))), net);
      },
```

## 6. `packages/1mask/src/background/methods.ts`

```ts
// import
import { starknetTonAllowlist } from "./starknet-ton.js";

// in injectedAllowlist(), before `case "hedera":`
    case "starknet":
    case "ton":
      return starknetTonAllowlist(family);
```

## 7. `packages/1mask/src/background/router.ts`

```ts
// import, after the "./permissions.js" import
import { createStarknetTonDispatch, type StarknetTonOptions } from "./starknet-ton.js";

// OneMaskRouterOptions: make it extend StarknetTonOptions
export interface OneMaskRouterOptions extends StarknetTonOptions {

// inside createOneMaskRouter, right after `const revoke = async (...) => { ... };`
  const starknetTon = createStarknetTonDispatch(
    {
      permitted,
      accounts,
      connect,
      approve,
      makeReq,
      selectedNetwork,
      setSelected,
      candidates,
      emit,
      revoke: (origin, family, o) => revoke(origin, family, o),
    },
    opts,
  );

// in dispatchRaw, before the final `throw rpcError.unsupportedMethod(method);`
    if (family === "starknet") return starknetTon.starknet(origin, method, params);
    if (family === "ton") return starknetTon.ton(origin, method, params);
```

Notes:
- `revoke` already emits `accountsChanged []` and `disconnect` for non-EVM families. TON's bridge turns `disconnect`
  into the TON Connect `disconnect` event, and Starknet's into `accountsChanged([])`.
- `notifyAccountsChanged` needs no change.

## 8. `packages/1mask/src/background/index.ts`

```ts
export { STARKNET_METHODS_ALLOWED, TON_METHODS_ALLOWED, createStarknetTonDispatch, starknetFeltChainId, starknetTonAllowlist, type StarknetTonHelpers, type StarknetTonOptions, type TonAddrItem } from "./starknet-ton.js";
```

## 9. `packages/1mask/src/shared/config.ts` (`InpageConfig`)

```ts
  /** Which providers to install. Default: all. */
  providers?: { evm?: boolean; solana?: boolean; bitcoin?: boolean; starknet?: boolean; ton?: boolean };
  /** Also set legacy window.starknet (only if nothing owns it). Default false: window.starknet_<id> only. */
  claimWindowStarknet?: boolean;
  /**
   * TON Connect JS bridge: window[key].tonconnect. `appName` and `key` must equal the wallets-list entry's
   * app_name / bridge key (docs/listings/ton-connect.md). `features` = chains-ton `createTonModule().features`.
   */
  tonConnect?: { key: string; appName: string; appVersion: string; features: import("../inpage/ton.js").TonFeature[]; walletInfo?: import("../inpage/ton.js").TonWalletInfo };
```

## 10. `packages/1mask/src/inpage/index.ts`

```ts
// imports
import { ClipStarknetWallet, injectStarknet } from "./starknet.js";
import { ClipTonConnectBridge, injectTonConnect } from "./ton.js";

// InstalledOneMask
  starknet?: ClipStarknetWallet;
  ton?: ClipTonConnectBridge;

// installOneMask: `want` default gains the families
  const want = { evm: true, solana: true, bitcoin: true, starknet: true, ton: true, ...config.providers };

// after the bitcoin block
  if (want.starknet && config.networks.some((n) => n.family === "starknet")) {
    out.starknet = new ClipStarknetWallet(identity, transport);
    stops.push(injectStarknet(win, out.starknet, { claimWindowStarknet: config.claimWindowStarknet === true }).stop);
  }
  if (want.ton && config.tonConnect && config.networks.some((n) => n.family === "ton")) {
    const { key, walletInfo, ...device } = config.tonConnect;
    out.ton = new ClipTonConnectBridge(transport, device, walletInfo);
    stops.push(injectTonConnect(win, key, out.ton).stop);
  }

// exports
export { ClipStarknetWallet, StarknetWalletError, STARKNET_ERRORS, injectStarknet, starknetWalletId, toStarknetError } from "./starknet.js";
export { ClipTonConnectBridge, TON_ERRORS, TON_PROTOCOL_VERSION, injectTonConnect, toTonError } from "./ton.js";
export type { ConnectEvent, DeviceInfo, TonConnectRequest, TonFeature, TonWalletInfo, WalletEvent, WalletResponse } from "./ton.js";
```

Pass `tonConnect` from the extension's inpage entry, with the values from the wallets-list draft:

```ts
tonConnect: {
  key: "clipwallet",
  appName: "clipwallet",
  appVersion: <package version>,
  features: [
    { name: "SendTransaction", maxMessages: 255, itemTypes: ["ton", "jetton", "nft"] },
    { name: "SignData", types: ["text", "binary", "cell"] },
  ],
}
```

For v4r2, set `maxMessages: 4`.

## 11. Approval UI

- The approval window shows connect requests for the `"starknet"` and `"ton"` families like Solana's. No
  network picker; the network is a chip.
- TON Connect `ton_proof` reaches `host.request` as method `ton_proof` with `{ payload }`. The chain module titles
  it "Prove to <site> that this wallet is yours".
- Starknet first use: `prepare()` returns two payloads (activation and the transaction). Register both hashes in one
  approval (`registerApproval(approvalId, [h1, h2])`).

## Checklist after applying

- `pnpm typecheck && pnpm test && pnpm harness`
- With `starknet` and `ton` in `clip.config` networks:
  - get-starknet v4 lists Clip Wallet (`window.starknet_clipwallet`).
  - `@tonconnect/ui` shows Clip Wallet as injected when `window.clipwallet.tonconnect` exists. The SDK also
    needs the wallets-list entry (or `walletsListConfiguration.includeWallets`) to show it in the picker.
