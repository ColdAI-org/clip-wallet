# @clip-wallet/plugins — Clip Plugins

Small, sandboxed extensions for Clip Wallet. The idea is the same as MetaMask Snaps, but the scope is narrower and safety comes first.

**Off by default.** Plugins only run when Advanced mode is on and Settings → Advanced → Plugins is switched on. Turning either one off stops every plugin.

## What a plugin can do (v1)

| Capability | Manifest permission | What the user sees |
|---|---|---|
| Transaction insights | `"transactionInsight": true` | Its notes and warnings on the approval screen, in a separate card titled **From <plugin>** with "not checked by Clip Wallet" underneath |
| Name resolution | `"nameResolution": { "suffixes": [".label"] }` | In Send, the address shows with "(from <plugin>)" next to it. Built-in suffixes (`.eth`, `.sol`, `.hbar`) and common web TLDs can't be claimed |
| Notifications | `"notifications": true` | At most 3 an hour and 10 a day, each labelled "from <plugin>" |
| Network (optional) | `"network": ["https://api.example.com"]` | Up to 3 exact https origins. The host makes the request: GET only, no credentials, no redirects, 256 KB cap, 30 a minute |

A plugin can never sign, never see the recovery phrase, keys or the vault, and never reach storage or `chrome.*`. There is no permission for any of these, so a plugin can't even ask for them.

## How it's isolated (defence in depth)

1. **MV3 sandbox page, one iframe per plugin.** Chrome serves sandbox pages in a unique opaque origin with no extension APIs ("Sandboxed pages cannot access extension APIs": https://developer.chrome.com/docs/extensions/reference/manifest/sandbox). The page's CSP is `SANDBOX_CSP`:
   - `sandbox allow-scripts` and `default-src 'none'`
   - `script-src 'self' 'unsafe-eval'`
   - `connect-src 'none'`, plus no frames, workers, images, styles or forms

   Chrome requires the `sandbox` directive and forbids `allow-same-origin` there.
2. **SES inside the iframe.** `lockdown()` freezes the shared intrinsics. The bundle is then evaluated in a fresh `Compartment` whose global holds only `module`, `exports`, a hardened `clip` object with exactly the granted functions, and a no-op `console`. There is no `window`, `document`, `fetch`, `chrome`, storage, timers, `Date.now` or `Math.random`. SES rejects dynamic `import()` (https://github.com/endojs/endo/tree/master/packages/ses, `ses@2.3.0`).
3. **A schema-checked message channel.** zod, strict, size-capped. Both sides validate every message (`messages.ts`). Output strings may not contain control or bidi-override characters, so a plugin can't visually disguise an address.
4. **The host re-checks everything.** It verifies the stored bundle's sha256 before loading, calls only granted handlers, applies per-call timeouts (1.5 s; two misses and the plugin is stopped), and labels everything with the plugin's name.

**Does SES fit MV3?** Yes, inside the sandbox page. MV3 extension pages forbid `unsafe-eval`, which SES compartments need, but MV3 sandbox pages allow it. That is exactly why the plugin runs in the sandbox page and never in an extension page. MetaMask runs Snaps the same way: SES inside an isolated iframe (https://docs.metamask.io/snaps/learn/about-snaps/execution-environment/).

**What SES doesn't stop:** an infinite loop or a huge allocation. That's why the host lives in an **offscreen document** (`chrome.offscreen`, reason `IFRAME_SCRIPTING`) rather than in the approval popup. A plugin that hangs can only freeze that document, and the background's timeout closes it.

## Install (from npm, with checks)

`prepareInstallFromNpm(name)` runs these steps before the user sees anything:

1. Fetch the registry's abbreviated metadata.
2. Check that the tarball is on the registry origin.
3. Check its SHA-512 against npm's `dist.integrity`.
4. Gunzip and untar it in memory.
5. Check that `package.json` names the same package and version.
6. Validate `clip.plugin.json`.
7. Check the bundle's sha256 against the manifest.

It runs nothing. The UI then shows the plain-language permission prompt (`describePermissions`), and only `confirmInstall(id, version)` stores the plugin.

## Manifest (`clip.plugin.json`)

```json
{
  "manifestVersion": 1,
  "name": "Address labels",
  "version": "1.0.0",
  "author": "Clip Wallet examples",
  "description": "Names well-known addresses, like the burn address, in requests you approve.",
  "permissions": { "transactionInsight": true },
  "bundle": { "path": "dist/bundle.js", "sha256": "<sha256 of the bundle, hex>" }
}
```

The bundle is a plain script that sets handlers on `module.exports`:

```js
module.exports.onTransaction = async ({ request }) => ({ lines: [{ label: "Address", value: "Burn address" }], warnings: [] });
module.exports.onNameLookup = async ({ name }) => ({ address: "0x…", family: "evm" }); // or null
```

`request` is a reduced, hardened copy of the DecodedRequest: origin, title, lines, balance changes, network id and the account's public address. Output limits:

- up to 5 lines (label ≤ 40 characters, value ≤ 200)
- up to 3 warnings (`info` / `caution` / `danger`)

Example: `examples/address-label/` (insight only: names the zero/burn address and the Solana incinerator, with a warning).

## Tests

`pnpm --filter @clip-wallet/plugins test` (each file in its own process, because `lockdown()` freezes the realm):

- `isolation.test.ts` runs plugin code under real SES through the real runtime. It shows the plugin can't see the host's `chrome`, `browser`, `localStorage`, `indexedDB` or vault decoys, or any DOM, network, timer or Node global. It also shows:
  - no escape via `Function`, `eval` or constructor chains
  - prototype pollution throws
  - `import()` is refused
  - network goes only to the declared origins, and only the granted handlers are called
  - tampered bundles are refused
  - bad output is dropped, and labels are always applied
  - timeouts and the notification rate limit hold
- `install.test.ts` covers:
  - manifest rules
  - npm install happy path and each refusal: integrity, non-sha512, bundle hash, foreign tarball host, package identity, bad manifest, bad name
  - message schemas
  - the sandbox CSP
  - registry gating (off by default, Advanced only, explicit confirm for the exact version)
- `example.test.ts` covers the address-label plugin end to end through `HostBridgeServer`.

- `portable.test.ts` covers the install path without WebCrypto, DecompressionStream or a strict TextDecoder (React Native).

Not covered by unit tests: the real iframe/offscreen wiring in Chrome (see `extension/` templates and docs/phase25/integration/extensibility.md).

## On the phone

`apps/mobile/src/plugins` runs the same runtime in one hidden `react-native-webview` per plugin: an inline SES page at about:blank with a no-network CSP, react-native-webview's `postMessage` as the only bridge (schema-checked both ways), and the same `PluginHost`/`PluginRegistry`. Hashes use `@noble/hashes` and gunzip is injectable (`NpmOptions.gunzip`), because Hermes has neither WebCrypto nor DecompressionStream. Details and device-only checks: docs/phase25/integration/mobile-parity.md.
