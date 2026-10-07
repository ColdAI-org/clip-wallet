# @clip-wallet/chains-icp

Internet Computer `ChainModule` for Clip Wallet: it sends ICP, ckBTC, ckUSDC and ckETH and never touches keys. It
implements the small part of the IC HTTPS interface it needs by hand: CBOR, request ids, signed envelopes, query and
update calls, read_state, and the Candid encoding of the ledger types.

It doesn't use `@dfinity/agent` at runtime. The runtime dependencies are `@noble/curves` (verification and point maths),
`@noble/hashes` and `@scure/base`. `@dfinity/agent`, `@dfinity/candid`, `@dfinity/principal` and
`@dfinity/identity-secp256k1` (2.4.x) are devDependencies; the tests use them to cross-check the bytes this module
produces.

## Networks

There is no public IC test network for ledger transfers. DFINITY instead runs test ledgers on mainnet, so Clip Wallet's
test network is mainnet restricted to those test ledgers: nothing of value can move on it.

| NetworkId | what | boundary node (`rpcUrls[0]`) | ledgers |
|---|---|---|---|
| `icp:test` (testnet flag) | IC mainnet, test ledgers only | https://icp-api.io | TESTICP `xafvr-biaaa-aaaai-aql5q-cai`, ckTESTBTC `mc6ru-gyaaa-aaaar-qaaaq-cai`, ckSepoliaUSDC `yfumr-cyaaa-aaaar-qaela-cai`, ckSepoliaETH `apia6-jaaaa-aaaar-qabma-cai` |
| `icp:737ba355e855bd4b61279056603e0550` | IC mainnet | https://icp-api.io | ICP `ryjl3-tyaaa-aaaaa-aaaba-cai`, ckBTC `mxzaz-hqaaa-aaaar-qaada-cai`, ckUSDC `xevnm-gaaaa-aaaar-qafnq-cai`, ckETH `ss2fx-dyaaa-aaaar-qacoq-cai` |

