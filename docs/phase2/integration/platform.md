# Integration: platform stream (p2/platform)

Everything in this stream is new files, plus decoder changes inside `packages/chains-{solana,hedera,evm}` and
`services/*` added to `pnpm-workspace.yaml` (with `workerd: true` under `allowBuilds`, needed by
`@cloudflare/vitest-pool-workers`). The lines below wire the new pieces into existing files. Apply them in
order; each block says which file and where.

New packages / services:

| path | what |
|---|---|
| `packages/backup-client` | `@clip-wallet/backup-client`: `BackupClient` + wire protocol (`/protocol`) |
| `packages/names` | `@clip-wallet/names`: `MultiNameResolver` (ENS / SNS / HNS) |
| `packages/media-client` | `@clip-wallet/media-client`: proxy URL builder + shared validation/sniffing |
| `services/backup` | Worker (D1 + R2), not deployed |
| `services/media-proxy` | Worker (Cache API + rate-limit binding), not deployed |
| `apps/extension/src/background/platform.ts` | `PlatformService` (backup, phrase flag, accounts, names) |
| `packages/ui/src/platform/{client,ceremony}.ts` | `PlatformClient` contract, `runCeremony` |
| `packages/ui/src/screens/{RecoveryPhrase,PasskeyBackup,Accounts}.tsx` | screens |

---

## 1. Dependencies (package.json)

`apps/extension/package.json` → `dependencies`, add:

```json
"@clip-wallet/backup-client": "workspace:*",
"@clip-wallet/names": "workspace:*",
```

`packages/ui/package.json` → `dependencies`, add:

```json
"@clip-wallet/media-client": "workspace:*",
```

Then `pnpm install`.

## 2. UI package

### `packages/ui/src/client.ts`

```ts
// top, with the other imports
import type { PlatformClient } from "./platform/client";
```

```ts
// change
export interface WalletClient {
// to
export interface WalletClient extends PlatformClient {
```

(After this, `asPlatform(client)` in the new screens is a no-op cast; it can stay.)

### `packages/ui/src/index.ts` — append

```ts
export * from "./platform/client";
export { runCeremony } from "./platform/ceremony";
export { RecoveryPhraseBackup, quizPositions } from "./screens/RecoveryPhrase";
export { PasskeyBackup, PasskeyRestore, PasskeyBackupExplainer, BackupSignIn, BackupLinkLanding } from "./screens/PasskeyBackup";
export { Accounts } from "./screens/Accounts";
```

### `packages/ui/src/App.tsx`

Imports (after `import { PasskeyPage } from "./screens/Passkey";`):

```ts
import { RecoveryPhraseBackup } from "./screens/RecoveryPhrase";
import { BackupLinkLanding, PasskeyBackup, PasskeyRestore } from "./screens/PasskeyBackup";
import { Accounts } from "./screens/Accounts";
```

Restore on a new device happens while the vault is **empty**, and the emailed link can land while empty or
locked. In `Routes()`, directly **before** `if (state.status === "empty" || onboarding) {` add:

```tsx
  if (pathname === "/restore/passkey" && (state.status === "empty" || onboarding)) {
    return <PasskeyRestore onDone={async () => { setOnboarding(false); await refresh(); navigate("/", { replace: true }); }} />;
  }
  if (pathname === "/backup/sign-in") return <BackupLinkLanding link={location.href} />;
```

In the `switch (seg[0])` (after `case "passkey":` …), add:

```tsx
    case "backup":
      if (seg[1] === "phrase") return <RecoveryPhraseBackup onDone={() => navigate("/settings", { replace: true })} />;
      return <PasskeyBackup />;
    case "accounts":
      return <Accounts {...(query.get("origin") ? { origin: query.get("origin")! } : {})} />;
```

### `packages/ui/src/screens/Onboarding.tsx` — welcome step

Under the "I already have a recovery phrase" button in `Welcome`:

```tsx
        <Button block variant="ghost" onClick={() => navigate("/restore/passkey")}>
          Restore with a passkey backup
        </Button>
```

