# @clip-wallet/security

The security features people expect from a modern wallet, as background services. Pure logic, no keys: every action
is a `DappRequest` on the normal approval path (decode, approve, vault signs). Screens live in
`packages/ui/src/security/`.

| Area | Module | What it does |
|---|---|---|
| App permissions | `approvals/` | Lists every standing permission and revokes the chosen ones in one tap: EVM ERC-20 allowances, ERC-721/1155 `setApprovalForAll`, Permit2 allowances; Solana SPL / Token-2022 delegates; Hedera HBAR, token and NFT allowances. Risk flags: unlimited, unknown app, old, never used, on a scam list. |
| Scam detection | `threat/` | `ThreatIntelProvider` interface, consulted on connect and after decode. Open lists (MetaMask, ScamSniffer, Phantom, PolkadotJS), local heuristics (look-alike recipients, zero-value poisoning, new contracts), and optional Blockaid scanning. WalletConnect Verify stays in 1Mask; our lists feed its `isKnownScam`. |
| Spam cleanup | `cleanup/` | Solana: close empty token accounts and burn + close spam (rent comes back). Hedera: dissociate unused and deleted-spam tokens. Everything else: hide on this device. |
| Bus | `messages.ts`, `background.ts` | zod-validated `sec*` messages and `SecurityService.handle()`. |

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/security
```

## Example

The security floor has no switch. A mainnet configuration that tries to lower it is refused:

```ts
import { securityFloorProblems } from "@clip-wallet/security";

console.log(securityFloorProblems({ testnet: false, threat: { openLists: false } }));
// ["threat.openLists: the open phishing lists can't be switched off on mainnet"]
```

## Documentation

- [Security services](https://coldai.org/clip/docs/architecture/security.html)
- [Phishing and scam checks](https://coldai.org/clip/docs/security/scam-checks.html)
- [Add a scam-check source](https://coldai.org/clip/docs/extend/threat-provider.html)
- [API reference](https://coldai.org/clip/docs/reference/api/security.html)

## Privacy

| Source | What leaves the device |
|---|---|
| Open lists | Only a download of the list file from raw.githubusercontent.com (GitHub sees your IP). Matching runs locally. No site, address or request is sent. |
| Local heuristics | Nothing, except the new-contract check: it asks the network's Blockscout about the **contract** being called (`/api/v2/addresses/{contract}`, then that contract's creation transaction). Never your address. Cached. |
| Permission scan | Your address goes to the same RPC / Blockscout / Hedera mirror node / Solana RPC the wallet already uses for balances. Nothing goes to a third party. |
| Blockaid | **Off unless an API key is configured.** When on, the site, the full transaction and your address go to `api.blockaid.io` for every request you review. Settings → Security says so. |

Warning codes added to `@clip-wallet/core` (additive): `phishing-site`, `address-poisoning`,
`malicious-transaction`. New contracts reuse `new-recipient` (caution).

## Verified sources (2026-10-03)

**EVM permissions**
- ERC-20 `Approval(address indexed owner, address indexed spender, uint256 value)`, `allowance`, `approve`: EIP-20.
  ERC-721 `Approval` shares the signature but has 4 topics (tokenId indexed): EIP-721.
- `ApprovalForAll(address indexed owner, address indexed operator, bool approved)`, `isApprovedForAll`,
  `setApprovalForAll`: EIP-721 and EIP-1155.
- Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`, same address on every chain): `Approval(owner, token,
  spender, uint160 amount, uint48 expiration)`, `Permit(…, uint48 nonce)`, `allowance(user, token, spender) →
  (amount, expiration, nonce)`, `lockdown(TokenSpenderPair[])`:
  https://github.com/Uniswap/permit2/blob/main/src/interfaces/IAllowanceTransfer.sol
- Blockscout Etherscan-compatible logs, tried live on eth-sepolia.blockscout.com:
  `GET /api?module=logs&action=getLogs&fromBlock=0&toBlock=latest&topic0=…&topic1=…&topic0_1_opr=and[&address=…]`
  (1000 results per page). Contract creation: `GET /api/v2/addresses/{hash}` → `is_contract`,
  `creation_transaction_hash`; `GET /api/v2/transactions/{hash}` → `timestamp`.
