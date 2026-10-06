# @clip-wallet/core

The shared contract between Clip Wallet packages: networks and assets, accounts, the `Vault` and `ChainModule`
interfaces, `DappRequest` → `DecodedRequest`, `SignablePayload`, warning and error codes, and `ClipError` (a plain-words
`userMessage` plus a stable `code`). Types and a few helpers; no runtime dependencies.

Everything else in the kit agrees on these types. Changes are additive only: a field is never renamed or removed in a
minor version.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/core
```

## Example

```ts
import { ClipError, FAMILIES, displaySafe, errorMsg, type DecodedRequest } from "@clip-wallet/core";

console.log(FAMILIES.length); // 14 network families

// Errors carry plain words for people and a stable code for programs.
const error = new ClipError("You don't have enough SOL to pay the network fee.", "solana/insufficient-funds");
console.log(error.userMessage, error.code, errorMsg(error)?.id); // the translatable message, when there is one

// What an approval screen shows, with invisible and direction-changing characters removed.
export function titleOf(decoded: DecodedRequest): string {
  return decoded.blind ? "This request can't be read" : displaySafe(decoded.title);
}
```

## Documentation

- [Architecture overview](https://coldai.org/clip/docs/architecture/)
- [The signing flow](https://coldai.org/clip/docs/architecture/signing-flow.html)
- [Error codes](https://coldai.org/clip/docs/reference/errors.html)
- [Warning codes](https://coldai.org/clip/docs/reference/warnings.html)
- [API reference](https://coldai.org/clip/docs/reference/api/core.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
