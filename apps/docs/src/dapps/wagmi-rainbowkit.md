# wagmi and RainbowKit

wagmi's multi-injected-provider discovery (EIP-6963) is on by default, so Clip Wallet appears as a connector with the
rest. RainbowKit lists it under **Installed**. Nothing Clip-specific to add.

## RainbowKit

<<< @/snippets/dapps/rainbowkit.tsx

`getDefaultConfig` needs a WalletConnect project id for RainbowKit's QR flows. The injected path that finds Clip
doesn't use it.

## wagmi without a modal

<<< @/snippets/dapps/wagmi-react.tsx

wagmi shows each discovered wallet's own name and icon, so a kit-built wallet appears under its own brand.

## Prefer Clip with one button

If you want a single "Connect" button that prefers Clip Wallet and falls back to any other wallet, use the
[wagmi connector from Clip Connect](../connect/wagmi.md). wagmi keeps listing every other wallet as usual.

## Tested

- **Picker matrix**: RainbowKit 2.2.11 (`getDefaultConfig`) and ConnectKit 1.9.2 list Clip with the announced icon,
  connect, reconnect and restore after a reload. [Results](../testing/results/picker-matrix.md) ·
  [RainbowKit page](repo:apps/extension/e2e/pickers/dapps/src/rainbowkit.tsx) ·
  [ConnectKit page](repo:apps/extension/e2e/pickers/dapps/src/connectkit.tsx)
- **Dapp matrix**: wagmi 3 + viem on Sepolia, all four levels. [Results](../testing/results/dapp-matrix.md)
- **Compat suite**: wagmi's EIP-6963 store, connect, `signMessage` and a declined `sendTransaction` (4001), compared with
  a recorded snapshot on every build. [Compatibility promise](../connect/compatibility.md)