- Fallback: `eth_getLogs` with an OR of topic0s and owner as topic1, in block chunks.
- Spender names: chains-evm `KNOWN_APPS`, plus SwapRouter02, SwapRouter, Uniswap V3 Positions NFT, Seaport 1.5,
  the OpenSea Conduit, 1inch AggregationRouterV5, 0x AllowanceHolder, CoW GPv2VaultRelayer and LiFiDiamond. Each
  was checked against its verified contract name on eth.blockscout.com.

**Solana**
- `getTokenAccountsByOwner` (jsonParsed) for both token programs; `delegate`, `delegatedAmount`, `state`,
  `isNative`: https://solana.com/docs/rpc/http/gettokenaccountsbyowner
- Token instructions `Revoke` (5), `CloseAccount` (9), `BurnChecked` (15), built with `@solana-program/token`
  0.17 and pointed at Token-2022 with `programAddress` (same layouts): https://github.com/solana-program/token
- Rent-exempt deposit: https://solana.com/docs/core/accounts (≈0.00204 SOL for a 165-byte account; we always show
  the account's actual lamports).

**Hedera**
- Mirror node `/api/v1/accounts/{id}/allowances/crypto|tokens|nfts` (`amount` = remaining,
  `amount_granted`, `approved_for_all`, `timestamp`): https://testnet.mirrornode.hedera.com/api/v1/docs/openapi.yml
- HIP-336 allowances; at most 20 per transaction: `allowances.maxTransactionLimit` default 20 in
  hiero-consensus-node `hedera-config/.../HederaConfig.java`.
- `TokenDissociate` needs a zero balance for active tokens (`TRANSACTION_REQUIRES_ZERO_TOKEN_BALANCES`,
  `ACCOUNT_STILL_OWNS_NFTS`), refuses frozen relations, and is allowed for deleted tokens:
  hiero-consensus-node `TokenDissociateFromAccountHandler.java`.

**Aptos / Sui (no allowance concept)**
- Aptos Fungible Asset standard: https://aptos.dev/build/smart-contracts/fungible-asset (no approve/allowance;
  withdrawals need the owner's signer). AIP-103 permissioned signer: https://github.com/aptos-foundation/AIPs/issues/527
  (removed from the framework before user rollout).
- Sui object ownership: https://docs.sui.io/concepts/object-ownership (only the owner's transaction moves an
  owned object).

**Open lists**
- MetaMask: https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json
  (`{ version, tolerance, fuzzylist, whitelist, blacklist }`, ~102k blacklisted domains on 2026-10-03). Matching
  follows `PhishingDetector` in https://github.com/MetaMask/core/tree/main/packages/phishing-controller
  (allowlist, then blocklist with subdomains, then Levenshtein ≤ tolerance on the domain without its TLD).
- ScamSniffer: https://github.com/scamsniffer/scam-database (`blacklist/domains.json`, `blacklist/address.json`;
  daily, with a 7-day delay on the open copy).
- Phantom: https://github.com/phantom/blocklist (`blocklist.yaml`, `- url: <domain>`).
- PolkadotJS: https://github.com/polkadot-js/phishing (`all.json` `{ allow, deny }`, `address.json`).

**Blockaid**
- Endpoints, `X-API-Key` header, request and response fields from the official client
  https://github.com/blockaid-official/blockaid-client-node (`api.md`, `src/client.ts`, `src/resources/*`); the
  hosted reference at docs.blockaid.io needs a login. `POST /v0/site/scan`, `/v0/evm/transaction/scan`,
  `/v0/evm/json-rpc/scan`, `/v0/solana/message/scan`; verdict `validation.result_type`.

## Tests

`pnpm --filter @clip-wallet/security test`: fixtures and mocked fetch only. No keys and no signing. The tests
check list parsing and matching, caching and refresh, the privacy contract (which requests carry your address),
Blockaid on and off, the heuristics, the permission scan for each family (Blockscout, the `eth_getLogs`
fallback, Solana and the Hedera mirror), the revoke transactions (decoded back from their bytes), and cleanup
(the Solana close and burn instructions, Hedera dissociate, hide).

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
