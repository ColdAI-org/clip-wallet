/**
 * MOCK 1Mask and WalletConnect. The real ones are @clip-wallet/1mask/background (createOneMaskRouter,
 * attached to runtime ports from the content script) and @clip-wallet/1mask/walletconnect
 * (createWalletConnectWallet on Reown WalletKit). In dev builds, dapp requests come from the
 * "Developer (mock data)" buttons in Settings instead.
 */
import type { SessionView } from "@clip-wallet/ui";
import { ClipError } from "@clip-wallet/core";
import type { DappConnector, DappHost, WalletConnectBridge } from "../wiring";

export class MockDappConnector implements DappConnector {
  host?: DappHost;
  start(host: DappHost) {
    this.host = host;
  }
  disconnected() {
    /* the real router emits accountsChanged([]) / disconnect to the site's open tabs */
  }
}

export class MockWalletConnect implements WalletConnectBridge {
  private list: SessionView[] = [
    {
      id: "wc-seed-1",
      dapp: { name: "Uniswap", origin: "https://app.uniswap.org", domain: "app.uniswap.org", verified: true },
      via: "walletconnect",
      connectedAt: Date.now() - 2 * 86_400_000,
      networkIds: ["eip155:84532"],
    },
  ];
  host?: DappHost;
  start(host: DappHost) {
    this.host = host;
  }
  async pair(uri: string) {
    if (!/^wc:[0-9a-f]{64}@2\?/i.test(uri)) {
      throw new ClipError("That connection code isn't valid. Copy it again from the app.", "walletconnect/bad-uri");
    }
    // Real WalletKit: pair → session_proposal → connect approval (no network picker) → session.
  }
  async sessions() {
    return [...this.list];
  }
  async disconnect(id: string) {
    this.list = this.list.filter((s) => s.id !== id);
  }
}
