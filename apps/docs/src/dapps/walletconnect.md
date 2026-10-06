# WalletConnect

Clip Wallet is a WalletConnect v2 wallet too: in the extension (paste or scan a pairing code), on the phone and in
Clip Desktop. Any dapp that offers WalletConnect, usually through Reown AppKit or RainbowKit's QR code, connects to it
with no Clip-specific code.

| Namespace | Chains | Methods |
| --- | --- | --- |
| `eip155` | the EVM test networks the wallet ships with | `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`, and EIP-5792's methods when the session asks for them |
| `solana` | devnet | `solana_signTransaction`, `solana_signAndSendTransaction`, `solana_signMessage` |
| `bip122` | testnet4 | `signPsbt`, `signMessage`, `sendTransfer` |
| `hedera` | testnet | `hedera_signMessage`, `hedera_signTransaction`, `hedera_signAndExecuteTransaction`, … |

- **Proposals.** Required chains or methods Clip can't serve reject the proposal (`5100`, `5101`); optional ones are
  dropped and listed on the approval screen.
- **Verify.** WalletConnect's Verify verdict becomes warnings (`domain-mismatch`, `known-scam`). An app URL Verify
  didn't confirm is shown as "app.example (unverified)" and never borrows a real site's permissions.
- **One-click auth** (SIWE + ReCaps) signs one CACAO, for the first supported EVM chain.
- **Errors**: `5000` user rejected, `5100` unsupported chains, `5101` unsupported methods, `3001` unauthorized method,
  `6000` user disconnected.

## For dapps: use your own project id

Your dapp's WalletConnect traffic uses **your** Reown (WalletConnect Cloud) project id. Clip Connect never ships one;
see [Reown AppKit](./appkit.md) or Clip Connect's [WalletConnect fallback](../connect/connect.md#nothing-injected-walletconnect).

## For wallet builders

The wallet's own project id comes from the build environment (`CLIP_WALLETCONNECT_PROJECT_ID`), never from source.
Without one, WalletConnect is off and the wallet says so. A mainnet build requires one (`mainnetProblems()`).
