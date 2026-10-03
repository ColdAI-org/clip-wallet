# Integration: cardano-substrate stream

New in this stream (already on the branch, nothing to apply):

- `packages/chains-cardano`: `createCardanoModule()` (ChainModule plus `read`, `getStaking`, `buildDelegate`)
- `packages/chains-substrate`: `createSubstrateModule()` (ChainModule plus `getStaking`, `buildStake`)
- `packages/1mask/src/inpage/cardano.ts`: CIP-30 `window.cardano.<key>` (`installCardano`)
- `packages/1mask/src/inpage/substrate.ts`: `window.injectedWeb3[name]` (`installSubstrate`)
- `packages/1mask/src/background/cardano-substrate.ts`: allowlists + `dispatchCardanoSubstrate`
- `packages/core/src/index.ts` (additive): `Nft.standard` gains `"cip25" | "cip68" | "substrate-nfts" |
  "substrate-uniques"`. Cardano stake-key signing uses the vault stream's `SignablePayload.derivationSubPath`
  (`"2/0"`), so there's no new signing field.

Apply the lines below. Each block names the file and an anchor that's already there.

## 1. `packages/1mask/src/background/methods.ts`

Add the import at the top:

```ts
import { cardanoSubstrateAllowlist } from "./cardano-substrate.js";
```

In `injectedAllowlist`, put these cases just above `default:`:

```ts
    case "cardano":
    case "substrate":
      return cardanoSubstrateAllowlist(family);
```

## 2. `packages/1mask/src/background/router.ts`

Add the import after `import { BITCOIN_METHODS_ALLOWED, EVM_METHODS, SOLANA_METHODS, injectedAllowlist } from "./methods.js";`:

```ts
import { dispatchCardanoSubstrate, type CardanoSubstrateRouterHelpers } from "./cardano-substrate.js";
```

In `dispatchRaw`, add this right after the line
`if (family === "solana" || family === "bitcoin") return dispatchStandard(origin, family, method, params, chain);`:

```ts
    if (family === "cardano" || family === "substrate") return dispatchCardanoSubstrate(cardanoSubstrateHelpers, origin, family, method, params, chain);
```

Add this block just above `/* ------------------------------------------------------------ public */`. It uses the
router's own closures; `revoke` is a `const` declared later, which is fine because it's only called at dispatch time:

```ts
  /* ------------------------------------------------------------ Cardano (CIP-30) & Substrate (injectedWeb3) */

  const cardanoSubstrateHelpers: CardanoSubstrateRouterHelpers = {
    permitted,
    accounts,
    connect,
    approve,
    read: (req) => withTimeout(opts.handle(req), readMs, req.id),
    makeReq,
    requireNetwork,
    requirePermission,
    revoke: (origin, family) => revoke(origin, family),
  };
```

## 3. `packages/1mask/src/background/index.ts`

Append:

```ts
export {
  CARDANO_METHODS_ALLOWED,
  SUBSTRATE_METHODS_ALLOWED,
  cardanoSubstrateAllowlist,
  dispatchCardanoSubstrate,
  type CardanoSubstrateRouterHelpers,
} from "./cardano-substrate.js";
```

## 4. `packages/1mask/src/shared/config.ts`

Replace the `providers` line in `InpageConfig`:

```ts
  providers?: { evm?: boolean; solana?: boolean; bitcoin?: boolean; cardano?: boolean; substrate?: boolean };
```

## 5. `packages/1mask/src/inpage/index.ts`

Add the imports next to the other connector imports:

```ts
import { installCardano, type ClipCardanoWallet } from "./cardano.js";
import { installSubstrate, type ClipSubstrateProvider } from "./substrate.js";
```

Add these fields to `InstalledOneMask` (after `bitcoin?: ClipBitcoinWallet;`):

```ts
  cardano?: ClipCardanoWallet;
  substrate?: ClipSubstrateProvider;
```

Replace `const want = { evm: true, solana: true, bitcoin: true, ...config.providers };` with:

```ts
  const want = { evm: true, solana: true, bitcoin: true, cardano: true, substrate: true, ...config.providers };
```

Add this before `return out;` in `installOneMask`:

```ts
  if (want.cardano && config.networks.some((n) => n.family === "cardano")) {
    const c = installCardano(win, identity, transport);
    if (c) {
      out.cardano = c.wallet;
      stops.push(c.destroy);
    }
  }
  if (want.substrate && config.networks.some((n) => n.family === "substrate")) {
    const s = installSubstrate(win, identity, transport);
    if (s) {
      out.substrate = s.provider;
      stops.push(s.destroy);
    }
  }
```

Append these exports at the end:

```ts
export { ClipCardanoWallet, Cip30Error, CIP30_METHODS, APIErrorCode, TxSignErrorCode, DataSignErrorCode, TxSendErrorCode, cardanoWalletKey, installCardano, toCip30Error } from "./cardano.js";
export { ClipSubstrateProvider, SUBSTRATE_INPAGE_METHODS, installSubstrate, substrateExtensionName, caip2FromGenesis } from "./substrate.js";
```

## 6. `packages/config/src/index.ts` (turn the families on in `clip.config`)

```ts
export const NETWORK_FAMILIES = ["evm", "hedera", "solana", "bitcoin", "cardano", "substrate"] as const;
```

