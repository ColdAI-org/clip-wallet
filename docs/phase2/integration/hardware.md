# Integration: hardware wallets (stream "hardware", branch `p2/hardware`)

New in this branch (no wiring yet):

- `packages/hardware` (`@clip-wallet/hardware`): `HardwareKeyring`, `LedgerSigner`, `KeystoneSigner`,
  `KeystoneBridge`, and the browser half `@clip-wallet/hardware/qr` (camera, animated UR, Ledger USB permission).
  See its README.
- `packages/ui/src/hardware/*`: `ConnectHardware`, `HardwareSettings`, `HardwareApprovalGate`
  (`LedgerConfirm`, `KeystoneExchangeScreen`), `UrScanner`, `AnimatedQr`, the `HardwareClient` interface.
  Tests: `packages/ui/test/hardware.test.tsx`.
- `packages/core/src/index.ts`: additive `SignablePayload.raw?: RawSignable` (+ `RawFormat`, `RawSignable`).
- `packages/ui/package.json`: dependency `@clip-wallet/hardware` (the screens import only `@clip-wallet/hardware/qr`).

The steps below are for the integration step. Apply them in order; each block says the file and where.

---

## 1. Extension dependencies and browser globals

`apps/extension/package.json`, `dependencies`:

```json
"@clip-wallet/hardware": "workspace:*",
"buffer": "^6.0.3",
```

New file `apps/extension/src/shared/node-globals.ts`:

```ts
/** Ledger and Keystone libraries expect Node's Buffer as a global. Import first in every entry point. */
import { Buffer } from "buffer";
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
```

New file `apps/extension/src/shared/empty-module.ts`:

```ts
/** Stands in for Node's `crypto` and `stream`, which `hdkey` (via @keystonehq/bc-ur-registry-eth) requires for code we never call. */
export default {};
```

First line of `apps/extension/src/entrypoints/background.ts` and of `apps/extension/src/pages/mount.tsx`:

```ts
import "../shared/node-globals";
```

`apps/extension/wxt.config.ts`, inside `vite: () => ({ ... })`, add (and `import { fileURLToPath } from "node:url";` at the top):

```ts
    resolve: {
      alias: {
        crypto: fileURLToPath(new URL("./src/shared/empty-module.ts", import.meta.url)),
        stream: fileURLToPath(new URL("./src/shared/empty-module.ts", import.meta.url)),
      },
    },
```

