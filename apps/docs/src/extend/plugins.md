# Write a plugin

A Clip Plugin is a small script, published to npm, that can add notes to the requests people approve, resolve names
in Send, show a few notifications and reach up to three https origins. It runs in a sandbox with nothing else: no keys,
no signing, no storage, no browser APIs. How the sandbox works: [Plugins](../architecture/plugins.md).

::: info Who sees it
Plugins run only when the person has turned on Advanced mode and Settings → Advanced → Plugins. Everything a plugin
says is labelled with its name and "not checked by Clip Wallet".
:::

## The package

```text
clip-plugin-address-labels/
  package.json          "name", "version" (must equal the manifest's), "files": ["clip.plugin.json", "dist/bundle.js"]
  clip.plugin.json      the manifest
  dist/bundle.js        one plain script
```

## The manifest

<<< @/snippets/extend/plugin-manifest.json

| Field | Rules |
| --- | --- |
| `manifestVersion` | `1` |
| `name` | up to 40 characters, no hidden characters; shown on everything the plugin says |
| `version` | semver, equal to `package.json`'s |
| `author`, `description` | up to 80 and 200 characters |
| `permissions` | at least one capability (below) |
| `bundle.path` | a `.js` file inside the package, a plain relative path |
| `bundle.sha256` | 64 lowercase hex characters: the sha256 of the bundle (`shasum -a 256 dist/bundle.js`) |

## Permissions

| Permission | Lets the plugin | The person sees |
| --- | --- | --- |
| `"transactionInsight": true` | add notes and warnings to requests being approved (`onTransaction`) | a card titled `From <plugin name>`, "not checked by Clip Wallet" |
| `"nameResolution": { "suffixes": [".label"] }` | answer names ending in up to 3 suffixes (`onNameLookup`) | the address with `(from <plugin name>)` in Send |
| `"notifications": true` | `clip.notify(text)`: at most 3 an hour and 10 a day | each one labelled with the plugin's name |
| `"network": ["https://api.example.com"]` | `clip.fetch(url)` to up to 3 exact https origins | listed in the install prompt |

Built-in name suffixes (`.eth`, `.sol`, `.hbar`) and common web TLDs (`.com`, `.io`, `.app`, …) can't be claimed.
Network origins must be real host names: no IP addresses, no `localhost` or `.local`. Requests are GET only, with no
credentials or redirects, a 256 KB cap and 30 a minute.

There is no permission for signing, keys, the phrase, storage or `chrome.*`: they don't exist in the plugin's world.

## The bundle

The bundle is one plain script that sets handlers on `module.exports`:

<<< @/snippets/extend/plugin-bundle.js

`request` is a reduced copy of the decoded request: `origin`, `title`, `lines`, `balanceChanges` (`{ asset, delta }`),
`networkId` and the account's address. Never the raw payload.

| Output | Limits |
| --- | --- |
| `lines` | up to 5; `label` up to 40 characters, `value` up to 200 |
| `warnings` | up to 3; `level` is `info`, `caution` or `danger`; `message` up to 200 |
| text | no control or bidi-override characters (output that has them is dropped) |

Each call gets 1.5 seconds; two timeouts and the plugin is stopped.

### In TypeScript

Type your handlers with the schemas the wallet validates against, and compile to one CommonJS-style script:

<<< @/snippets/extend/plugin-typed.ts

### Network and notifications

With those permissions, the sandbox's `clip` object has `fetch` and `notify`. Nothing else is there: no `window`,
`fetch`, timers, `Date.now` or `Math.random`.

<<< @/snippets/extend/plugin-network.ts

## Check it before you publish

The wallet validates the manifest and shows the install prompt from it. Do the same:

<<< @/snippets/extend/check-manifest.ts

## How installing works

The person types the npm package name in Settings → Advanced → Plugins. Before they see anything, the wallet:

1. fetches the registry metadata and checks the tarball comes from the registry;
2. checks its SHA-512 against npm's `dist.integrity`;
3. unpacks it in memory and checks `package.json` names the same package and version;
4. validates `clip.plugin.json` and the bundle's sha256.

Nothing runs until the person reads the permissions in plain words and confirms that exact version. A wallet holds at
most 10 plugins.

## Test it

`@clip-wallet/plugins` exports what the wallet uses: `parseManifest`, `describePermissions`, the input and output
schemas (`InsightInputSchema`, `InsightOutputSchema`, `NameOutputSchema`) and `createSandboxRuntime`, which the
package's own tests run under real SES. The example plugin in
[`packages/plugins/examples/address-label`](repo:packages/plugins/examples/address-label) is tested end to end.