(with `const { navigate } = useRouter();` at the top of `Welcome` and `useRouter` imported from `../context`).

### `packages/ui/src/screens/Settings.tsx` — "Security" section

Add rows linking to the new screens (inside the existing security `<Section>`):

```tsx
<Button block variant="secondary" onClick={() => navigate("/backup/phrase")}>Back up recovery phrase</Button>
<Button block variant="secondary" onClick={() => navigate("/backup/passkey")}>Back up with your passkey</Button>
<Button block variant="secondary" onClick={() => navigate("/accounts")}>Accounts</Button>
```

And in each connected-site row (sessions list) a link to the per-site picker:

```tsx
<Button variant="ghost" onClick={() => navigate(`/accounts?origin=${encodeURIComponent(s.dapp.origin)}`)}>Accounts</Button>
```

### `packages/ui/src/lib/media.ts` — use the shared proxy contract

Replace the body of `proxyMedia` (keep its signature, so `<NftMedia>` is unchanged):

```ts
import { mediaProxyUrl } from "@clip-wallet/media-client";

export function proxyMedia(raw: string | undefined, proxyBase: string | undefined): ProxiedMedia | null {
  return mediaProxyUrl(proxyBase, raw);
}
```

`packages/ui/src/theme/config.ts` doc comment for `mediaProxyUrl`: the URL shape is now
`${mediaProxyUrl}/v1/media?src=<canonical>&kind=image|video`. Existing UI test expectations of the old
`?url=` shape (`packages/ui/test/lib.test.tsx`, if any) move to `mediaProxyUrl` semantics.

## 3. Extension: bus messages

### `apps/extension/src/shared/messages.ts`

Imports: add `FAMILIES` to the `@clip-wallet/core` import (it is a value: `import { FAMILIES, type Nft } from "@clip-wallet/core";`)
and add `AccountView, ActiveAccounts, BackupStatusView` to the `@clip-wallet/ui` type import.

After `const b64url = …`:

```ts
const family = z.enum(FAMILIES as [string, ...string[]]);
const origin = z.string().url().max(500);
```

Append to the `Request` discriminated union (before the closing `]);`):

```ts
  z.object({ type: z.literal("backupStatus") }),
  z.object({ type: z.literal("backupStartSignIn"), email: z.string().min(3).max(254) }),
  z.object({ type: z.literal("backupCompleteSignIn"), link: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("backupSignOut") }),
  z.object({ type: z.literal("backupDelete"), id: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }),
  z.object({ type: z.literal("passkeyBackupBegin"), password }),
  z.object({ type: z.literal("passkeyRestoreBegin"), backupId: z.string().regex(/^[A-Za-z0-9_-]{22}$/), password }),
  z.object({ type: z.literal("markPhraseBackedUp") }),
  z.object({ type: z.literal("listAccounts") }),
  z.object({ type: z.literal("addAccount"), family }),
  z.object({ type: z.literal("renameAccount"), id, label: z.string().min(1).max(64) }),
  z.object({ type: z.literal("getActiveAccounts"), origin: origin.optional() }),
  z.object({ type: z.literal("setActiveAccount"), family, accountId: id.nullable(), origin: origin.optional() }),
  z.object({ type: z.literal("lookupName"), address: z.string().min(1).max(200), family, networkId: id.optional() }),
```

Append to `ResponseMap`:

```ts
  backupStatus: BackupStatusView;
  backupStartSignIn: void;
  backupCompleteSignIn: void;
  backupSignOut: void;
  backupDelete: void;
  passkeyBackupBegin: PasskeyCeremony;
  passkeyRestoreBegin: PasskeyCeremony;
  markPhraseBackedUp: void;
  listAccounts: AccountView[];
  addAccount: AccountView;
  renameAccount: void;
  getActiveAccounts: ActiveAccounts;
  setActiveAccount: void;
  lookupName: string | null;
```

### `apps/extension/src/shared/bus.ts` — in the `client` object