No manifest permission is needed: WebHID and the camera prompt the user at run time. `navigator.hid.requestDevice()`
only works in a page (we call it on the Connect click); the service worker then reopens the granted Ledger with
`getDevices()` (<https://developer.chrome.com/docs/extensions/how-to/web-platform/webhid>). The camera must run in
a tab or the approval window (the action popup can't show the permission prompt), so the Keystone screens are
reached through `openFullTab` from the popup.

## 2. `apps/extension/src/background/wiring.ts`

Imports:

```ts
import { HardwareKeyring, KeystoneBridge, KeystoneSigner, LedgerSigner, type HardwareStorage } from "@clip-wallet/hardware";
```

`Dependencies` (add):

```ts
  /** Hardware accounts (Ledger, Keystone): public data, approval binding, device routing. */
  hardware: HardwareKeyring;
  ledger: LedgerSigner;
  keystone: { signer: KeystoneSigner; bridge: KeystoneBridge };
```

`WiringOptions` (add):

```ts
  /** Called when a Keystone exchange opens or closes, so the approval window re-fetches. */
  onHardwareChange?: () => void;
```

`createDependencies`, right after `const registry = new KnownDappRegistry();`:

```ts
  const hwStorage: HardwareStorage = { get: (k) => opts.kv.get<string>(k), set: (k, v) => opts.kv.set(k, v) };
  // Same network as the vault (testnet unless the vault is configured otherwise).
  const bitcoinNetwork = opts.vaultOptions?.bitcoinNetwork ?? "testnet";
  const keystoneBridge = new KeystoneBridge(() => opts.onHardwareChange?.());
  const keystone = new KeystoneSigner({ channel: keystoneBridge, storage: hwStorage, bitcoinNetwork });
  const ledger = new LedgerSigner({ bitcoinNetwork });
  const hardware = new HardwareKeyring({ signers: { ledger, keystone }, storage: hwStorage });
```

In **both** returned objects (fixture and real) add:

```ts
      hardware,
      ledger,
      keystone: { signer: keystone, bridge: keystoneBridge },
```

`apps/extension/src/background/main.ts`, in the `createDependencies({ ... })` call add
`onHardwareChange: () => env.broadcast(),` (the arrow only runs after `env` exists).

## 3. Messages: `apps/extension/src/shared/messages.ts`

Before `export const Request`:

```ts
const hwFamily = z.enum(["evm", "solana", "bitcoin", "hedera"]);
const pathStyle = z.enum(["standard", "ledger-live", "ledger-legacy"]);
const urJson = z.object({ type: z.string().regex(/^[a-z0-9-]{1,40}$/), cborHex: z.string().regex(/^[0-9a-f]*$/).max(200_000) }).strict();
const hwId = z.string().regex(/^hw:(ledger|keystone):[0-9a-f]{8}:[a-z]+:\d{1,10}(:ledger-live|:ledger-legacy)?$/);
```

Inside the `z.discriminatedUnion("type", [ ... ])` list:

```ts
  z.object({ type: z.literal("hwLedgerAccounts"), family: hwFamily, start: z.number().int().min(0).max(1000), count: z.number().int().min(1).max(20), pathStyle: pathStyle.optional() }),
  z.object({ type: z.literal("hwKeystoneImport"), ur: urJson }),
  z.object({ type: z.literal("hwKeystoneAccounts"), family: hwFamily, start: z.number().int().min(0).max(1000), count: z.number().int().min(1).max(20), pathStyle: pathStyle.optional() }),
  z.object({ type: z.literal("hwAddAccounts"), ids: z.array(hwId).min(1).max(50) }),
  z.object({ type: z.literal("hwListAccounts") }),
  z.object({ type: z.literal("hwRenameAccount"), id: hwId, label: z.string().max(60) }),
  z.object({ type: z.literal("hwForgetDevice"), kind: z.enum(["ledger", "keystone"]), fingerprint: z.string().regex(/^[0-9a-f]{8}$/) }),
  z.object({ type: z.literal("hwSetActive"), family: hwFamily, accountId: hwId.nullable() }),
  z.object({ type: z.literal("hwKeystoneAnswer"), id, ur: urJson }),
  z.object({ type: z.literal("hwCancel"), id }),
```

`ResponseMap` (types from `@clip-wallet/ui`: `import type { HardwareAccountView, HardwareFamilyView } from "@clip-wallet/ui";`):

```ts
  hwLedgerAccounts: HardwareAccountView[];
  hwKeystoneImport: { fingerprint: string; families: HardwareFamilyView[] };
  hwKeystoneAccounts: HardwareAccountView[];
  hwAddAccounts: void;
  hwListAccounts: HardwareAccountView[];
  hwRenameAccount: void;
  hwForgetDevice: void;
  hwSetActive: void;
  hwKeystoneAnswer: void;
  hwCancel: void;
```

## 4. Background routing: `apps/extension/src/background/service.ts`

Imports:

```ts
import type { Signature, SignablePayload } from "@clip-wallet/core";
import { HardwareErrors, urFromJson, type HardwareAccount, type HardwareFamily } from "@clip-wallet/hardware";
import type { HardwareAccountView } from "@clip-wallet/ui";
```

`K` (add): `activeHw: "clip/hardware/active",`

Class fields (add):

```ts
  /** Accounts the user was just shown on "Connect a hardware wallet"; hwAddAccounts adds from here. */
  private hwSeen = new Map<string, HardwareAccount>();
```

Helper constants (module level):

```ts
const LEDGER_APP: Record<string, string> = { evm: "Ethereum", solana: "Solana", bitcoin: "Bitcoin", hedera: "Hedera" };
```

### 4a. Which account a family uses

Today the service holds one account per family. A hardware account the user picks replaces the phrase account
for its family. At the end of the `for (const f of families)` loop in `afterUnlock()`:

```ts
    const active = (await this.kv.get<Partial<Record<Family, string>>>(K.activeHw)) ?? {};
    for (const [f, hwId] of Object.entries(active)) {
      const hw = hwId ? await this.deps.hardware.account(hwId) : undefined;
      if (hw && families.includes(f as Family)) this.accounts.set(f as Family, hw);
    }
```

(Ledger/Keystone accounts carry `hederaAccountId` themselves; the Hedera lookup that follows works on the
account as before once chains-hedera accepts Ed25519 accounts, §6.)

### 4b. `lock()`: add before `this.env.broadcast();`

```ts
    this.deps.hardware.lock();
    this.deps.keystone.bridge.cancelAll();
```

### 4c. `approve()`: route `sign()` by account

Replace the `try { ... }` / `catch` block that prepares and signs with:

```ts
    const hw = this.deps.hardware.owns(ctx.account.id);
    try {
      const payloads = await mod.prepare(req, ctx, id);
      if (hw) this.deps.hardware.registerApproval(id, payloads, APPROVAL_TTL_MS);
      else this.deps.vault.registerApproval(id, payloads.map((x) => hashSignablePayload(x)), APPROVAL_TTL_MS);
      const sigs = [];
      for (const payload of payloads) sigs.push(hw ? await this.signOnDevice(p, payload) : await this.deps.vault.sign(payload));
      result = await mod.finalize(req, sigs, ctx);
    } catch (e) {
      if (hw) this.deps.hardware.revokeApproval(id);
      else this.deps.vault.revokeApproval(id);
      throw e instanceof ClipError ? e : new ClipError("That didn't go through. Nothing left your balance.", "approval/failed", e);
    }
```

New method (next to `approve`):

```ts
  /** Hardware sign: tell the approval window which device step to show, then wait for the device. */
  private async signOnDevice(p: Pending, payload: SignablePayload): Promise<Signature> {
    const acct = await this.deps.hardware.account(payload.accountId);
    if (!acct) throw HardwareErrors.unknownAccount();
    if (acct.hardware.kind === "ledger") p.view.hardware = { kind: "ledger", stage: "confirm", app: LEDGER_APP[acct.family] ?? "right" };
    this.env.broadcast();
    try {
      return await this.deps.hardware.sign(payload, { request: p.request!, decoded: p.view.decoded! });
    } finally {
      p.view.hardware = undefined;
      this.env.broadcast();
    }
  }
```

A Keystone exchange is surfaced through `getApproval` (the bridge holds it while `sign()` waits). Replace the
`getApproval` case:

```ts
      case "getApproval": {
        const v = this.approvals.get(m.id)?.view ?? null;
        const x = v ? this.deps.keystone.bridge.current(m.id) : undefined;
        return v && x ? { ...v, hardware: { kind: "keystone", stage: "exchange", request: { type: x.type, cborHex: x.cborHex, expect: x.expect } } } : v;
      }
```

Errors from the device (`hw/rejected`, `hw/locked`, `hw/wrong-app`, …) are `ClipError`s with plain words; they reach
the approval screen through the existing `approve` error path, the request stays in the queue, and pressing Approve
again re-prepares (a new approval is registered each time).

### 4d. New bus cases (in the second `switch`, after `requireUnlocked`)

```ts
      case "hwLedgerAccounts":
      case "hwKeystoneAccounts": {
        const signer = m.type === "hwLedgerAccounts" ? this.deps.ledger : this.deps.keystone.signer;
        const list = await signer.listAccounts(m.family, m.start, m.count, { pathStyle: m.pathStyle });
        for (const a of list) this.hwSeen.set(a.id, a);
        return list.map((a) => this.hwView(a));
      }
      case "hwKeystoneImport": {
        const sync = await this.deps.keystone.signer.importSync(urFromJson(m.ur));
        const families = (["evm", "solana", "bitcoin"] as const).filter((f) =>
          sync.keys.some((k) => k.path.startsWith({ evm: "m/44'/60'", solana: "m/44'/501'", bitcoin: "m/84'" }[f])),
        );
        return { fingerprint: sync.fingerprint, families };
      }
      case "hwAddAccounts": {
        const picked = m.ids.map((x) => this.hwSeen.get(x)).filter((a): a is HardwareAccount => !!a);
        if (picked.length !== m.ids.length) throw HardwareErrors.unknownAccount();
        await this.deps.hardware.addAccounts(picked);
        // The first account added for a family becomes the one the wallet uses for it.
        const active = (await this.kv.get<Partial<Record<Family, string>>>(K.activeHw)) ?? {};
        for (const a of picked) if (!active[a.family]) active[a.family] = a.id;
        await this.kv.set(K.activeHw, active);
        await this.afterUnlock();
        return;
      }
      case "hwListAccounts": {
        const active = (await this.kv.get<Partial<Record<Family, string>>>(K.activeHw)) ?? {};
        return (await this.deps.hardware.accounts()).map((a) => ({ ...this.hwView(a), active: active[a.family] === a.id }));
      }
      case "hwRenameAccount":
        await this.deps.hardware.updateAccount(m.id, { label: m.label || undefined });
        this.env.broadcast();
        return;
      case "hwForgetDevice": {
        await this.deps.hardware.removeDevice(m.kind, m.fingerprint);
        if (m.kind === "keystone") await this.deps.keystone.signer.forget(m.fingerprint);
        const active = (await this.kv.get<Partial<Record<Family, string>>>(K.activeHw)) ?? {};
        for (const [f, hwId] of Object.entries(active)) if (hwId && !(await this.deps.hardware.account(hwId))) delete active[f as Family];
        await this.kv.set(K.activeHw, active);
        await this.afterUnlock();
        return;
      }
      case "hwSetActive": {
        const active = (await this.kv.get<Partial<Record<Family, string>>>(K.activeHw)) ?? {};
        if (m.accountId) {
          const a = await this.deps.hardware.account(m.accountId);
          if (!a || a.family !== m.family) throw HardwareErrors.unknownAccount();
          active[m.family] = m.accountId;
        } else delete active[m.family];
        await this.kv.set(K.activeHw, active);
        await this.afterUnlock();
        this.deps.dapps.accountsChanged?.();
        return;
      }
      case "hwKeystoneAnswer":
        this.deps.keystone.bridge.answer(m.id, m.ur);
        return;
      case "hwCancel":
        this.deps.keystone.bridge.cancel(m.id);
        await this.deps.ledger.close(); // aborts a pending Ledger exchange: sign() rejects, approve() throws
        return;
```

and the view helper:

```ts
  private hwView(a: HardwareAccount): HardwareAccountView {
    return {
      id: a.id,
      family: a.family as HardwareAccountView["family"],
      index: a.index,
      address: a.hederaAccountId ?? a.address,
      derivationPath: a.derivationPath,
      label: a.label,
      hardware: { kind: a.hardware.kind, fingerprint: a.hardware.fingerprint, pathStyle: a.hardware.pathStyle, deviceName: a.hardware.deviceName },
    };
  }
```

Note: `afterUnlock()` derives vault accounts, so these flows assume the phrase wallet exists (see §8).

## 5. UI wiring

### 5a. `packages/ui/src/client.ts`

`ApprovalView` (add the field):

```ts
  /** Set while a hardware wallet is signing this request (see packages/ui/src/hardware). */
  hardware?: import("./hardware/types").HardwareApprovalState;
```

`packages/ui/src/index.ts` (add): `export * from "./hardware";`

### 5b. Page-side clients: new file `apps/extension/src/shared/hardware-client.ts`

```ts
import type { HardwareApprovalClient, HardwareClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { BusError } from "./bus";
import { Envelope, type Request, type RequestType, type ResponseMap } from "./messages";

async function call<T extends RequestType>(msg: Extract<Request, { type: T }>): Promise<ResponseMap[T]> {
  const env = Envelope.safeParse(await browser.runtime.sendMessage(msg).catch(() => undefined));
  if (!env.success) throw new BusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
  if (!env.data.ok) throw new BusError(env.data.error.userMessage, env.data.error.code);
  return env.data.data as ResponseMap[T];
}

export const hardwareClient: HardwareClient & HardwareApprovalClient = {
  ledgerAccounts: (family, start, count, pathStyle) => call({ type: "hwLedgerAccounts", family, start, count, pathStyle }),
  keystoneImport: (ur) => call({ type: "hwKeystoneImport", ur }),
  keystoneAccounts: (family, start, count, pathStyle) => call({ type: "hwKeystoneAccounts", family, start, count, pathStyle }),
  addAccounts: (ids) => call({ type: "hwAddAccounts", ids }),
  listAccounts: () => call({ type: "hwListAccounts" }),
  renameAccount: (id, label) => call({ type: "hwRenameAccount", id, label }),
  forgetDevice: (kind, fingerprint) => call({ type: "hwForgetDevice", kind, fingerprint }),
  setActive: (family, accountId) => call({ type: "hwSetActive", family, accountId }),
  keystoneAnswer: (id, ur) => call({ type: "hwKeystoneAnswer", id, ur }),
  hardwareCancel: (id) => call({ type: "hwCancel", id }),
};
```

Pass it down: add `hardware?: HardwareClient & HardwareApprovalClient` to `WalletAppProps` and to the
`ApprovalWindowApp` props in `packages/ui/src/App.tsx`, and in `apps/extension/src/pages/mount.tsx` pass
`hardware={hardwareClient}` to both `<WalletApp …>` and `<ApprovalWindowApp …>`.

### 5c. Routes: `packages/ui/src/App.tsx`

In the `switch (seg[0])` of `Routes()` (props.hardware threaded through):

```tsx
    case "hardware":
      if (!hardware) return null;
      if (seg[1] === "connect")
        return variant === "popup" ? (
          <OpenInTab route="/hardware/connect" />
        ) : (
          <ConnectHardware hardware={hardware} advanced={state.prefs.advanced} onBack={() => navigate("/settings/hardware")} onDone={() => navigate("/", { replace: true })} />
        );
      return null;
```

and for settings, before `case "settings": return <Settings />;`:

```tsx
    case "settings":
      if (seg[1] === "hardware" && hardware) return <HardwareSettings hardware={hardware} onAdd={() => navigate("/hardware/connect")} />;
      return <Settings />;
```

`OpenInTab` is a three-line component: on mount call `client.openFullTab(route)` and `window.close()` (the popup can't
show the WebHID chooser or the camera prompt reliably).

### 5d. Settings entry: `packages/ui/src/screens/Settings.tsx`

In the "Security" section (next to the passkey row) add a row button: **"Hardware wallets"** → `navigate("/settings/hardware")`,
hint "Ledger or Keystone: keys stay on the device".

### 5e. Onboarding: `packages/ui/src/screens/Onboarding.tsx`

On the welcome step, below "Create a new wallet" / "I already have a wallet", add a ghost button
**"Connect a hardware wallet"**. It runs the normal password step (create), then shows
`<ConnectHardware hardware={hardware} onDone={finish} onBack={finish} />` instead of the backup-phrase step; the new
phrase stays available under Settings → Back up. (A hardware-only wallet without a phrase needs a vault that can hold
just a password; see §8.)

### 5f. Approval window: `packages/ui/src/App.tsx` → `ApprovalWindowApp`

Wrap the transaction approval:

```tsx
<HardwareApprovalGate
  approvalId={approval.id}
  title={approval.decoded?.title ?? ""}
  state={approval.hardware}
  client={hardware}
  onRetry={() => void client.approve(approval.id)}
>
  <TransactionApproval approval={approval} … />
</HardwareApprovalGate>
```

The window already re-fetches `getApproval` on every change broadcast, so it flips to "Confirm on your Ledger" while
`approve()` waits on the device, and to the Keystone QR exchange when the bridge opens one.

## 6. Chain modules: set `SignablePayload.raw`

Devices never sign a bare digest. Without these patches, Ledger/Keystone refuse EVM and Bitcoin requests with
"We can't send this … to your hardware wallet in a form it can show you". All additions are optional fields on the
payloads the modules already build; the vault ignores them.

### chains-evm (`packages/chains-evm/src/module.ts`, `prepare`)

```ts
// eth_sendTransaction, after `const digest = keccak256(serializeTransaction(tx));`
const raw = { format: "evm-tx" as const, bytes: hexToU8(serializeTransaction(tx)), chainId };
return [{ ...payload(ctx, digest, approvalId)[0]!, raw }];

// personal_sign / wallet_authenticate
const msgBytes = typeof message === "string" && message.startsWith("0x") ? hexToU8(message as Hex) : new TextEncoder().encode(String(message));
return [{ ...payload(ctx, digest, approvalId)[0]!, raw: { format: "evm-personal" as const, bytes: msgBytes } }];

// eth_signTypedData(_v4): send the FULL typed data, with EIP712Domain in `types` (Ledger requires it).
// Import getTypesForEIP712Domain from viem.
const full = { ...td, types: { EIP712Domain: td.types.EIP712Domain ?? getTypesForEIP712Domain({ domain: td.domain as never }), ...typedDataForHash(td).types } };
const json = JSON.stringify(full, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
return [{ ...payload(ctx, digest, approvalId)[0]!, raw: { format: "eip712" as const, bytes: new TextEncoder().encode(json) } }];
```

Signers check `keccak256(raw) == bytes` (tx), EIP-191 (personal) and `hashTypedData(JSON.parse(raw)) == bytes`
(typed data) before the device sees anything.

### chains-bitcoin (`packages/chains-bitcoin/src/module.ts`, `prepare`)

```ts
// PSBT branch: every input payload carries the whole PSBT and its input index
const psbtBytes = tx.toPSBT(0);
return digests.map((g) => {
  const p: SignablePayload = { accountId: ctx.account.id, scheme: g.kind === "tr" ? "schnorr-secp256k1" : "ecdsa-secp256k1", bytes: g.digest, approvalId,
    raw: { format: "psbt", bytes: psbtBytes, inputIndex: g.index } };
  if (g.kind === "tr") p.options = { taprootTweak: g.merkleRoot! }; // BIP-341 merkle root (empty for BIP-86)
  if (g.subPath) p.derivationSubPath = g.subPath;
  return p;
});

// message branch, protocol "ecdsa" (BIP-137) only:
raw: { format: "bitcoin-message", bytes: op.message }   // op.message is the message bytes bip137Digest() hashes
```

Recommended: keep `nonWitnessUtxo` on inputs when the dapp or our own builder has the previous transaction
(`buildPsbt`): the Ledger Bitcoin app warns about "unverified inputs" for segwit v0 inputs without it.
BIP-322 messages and taproot inputs are refused on hardware for now.

### chains-solana (`packages/chains-solana/src/module.ts`, `prepare`)

```ts
const n = normalize(request, me);
return list.map((s) => ({ accountId: ctx.account.id, scheme: "ed25519", bytes: s.bytes, approvalId,
  raw: { format: n.kind === "tx" ? "solana-tx" : "solana-message", bytes: s.bytes } }));
```

(Optional for Solana: without `raw` the signers infer the kind from the method. Ledger refuses message/sign-in
requests: its app signs only the off-chain envelope, which dapps verifying Wallet Standard `signMessage` reject.)

### chains-hedera (`packages/chains-hedera/src/module.ts`) — Ed25519 accounts

The Ledger Hedera app only has **Ed25519** keys (`m/44'/3030'/0'/0'/i'`); the vault's Hedera accounts are ECDSA.
To let Ledger Hedera accounts sign (and only then add `"hedera"` to `DEVICE_FAMILIES.ledger` in
`packages/ui/src/hardware/types.ts`):

1. `prepare()`: when `ctx.account.curve === "ed25519"`, payloads are `{ scheme: "ed25519", bytes: body, raw: { format: "hedera-body", bytes: body } }`
   (Ed25519 signs the TransactionBody bytes themselves, not a keccak digest). For ECDSA accounts add
   `raw: { format: "hedera-body", bytes: body }` next to the digest for future ECDSA devices.
2. `finalize()`: verify with `ed25519.verify(sig, body, publicKey)` and put the signature in `SignaturePair.ed25519`
   with `pubKeyPrefix` of the Ed25519 key.
3. Account id: an Ed25519 key has no EVM alias. Resolve `0.0.x` from the mirror node
   (`/api/v1/accounts?account.publickey=<hex>`); if none exists, receiving works through the HIP-32 public-key
   alias (transfer to the key alias auto-creates the account). `Account.address` stays `""` until then; screens show
   "New Hedera account".
4. `signMessage`: refuse for Ed25519 hardware accounts (the Ledger app signs only TransactionBody protobufs).
5. Bodies must be ≤ 251 bytes to fit the Ledger app's single APDU (`HEDERA_MAX_BODY`); the signer refuses larger ones
   with "This request is too big for your hardware wallet to show".

## 7. Tests to add during integration

- `apps/extension/test`: a service test with a `HardwareKeyring` whose `LedgerSigner` replays
  `packages/hardware/test/fixtures/ledger-evm-sign-tx.apdus` (see `packages/hardware/test/helpers.ts` `replay()`),
  driving `approve()` end to end for an EVM transfer once chains-evm sets `raw` (the recorded transaction is
  `packages/hardware/test/inputs.ts` `evmTx()`).
- `packages/chains-*/test`: assert `prepare()` sets `raw` and that `raw` hashes to `bytes`.

## 8. Known gaps / decisions for the integrator

- **One account per family.** The service model holds one account per family; a hardware account replaces the
  phrase account for its family (`hwSetActive`). A real account switcher is a features-stream item.
- **Hardware-only wallets.** `afterUnlock()` and the lock screen assume a phrase vault. A wallet with only hardware
  accounts needs a password-only vault mode (vault-v2 stream).
- **Service-worker lifetime.** A Keystone exchange can take a while; the approval window's pending `approve`
  message keeps the worker alive (Chrome allows up to 5 minutes per message response). If it is killed, the
  approval fails and can be retried.
- **Taproot.** Not supported on hardware yet. The Phase 1 mismatch noted here earlier is fixed (branch
  `fix/taproot`): `SignablePayload.options.taprootTweak` is the BIP-341 **merkle root** (empty array for BIP-86
  key-path spends), never the TapTweak scalar, and the signer computes t = H_TapTweak(P_x ‖ merkleRoot) from its own
  BIP-86 key. chains-bitcoin builds taproot scripts from `Account.taprootPublicKey` (the BIP-86 key
  m/86'/c'/0'/0/i), not `Account.publicKey` (BIP-84). Hardware accounts don't set `taprootPublicKey`, so
  chains-bitcoin treats no bc1p script as theirs and answers taproot requests with "taproot-unavailable"; the
  hardware signers keep refusing `schnorr-secp256k1`. A future Ledger `tr(@0/**)` signer must follow the same
  contract: fill `taprootPublicKey` from m/86'/c'/0'/0/i and treat `taprootTweak` as the merkle root. Covered end
  to end in `packages/vault/test/bitcoin-taproot-e2e.test.ts`.
- **Bitcoin messages on Keystone** (`btc-sign-request`) and **Solana messages on Ledger** are refused with plain words.