```ts
const NETWORK_PATTERN = /^(?:evm:(?:\*|[1-9]\d*|[a-z][a-z0-9-]*)|hedera|solana|bitcoin|cardano|substrate)$/;
```

Also update the regex error message on the `networks` array: `'use "evm:*", "evm:<chain id>", "hedera", "solana", "bitcoin", "cardano" or "substrate"'`.
Then add `"cardano", "substrate"` to `networks` in `apps/extension/clip.config.ts` when the build should ship them.

## 7. `apps/extension/package.json`

Add to `dependencies`:

```json
    "@clip-wallet/chains-cardano": "workspace:*",
    "@clip-wallet/chains-substrate": "workspace:*",
```

## 8. `apps/extension/src/shared/catalog.ts`

Add the imports:

```ts
import { CARDANO_NETWORKS } from "@clip-wallet/chains-cardano";
import { SUBSTRATE_NETWORKS, SUBSTRATE_SPECS, caip2Of } from "@clip-wallet/chains-substrate";
```

In `walletNetworks`, add to the `all` array (after the Bitcoin line):

```ts
    ...CARDANO_NETWORKS,
    ...SUBSTRATE_NETWORKS,
```

In `walletAssets`, inside the `for (const n of networks)` loop, add the curated Asset Hub assets:

```ts
    if (n.family === "substrate") {
      const spec = SUBSTRATE_SPECS.find((s) => caip2Of(s.genesisHash) === n.id);
      for (const a of spec?.assets ?? []) out.push({ key: a.key, symbol: a.symbol, name: a.name, decimals: a.decimals, networkId: n.id, address: String(a.id) });
    }
```

## 9. `apps/extension/src/background/wiring.ts`

Add the imports:

```ts
import { createCardanoModule } from "@clip-wallet/chains-cardano";
import { createSubstrateModule } from "@clip-wallet/chains-substrate";
```

Replace the real-build `chains:` line in `createDependencies`:

```ts
    chains: { evm: createEvmModule(), hedera, solana: createSolanaModule(), bitcoin: createBitcoinModule(), cardano: createCardanoModule(), substrate: createSubstrateModule() },
```

Add to the `DappHost` interface (after `rpc(...)`). This is the CIP-30 read path, which needs no approval:

```ts
  /** Read-only chain calls answered by a chain module (CIP-30 getUtxos/getBalance/…/submitTx). */
  chainRead(req: DappRequest): Promise<unknown>;
```

## 10. `apps/extension/src/background/service.ts` (`WalletService implements DappHost`)

Add the import:

```ts
import { CARDANO_READ_METHODS, type CardanoModule, type CardanoReadMethod } from "@clip-wallet/chains-cardano";
```

Add this method next to `async rpc(...)`:

```ts
  async chainRead(req: DappRequest): Promise<unknown> {
    const m = this.deps.chains.cardano as CardanoModule | undefined;
    if (req.family !== "cardano" || !m || !(CARDANO_READ_METHODS as readonly string[]).includes(req.method)) {
      throw new ClipError("This request isn't available.", "chain-read/unsupported");
    }
    return m.read(req.method as CardanoReadMethod, req.params, await this.ctx(req.networkId));
  }
```

The vault already signs Cardano with `derivationSubPath` (payment unset, stake `"2/0"`) and Substrate with sr25519
(context "substrate"), so the existing decode → approve → `vault.sign` → `finalize` path needs no change.
`registerApproval` must hash the payloads including `derivationSubPath` (the vault's `hashSignablePayload` does).

## 11. `apps/extension/src/background/real.ts` (`OneMaskConnector`)

Add the import:

```ts
import { CARDANO_METHODS_ALLOWED } from "@clip-wallet/1mask/background";
```

Replace `CONNECT_METHODS`:

```ts
const CONNECT_METHODS = new Set<string>(["eth_requestAccounts", "wallet_requestPermissions", "standard:connect", "bitcoin:connect", "cardano_enable", "substrate_enable"]);
const CHAIN_READ = new Set<string>(CARDANO_METHODS_ALLOWED.readOnly);
```

In `handle`, add this before `if (READ_ONLY.has(req.method)) …`:

```ts
        if (CHAIN_READ.has(req.method)) return host.chainRead(req);
```

## 12. `apps/extension/wxt.config.ts` (host permissions)

Koios's public tier is CORS-restricted, so the background needs host access. Substrate RPC endpoints allow CORS,
but list them so the build is explicit:

```ts
      host_permissions: [...rpHost, "https://*.koios.rest/*"],
```

(`rpHost` is the existing value; if it's a string, wrap it: `[rpHost, "https://*.koios.rest/*"]`.)

## 13. Mocks (fixture mode)

`apps/extension/src/background/mocks/mock-chains.ts` doesn't know these families. Fixture mode keeps working; it
just doesn't show Cardano or Polkadot until mocks are added.

## Checks after applying

Steps 1–11 were applied as written to a throwaway worktree of this branch: `pnpm typecheck`, `pnpm test` (all
packages) and `pnpm harness` passed. Step 12 depends on the current `rpHost` shape.

`pnpm install && pnpm typecheck && pnpm test && pnpm harness`. The 1Mask connector tests
(`packages/1mask/test/cardano-substrate.test.ts`) use a mini router built from the same helpers, so after step 2 a
router-level test can call `createOneMaskRouter` directly with `family: "cardano" | "substrate"`.