```ts
    backupStatus: () => call({ type: "backupStatus" }),
    backupStartSignIn: (p) => call({ type: "backupStartSignIn", ...p }),
    backupCompleteSignIn: (p) => call({ type: "backupCompleteSignIn", ...p }),
    backupSignOut: () => call({ type: "backupSignOut" }),
    backupDelete: (p) => call({ type: "backupDelete", ...p }),
    passkeyBackupBegin: (p) => call({ type: "passkeyBackupBegin", ...p }),
    passkeyRestoreBegin: (p) => call({ type: "passkeyRestoreBegin", ...p }),
    markPhraseBackedUp: () => call({ type: "markPhraseBackedUp" }),
    listAccounts: () => call({ type: "listAccounts" }),
    addAccount: (p) => call({ type: "addAccount", family: p.family }),
    renameAccount: (p) => call({ type: "renameAccount", ...p }),
    getActiveAccounts: (p) => call({ type: "getActiveAccounts", ...(p?.origin ? { origin: p.origin } : {}) }),
    setActiveAccount: (p) => call({ type: "setActiveAccount", ...p }),
    lookupName: (p) => call({ type: "lookupName", ...p }),
```

## 4. Extension: background

### `apps/extension/src/app-settings.ts` — append

```ts
/** services/backup base URL. Unset = passkey backup hidden ("isn't available in this version"). Not deployed yet. */
export const BACKUP_SERVICE_URL: string | undefined = undefined;
```

And when the media proxy is deployed: `export const MEDIA_PROXY_URL = "https://<media-proxy host>";`.

### `apps/extension/src/background/wiring.ts`

Imports:

```ts
import { BackupClient } from "@clip-wallet/backup-client";
import { MultiNameResolver } from "@clip-wallet/names";
import { BACKUP_SERVICE_URL } from "../app-settings";
```

In `WalletVault` (the interface), add:

```ts
  createPasskeyBackup(password: string, prfOutput: Uint8Array): Promise<Uint8Array>;
```

In `Dependencies`, add:

```ts
  /** services/backup client factory; null when no backup service is configured. */
  backup: ((session: { token: string; expiresAt: number } | null) => BackupClient) | null;
```

In both returned objects of `createDependencies`:

- fixture branch: `backup: null,`
- real branch:

```ts
    backup: BACKUP_SERVICE_URL ? (session) => new BackupClient({ baseUrl: BACKUP_SERVICE_URL!, session }) : null,
```

and replace `names: new NoNameResolver(),` with:

```ts
    names: new MultiNameResolver({ networks }),
```

(`NoNameResolver` in `real.ts` becomes unused; delete it.) `MultiNameResolver.resolve()` returns
`ResolvedName` (address, displayName **plus** `family`, `networkIds`, `addressOn`), which satisfies the existing
`NameResolver` interface; the next block uses the extra fields.

### `apps/extension/src/background/service.ts`

Imports:

```ts
import { PlatformService, type PlatformRequest } from "./platform";
```

Field + constructor (after `this.ceremonies = new PasskeyCeremonies(() => env.passkey());`):

```ts
  readonly platform: PlatformService;
  // in the constructor:
    this.platform = new PlatformService({
      vault: deps.vault,
      kv,
      ceremonies: this.ceremonies,
      ceremonyMeta: () => env.passkey(),
      backup: deps.backup,
      families: () => [...new Set(deps.networks.map((n) => n.family))],
      hederaAccountId: (account) => {
        const network = deps.networks.find((n) => n.family === "hedera");
        return network ? deps.hederaAccountId({ network, account, fetch: globalThis.fetch.bind(globalThis) }) : Promise.resolve(undefined);
      },
      names: deps.names as unknown as import("./platform").NameLookup,
      changed: () => {
        this.accounts.clear();
        this.deps.dapps.accountsChanged?.();
        env.broadcast();
      },
      onRestored: () => this.afterUnlock(),
    });
```

In `dispatch`, as the **first** statement (before the first `switch`): platform messages check their own
lock state (restore runs while the vault is empty):