**Network ids.** ChainAgnostic/namespaces has no `icp` namespace yet.
- The mainnet id follows the open proposal (icvc/icp-namespace PR #1, which the identity working group lists as ON HOLD):
  "icp:" + the first 32 hex characters of SHA-256 of the IC root key. The root key is the DER key from `/api/v2/status`,
  and hashing it gives `737ba355…0550`.
- `icp:test` is Clip Wallet's own id and never leaves the wallet.

**Endpoints.** https://icp-api.io and https://ic0.app both answered `GET /api/v2/status` (CBOR, with the root key) on
2026-10-06, without a key.

**Ledgers and asset keys.**
- Canister ids come from dfinity/ic: `rs/nns/canister_ids.json`, `rs/bitcoin/ckbtc/*/canister_ids.json` and
  `rs/ethereum/cketh/*/canister_ids.json`.
- Every ledger's `icrc1_symbol`, `icrc1_decimals` and `icrc1_fee` were checked live with this module's own query client:
  - ICP: 8 decimals, fee 10,000
  - ckBTC: 8 decimals, fee 10
  - ckUSDC: 6 decimals, fee 10,000
  - ckETH: 18 decimals, fee 2,000,000,000,000
  - TESTICP: 8 decimals, fee 10,000
  - ckSepoliaUSDC: 6 decimals, fee 4,000
  - The fee is always read with `icrc1_fee` at send time, never hard-coded.
- ICP and TESTICP answer the ICP ledger's legacy `symbol` query, so they also take `transfer` to an account
  identifier. The ck ledgers don't.
- Asset keys:
  - ICP / TESTICP: `icp`, the native asset.
  - ckBTC / ckTESTBTC: `ckbtc`, bridged.
  - ckUSDC / ckSepoliaUSDC: `ckusdc`, bridged.
  - ckETH / ckSepoliaETH: `cketh`, bridged.
  - The chain-key twins never merge with BTC, USDC or ETH.

## Accounts and addresses

- **Derivation.** `derivationPath(i)` = `m/44'/223'/0'/0/i`, secp256k1. That's what Plug, `dfx identity import` and
  `@dfinity/identity-secp256k1` `fromSeedPhrase` use.
- **Address.** `Account.address` is the self-authenticating principal: SHA-224(DER SubjectPublicKeyInfo of the
  uncompressed key) ‖ 0x02, as principal text. For the fixtures, the "abandon … about" principal is `tgzar-…-aqe`.
- **`isAddress` accepts three forms:**
  - a principal, checksum checked;
  - an ICRC-1 account text, `<principal>-<checksum>.<subaccount>` (ICRC-1 `TextualEncoding.md`, all of its examples
    tested);
  - a 64-hex ICP account identifier, with its CRC-32 checked.
- **`accountIdOf(principal)`** gives the default account identifier. Exchanges ask for this to deposit ICP.

## Sending (`buildTransfer` → decode → prepare → finalize)

`buildTransfer({ asset, to, amount })` builds a ledger call.

**Methods.**
- To a principal (or an ICRC-1 account): `icrc1_transfer`, with arguments `{ to, amount, fee: [current fee], memo: [],
  created_at_time: [now], from_subaccount: [] }`.
- To an account identifier (ICP and TESTICP only): the ICP ledger's legacy `transfer`, with arguments `{ to: blob,
  amount: { e8s }, fee: { e8s }, memo: 0, created_at_time }`. Exchanges use this form.
- `created_at_time` turns on the ledger's de-duplication, so a call that gets re-sent isn't paid twice.

**Request shape.** The request uses ICRC-49's `icrc49_call_canister` params (`canisterId`, `sender`, `method`, `arg`
as base64 Candid, `nonce`) plus `ingressExpiry`: now + 4 minutes, in nanoseconds. Fixing the expiry before approval
means decode, prepare and finalize all see the same content. Only the wallet may send this method.

**Refusals.**
- Your own principal or account id → `icp/self-transfer`.
- An address that doesn't parse → `icp/bad-address`.
- An amount of zero → `icp/bad-amount`.
- A balance below the amount plus the fee → `icp/insufficient-funds`.
- An account id for a ck token → `icp/account-id-unsupported` ("ask for their principal ID").

**decode** reads the Candid bytes that will be signed. It never uses a separate summary, and it refuses anything that
doesn't re-encode to exactly the same bytes.
- It shows "Send 1.5 ICP to mnnk5…yqe", the full recipient, the memo if there is one, and the network fee, which is
  paid in the token itself.
- The balance change is amount + fee.
- An account-id recipient adds an info note: it's the kind of deposit address exchanges give, so check it matches
  exactly.
- An expired request is refused (`icp/expired`).

**prepare** returns two `ecdsa-secp256k1` payloads. Each is the 32-byte digest SHA-256("\x0Aic-request" ‖ request
id) (spec "Authentication"):
- one for the call;
- one for a single read_state request for `/request_status/<id>`. Only the call's sender may read that path, and the
  signed request can be re-sent until it expires, so polling needs no second approval.

**finalize** works in this order:
1. Both signatures are verified with `secp256k1.verify` against the account's key, and the key's principal must be the
   sender. A bad or missing signature → `icp/bad-signature`, and nothing is sent.
2. The CBOR envelope (`content`, `sender_pubkey` = DER key, `sender_sig` = 64-byte r‖s) goes to the synchronous
   `POST /api/v4/canister/<ledger>/call`.
3. A 200 response carries a certificate. A 202 means the call is still running: the signed read_state is sent to
   `POST /api/v3/canister/<ledger>/read_state` (default 10 × 1 s) until the status is `replied`, `rejected` or `done`.
4. The reply's Candid `TransferResult` is decoded.
   - `Ok` → `{ status: "replied", blockIndex, requestId, contentMap, certificate }`, the ICRC-49 response fields.
   - `Err` → a plain `ClipError` (`plainTransferError`): insufficient funds with the balance, the fee changed, too old,
     created in the future, duplicate, temporarily unavailable, or generic.
   - Rejected → `icp/rejected`.
   - Still processing after the last poll → `{ status: "pending" }`.

**Live check (2026-10-06).** A real signed `icrc1_transfer` from the unfunded "abandon … about" principal on the
TESTICP ledger was accepted by `icp-api.io`. The envelope, DER key, signature and request id all passed. The ledger
answered `Err InsufficientFunds`, which came back as "You don't have enough TESTICP…". Nothing moved.

### Certificates are NOT verified

Neither the `read_state` / call certificates (BLS over the state tree, with subnet delegations) nor the node
signatures on query responses are verified. Whatever a boundary node returns is a report, never proof:
- balances are for display only;
- `blockIndex` is what the node claimed.

Nothing in this module bases a security decision on a reply. The user approves the call the wallet itself encoded,
before anything is sent. Before using a reply as proof (for example, before crediting a deposit), verify the
certificate with `@dfinity/agent`'s `Certificate.create`.

## Balances and NFTs

- `getBalances` makes an anonymous `icrc1_balance_of` query (sender 0x04, `POST /api/v3/canister/<ledger>/query`) to
  every ledger of the network.
  - The native token is always listed.
  - The others are listed only when the account holds some.
  - Only the default subaccount is read.
- `getNfts` returns `[]`. There's no shared index of ICP NFTs (ICRC-7, EXT, DIP-721) to list them from.

## Dapp connectivity: send and receive only (no injected provider)

The standards a wallet extension would need aren't finalized. dfinity/wg-identity-authentication at `202e6df` (README
status table) lists:
- **APPROVED by the working group:** ICRC-21 (consent messages), ICRC-25 (signer interaction), ICRC-27 (accounts),
  ICRC-29 (window postMessage transport) and ICRC-49 (call canister). None of them is an NNS-approved "standard" yet.
- **DRAFT:** ICRC-94, "Browser Extension Discovery and Transport", is the only way an extension can be discovered under
  its own identity. It works through `icrc94:announceProvider` / `icrc94:requestProvider` events modelled on EIP-6963.

ICRC-94 is already wired up in some dapp libraries:
- `@nfid/identitykit` 2.0.0 calls `BrowserExtensionTransport.discover()` by default.
- `@slide-computer/signer-extension` and `@icp-sdk/signer` implement it.
- `@dfinity/oisy-wallet-signer` doesn't; it uses ICRC-29 popups only.

Even so, the brief is to implement a provider only on finalized standards. Plug's `window.ic.plug` is proprietary, and
we don't impersonate it.

**When ICRC-94 is accepted**, the provider would work like this:
- 1Mask announces Clip Wallet's own uuid, name, icon and rdns.
- The background answers ICRC-25 permissions and ICRC-27 accounts.
- ICRC-49 calls come in, with decode calling the target canister's ICRC-21 `icrc21_canister_call_consent_message`. The
  ICP ledger and every ck ledger advertise ICRC-21 through `icrc10_supported_standards`.
- `finalize` already returns ICRC-49's `contentMap` and `certificate`.

**Dapp matrix.**
- L0 (send and receive on `icp:test` with TESTICP) works today.
- L1 (connect) and L2 (sign/call) would use IdentityKit or `@icp-sdk/signer` (`BrowserExtensionTransport.discover()`,
  then `Signer.callCanister`, then `SignerAgent`, which verifies the certificate) once ICRC-94 is final. ICRC-32
  (sign challenge) is on hold, so L2 would be an ICRC-49 call, not a message signature.

## Faucets

- **TESTICP:** https://faucet.internetcomputer.org. No login and no captcha in the page. Each request gives 10
  TESTICP; you paste a principal (ICRC-1) or an account id. The page calls the faucet canister `nqoci-rqaaa-aaaap-qp53q-cai`.
- **ckTESTBTC:** needs Bitcoin testnet4 coins, sent to the ckBTC minter's testnet deposit address. Testnet4 faucets
  usually have captchas.
- **ckSepoliaETH / ckSepoliaUSDC:** Sepolia ETH or USDC deposited through the ckETH minter's Sepolia helper contract.

## Known gaps

- No injected provider (see above). No ICRC-21 consent messages yet: nothing needs them until there's a provider.
- Only the default subaccount is used to send and to read balances. You can send *to* any subaccount.
- Certificates aren't verified (see above).
- There's no transaction explorer link: the IC dashboard indexes ledger blocks by index, per ledger.

## Tests

`test/icp.test.ts` uses no network.
- Cross-checks:
  - the spec's request-id example;
  - `@dfinity/agent` `requestIdOf` (call and read_state), `Cbor.decode` (envelopes) and `lookup_path` (certificate
    trees);
  - `@dfinity/candid` `IDL.encode` (TransferArg, Account, legacy TransferArgs; decoding Ok / Err results);
  - `@dfinity/principal` and `@dfinity/identity-secp256k1` (public key → DER → principal);
  - the ICRC-1 textual-encoding examples.
- The send path runs against a mocked boundary node: the synchronous reply, the 202 → read_state path, a ledger error,
  a bad signature refused before sending, and every refusal.
- Signatures were precomputed offline from the public "abandon … about" vector (`test/signatures.ts`).

## Sources

- IC interface spec, HTTPS interface: https://internetcomputer.org/docs/references/ic-interface-spec/https-interface
  (call v4, read_state v3, query v3, authentication, request ids, representation-independent hashing)
- Certification (hash trees): https://internetcomputer.org/docs/references/ic-interface-spec/certification
- Candid spec: https://github.com/dfinity/candid/blob/master/spec/Candid.md
- ICRC-1: https://github.com/dfinity/ICRC-1/blob/main/standards/ICRC-1/README.md, TextualEncoding.md
- Ledger interfaces: https://github.com/dfinity/ic/blob/master/rs/ledger_suite/icp/ledger.did, https://github.com/dfinity/ic/blob/master/rs/ledger_suite/icrc1/ledger/ledger.did
- Chain-key canister ids: https://internetcomputer.org/docs/references/chain-key-canister-ids (and dfinity/ic `canister_ids.json`)
- Signer standards and status: https://github.com/dfinity/wg-identity-authentication (README; `topics/icrc_94_multi_injected_provider_discovery.md`, `icrc_49_call_canister.md`, `ICRC-21/`)
- CAIP-2 proposal: https://github.com/icvc/icp-namespace/pull/1
- TESTICP faucet: https://faucet.internetcomputer.org (developer docs `guides/digital-assets/rosetta.md`)
