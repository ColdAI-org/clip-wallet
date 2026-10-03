# ClipHandles

Opt-in handles for Clip Wallet: `@alex` (also written `alex.clip`) points to the addresses Alex chose to publish,
one per network family (`evm`, `solana`, `hedera`, `bitcoin`, …). The registry is a small Solidity contract on
Hedera's EVM. The wallet reads it through `@clip-wallet/names` (`ClipHandlesBackend`) and writes to it with
ordinary Hedera `ContractExecuteTransaction`s that the user approves (`@clip-wallet/social`, `handles/publish.ts`).

**Not deployed.** This repo holds no keys. The steps below are for whoever deploys it, with their own key.

## Rules the contract enforces

| | |
|---|---|
| Handle syntax | 3–32 characters from `[a-z0-9-]`, starting and ending with a letter or digit, no `--`. ASCII only, so a look-alike Unicode handle (`аlex` with a Cyrillic `а`) can't exist. Clients lowercase before calling. |
| Owner | `msg.sender` of `register`: the caller's Hedera account, as its EVM address (for an ECDSA account, the "EVM address from public key"; see [Accounts, signature verification and keys](https://docs.hedera.com/evm/differences/accounts-and-keys.md)). |
| One per owner | An account holds at most one handle. Handles can't be transferred, only released. |
| Records | Up to 16 families. Family ids: `[a-z0-9-]`, 1–16 characters. Values: printable ASCII without spaces, 1–128 bytes, so no bidi-override or zero-width tricks. An empty value removes the record. Clients still check every value with the family's own address rules (`ChainModule.isAddress`) before using it. |
| Release cooldown | After `release()`, only the previous owner can claim the handle again for 30 days. Someone hoping to catch payments meant for the old owner can't grab it straight away. |
| Reverse lookup | `handleOf(owner)` only answers after the owner calls `setReverse(true)`. Wallets show `@alex` next to an address only when it is also one of the handle's published records (the forward check in `ClipHandlesBackend.reverse`). `ownedHandle(owner)` always answers; ownership is public anyway through the `Registered` events. |

Publishing several addresses under one handle links them to each other, publicly and permanently. Removing a
record later doesn't erase its history. Before anything is published, the wallet shows this warning and requires
an explicit "I understand", and the approval carries a `public-record` warning.

## Interface

```solidity
function register(string handle);
function setAddress(string family, string addr);           // "" removes
function setAddresses(string[] families, string[] addrs);   // batch, same rules
function release();
function setReverse(bool enabled);

function recordsOf(string handle) view returns (address owner, uint64 registeredAt, uint64 updatedAt, string[] families, string[] addrs);
function addressOf(string handle, string family) view returns (string);
function ownerOf(string handle) view returns (address);
function ownedHandle(address owner) view returns (string);
function handleOf(address owner) view returns (string);     // honours the reverse opt-in
function isAvailable(string handle) view returns (bool);    // valid, free, not cooling down
function isValidHandle(string handle) pure returns (bool);
```

The ABI is committed in `abi/ClipHandles.json`. `packages/names/test/clip.test.ts` checks that the resolver's ABI
matches it.

## Test

```sh
cd contracts/handles
forge test            # 15 tests, including two fuzz tests (512 runs each)
forge test --gas-report
```

There are no git submodules. The handful of Foundry cheatcodes the tests use are declared in `test/utils/Test.sol`.

Gas from `forge test --gas-report`. Hedera charges only the gas actually used and refunds the rest of the limit
([gas and fees](https://docs.hedera.com/evm/development/gas-fees.md), "Gas Reservation and Unused Gas Refund"):

| Function | Typical gas | Max gas in the tests |
|---|---|---|
| `register` | ~120k | ~121k |
| `setAddress` | ~30k (update) | ~154k (first record) |
| `setAddresses`, 2 records | ~90k | ~157k |
| `release` | ~24k | ~98k |

The wallet's gas limits (`handleGas` in `packages/social/src/handles/publish.ts`) are sized from this table with
headroom. Unused gas is refunded, so the headroom costs nothing.

## Deploy to Hedera testnet

The compiler target is solc 0.8.28 with `evm_version = "cancun"`. Hedera runs the Prague EVM without EIP-7702 and
without blobs ([Deploying smart contracts](https://docs.hedera.com/evm/development/deploying.md)), so Cancun
bytecode is a safe subset. Testnet facts: chain id 296, public JSON-RPC relay `https://testnet.hashio.io/api`
([Add Hedera to MetaMask](https://docs.hedera.com/evm/quickstart/setup-metamask.md)).

1. Create or use an ECDSA Hedera testnet account that has an EVM address, and fund it from the
   [faucet](https://docs.hedera.com/learn/getting-started/testnet-faucet.md).
2. Import its key into Foundry's encrypted keystore. The key never goes in a file in this repo:
   ```sh
   cast wallet import clip-handles-deployer --interactive
   ```
3. Deploy:
   ```sh
   cd contracts/handles
   export HEDERA_TESTNET_RPC_URL=https://testnet.hashio.io/api
   forge script script/Deploy.s.sol:Deploy --rpc-url hedera_testnet --account clip-handles-deployer --broadcast
   ```
   The script reads no key. The signer comes from `--account`, or use `--ledger` for a hardware wallet.
4. Look up the new contract on [HashScan](https://hashscan.io/testnet) by the address the script prints. Note both
   its EVM address (`0x…`) and its Hedera contract id (`0.0.x`).
5. Optional: verify the source through Sourcify ([Verifying smart contracts](https://docs.hedera.com/evm/development/verifying.md)).
6. Turn handles on in the wallet's `clip.config.ts`:
   ```ts
   services: { clipHandles: { address: "0x…", contractId: "0.0.x", ledger: "testnet" } }
   ```
   Reads go through the JSON-RPC relay. Writes are Hedera `ContractExecuteTransaction`s to `contractId`, paid by the
   user's Hedera account. Optionally also add the address to `CLIP_HANDLES_DEPLOYMENTS` in
   `packages/names/src/clip.ts`, so other hosts get it by default.

Until step 6 is done, the wallet says "Clip handles aren't switched on in this version yet." Typing `@alex` in Send
explains this instead of failing silently.