```ts
    if (this.platform.handles(m.type)) return this.platform.handle(m as PlatformRequest);
```

Per-site active accounts — replace the body of `accountsFor`:

```ts
  async accountsFor(origin: string, family: Family): Promise<Account[]> {
    if (!(await this.permissions.has(origin, family))) return [];
    if (!(await this.isUnlocked())) return [];
    return [await this.platform.activeAccount(family, origin)];
  }
```

and make dapp requests sign with that account: in `ctx(networkId)` add an optional origin and use it:

```ts
  private async ctx(networkId: string, origin?: string): Promise<ChainContext> {
    const network = this.network(networkId);
    const override = (await this.prefs()).rpcOverrides[networkId];
    return {
      network: override ? { ...network, rpcUrls: [override, ...network.rpcUrls] } : network,
      account: origin ? await this.platform.activeAccount(network.family, origin) : await this.account(network.family),
      fetch: globalThis.fetch.bind(globalThis),
    };
  }
```

and pass `req.origin` at the call sites that handle dapp requests (`decode`/`prepare`/`finalize` for a
`DappRequest`: `await this.ctx(req.networkId, req.origin)`). Wallet-initiated sends keep `this.ctx(id)` (wallet
default account) — `account(family)` should return `this.platform.activeAccount(family)` too:

```ts
  private async account(family: Family): Promise<Account> {
    let a = this.accounts.get(family);
    if (!a) {
      a = await this.platform.activeAccount(family);
      this.accounts.set(family, a);
    }
    return a;
  }
```

Name resolution (Send): in `resolveRecipient`, widen the name test and use the network the name implies:

```ts
    const looksLikeName = /^[^\s/:]+\.(eth|sol|hbar|boo|cream)$/i.test(address);
    let implied: string[] = [];
    let addressOn: Record<string, string> = {};
    if (looksLikeName) {
      const hit = (await this.deps.names.resolve(address)) as (Awaited<ReturnType<typeof this.deps.names.resolve>> & { networkIds?: string[]; addressOn?: Record<string, string> }) | null;
      if (!hit) return { kind: "invalid", message: `We couldn't find ${address}. Check the spelling, or paste their address.` };
      address = hit.address;
      displayName = hit.displayName;
      implied = hit.networkIds ?? [];
      addressOn = hit.addressOn ?? {};
    }
```

then, right after `const candidates = …`:

```ts
    const narrowed = implied.length ? candidates.filter((n) => implied.includes(n.id)) : candidates;
