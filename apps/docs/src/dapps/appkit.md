# Reown AppKit

AppKit lists EIP-6963 wallets under **Installed**, Clip Wallet included. The injected path needs no WalletConnect
traffic; your project id is only used for AppKit's own cloud features (the QR code, the wallet explorer, email and
social logins).

<<< @/snippets/dapps/appkit.ts

Then put `<appkit-button>` in your page. Clip appears under "Installed"; choosing it opens Clip's connect approval.

## Clip on phones and other devices

Through AppKit's WalletConnect QR code, Clip's phone app and Clip Desktop connect like any WalletConnect wallet. See
[WalletConnect](./walletconnect.md).

## Tested

- **Picker matrix**: AppKit 1.8.24 with the wagmi adapter lists Clip under "Installed" with its icon, connects,
  reconnects and restores. Reown AppKit Lab on Sepolia connects and signs a message.
  [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/appkit.tsx)
- **Compat suite**: AppKit lists the wallet from EIP-6963 with all Reown traffic blocked.
  [Compatibility promise](../connect/compatibility.md)