```

and use `narrowed` instead of `candidates` for the rest of the function. When the chosen network has an
`addressOn[networkId]`, return that address instead (ENS per-chain record). In `send`, the background re-resolves
names: use `(hit.addressOn?.[m.networkId] ?? hit.address)`.

## 5. Vault (vault-v2, merged on main)

`PlatformService` codes against `PlatformVault` (`apps/extension/src/background/platform.ts`) and uses the
vault-v2 account API when present (it is, on main): `addAccount(family)`, `listAccounts(families)` (stored
accounts with labels) and `setAccountLabel(family, index, label)`. Without them it falls back to
`clip/account-counts` / `clip/account-labels` in KV; the `apps/extension/test/platform.test.ts` tests run
against the real `ClipVault` and so exercise the vault-v2 path.

Still requested from the vault owners (optional; there is a working fallback):

```ts
/** Decrypt a passkey backup and import it, without the phrase leaving the vault. */
restorePasskeyBackup?(blob: Uint8Array, prfOutput: Uint8Array, password: string): Promise<void>;
```

Without it the background decrypts with `passkeyBackup.decrypt` and calls `importPhrase` in the same
function (the path `importWallet` already takes). Add `addAccount`, `listAccounts`, `setAccountLabel` and
`createPasskeyBackup` to `WalletVault` in `wiring.ts` (ClipVault has them).

## 5b. Solana: staking and Jupiter Swap API v2 now decode — drop the features fallback

`@clip-wallet/chains-solana` now describes (not blind):

- **Native staking** (`src/stake.ts`): System `CreateAccountWithSeed` owned by the Stake program,
  `Initialize`, `DelegateStake`, `Deactivate`, `Withdraw`, in both the `@solana-program/stake` 0.10 layout
  (no sysvar accounts, what `packages/features/src/staking/solana.ts` builds) and the legacy layout with
  Clock / StakeHistory / StakeConfig accounts. Titles: "Stake 2 SOL with validator Abcd…wxyz" (the stake
  account's rent deposit is shown as "Opening cost", not in the staked amount), "Stop staking",
  "Withdraw 2 SOL from staking". Withdraw to someone else / a withdraw authority that isn't you → danger;
  lockups → caution; acting on a stake account you don't control, Split/Merge/Authorize → blind.
- **Jupiter Swap API v2** (`api.jup.ag/swap/v2/order` → `/execute`): the v6 program's `route_v2`,
  `exact_out_route_v2`, `shared_accounts_route_v2`, `shared_accounts_exact_out_route_v2` and its helper
  instructions `create_idempotent_associated_token_account` / `close_wsol_token_account` (layouts from the
  program's on-chain Anchor IDL). A typical order (create wSOL ATA → route_v2 → close wSOL) decodes to
  "Swap 2.5 USDC for at least 0.0099 SOL on Jupiter" (`test/swaps.test.ts`). Orders that Jupiter routes
  through **other programs** (its RFQ / third-party routers in the meta-aggregator) are not JUP6
  instructions and stay blind; the existing features fallback didn't accept those either (it only allowed
  JUP6 + system/token/ATA/compute-budget/memo).

So in `packages/features` (features stream owns these files; apply at integration):

`src/swap/jupiter.ts` — remove the `verify` line from the step and the `JUPITER_ALLOWED_PROGRAMS` export
(and its re-export in `src/swap/index.ts`):

```ts
-        verify: (r) => onlyPrograms(r, JUPITER_ALLOWED_PROGRAMS),
```

`src/staking/solana.ts` — remove `verifyStake` and the three `verify: verifyStake,` step fields.

`refineDecoded` (`src/steps.ts`) stays for the EVM 0x AllowanceHolder step, which still relies on it; the
Solana steps now arrive with `blind: false` and simply get their plain title. `test/staking.test.ts` keeps
its `onlyPrograms` unit test as long as `solana-verify.ts` exists; delete both if nothing else imports it.

## 6. Storage keys (chrome.storage.local)

| key | contents |
|---|---|
| `clip/backup-session` | `{ token, expiresAt, email }` — backup-service session (bearer token, not key material) |
| `clip/backup-pending` | `{ email, verifier, startedAt }` — PKCE verifier for an in-flight email sign-in, ≤ 15 min |
| `clip/phrase-backed-up` | timestamp of the last passed "I've written it down" check |
| `clip/account-counts` | `{ [family]: number }` |
| `clip/account-labels` | `{ [accountId]: label }` |
| `clip/active-accounts` | `{ defaults: { [family]: id }, origins: { [origin]: { [family]: id } } }` |

## 7. Services (when someone decides to deploy)

See `services/backup/README.md` and `services/media-proxy/README.md`. Set `BACKUP_SERVICE_URL` and
`MEDIA_PROXY_URL` in `app-settings.ts`, and add the extension origin to the backup Worker's `ALLOWED_ORIGINS`.
Passkey backups only restore on a device that can use the **same rpId**: configure `passkeys.rpOrigin` to an
https origin you own (web-bridge mode) before enabling backups, otherwise backups are tied to the extension id.

## 8. Checks after applying

```
pnpm install && pnpm typecheck && pnpm test && pnpm harness
```

New tests already in the tree: `packages/{media-client,names,backup-client}/test`, `services/*/test`
(workerd), `packages/chains-solana/test/swaps.test.ts`, `packages/chains-hedera/test/saucerswap.test.ts`,
`packages/chains-evm/test/l1fee.test.ts`, `packages/ui/test/platform.test.tsx`,
`apps/extension/test/platform.test.ts`.
