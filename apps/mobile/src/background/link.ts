/**
 * Linked devices on the phone (r1/connect): the phone as the signer for a paired browser extension (requests
 * arrive over the Clip Link relay and show on the normal approval sheet; the vault signs only what the person
 * approves here), settings sync, moving a wallet to/from another device, and "continue elsewhere".
 *
 * The phone listens on the relay only while the app is in the foreground (no push in this release): the extension
 * waits up to 2 minutes for the phone to answer and says "Open Clip on your phone". Lives in src/background
 * because the LinkService is handed the vault (harness: only this folder may import @clip-wallet/vault).
 */
import { AppState, type AppStateStatus } from "react-native";
import * as Device from "expo-device";
import type { Family } from "@clip-wallet/core";
import type { WalletEngine, KV } from "@clip-wallet/engine";
import { LinkService, contactsSource, walletSources, type LinkVault } from "@clip-wallet/link";
import { CONTACTS_KEY, encryptedContactStore } from "@clip-wallet/social/contacts";
import { createLinkClient, type LinkClient } from "@clip-wallet/ui";

const SYNC_EVERY_MS = 5 * 60_000;

export function createMobileLink(d: {
  kv: KV;
  vault: LinkVault & { sealAppData(ns: string, p: string): Promise<{ nonce: string; ct: string }>; openAppData(ns: string, b: { nonce: string; ct: string }): Promise<string> };
  engine: WalletEngine;
  relayUrl?: string;
  syncUrl?: string;
  onChange(): void;
  openUrl(url: string): void;
}): { service: LinkService; client: LinkClient } {
  const contacts = encryptedContactStore(d.kv, { seal: (p) => d.vault.sealAppData("contacts", p), open: (b) => d.vault.openAppData("contacts", b) }, CONTACTS_KEY);
  const engine = d.engine;
  const service = new LinkService({
    platform: "mobile",
    deviceName: () => Device.deviceName || Device.modelName || "Phone",
    kv: d.kv,
    vault: d.vault,
    fetch: (...a) => fetch(...a),
    WebSocket: globalThis.WebSocket as never,
    ...(d.relayUrl ? { relayUrl: d.relayUrl } : {}),
    ...(d.syncUrl ? { syncUrl: d.syncUrl } : {}),
    sources: () => [...walletSources(d.kv), contactsSource(contacts as never)],
    // The engine is the signer host: same approval sheet, same decoding, same per-site permissions.
    signerHost: {
      approveConnect: (p) => engine.approveConnect(p),
      accountsFor: (o, f) => engine.accountsFor(o, f),
      request: (r, dapp) => engine.request(r, dapp),
      cancel: (id) => engine.cancel(id),
      decode: (r) => engine.decodeForFeatures(r),
    },
    async grantOrigin(origin, families) {
      for (const f of families) await engine.permissions.grant(origin, f as Family);
    },
    onChange: d.onChange,
  });
  void service.init();
  let timer: ReturnType<typeof setInterval> | undefined;
  const foreground = () => {
    void service.startServing();
    void service.syncNow().catch(() => undefined);
    timer ??= setInterval(() => void service.syncNow().catch(() => undefined), SYNC_EVERY_MS);
  };
  const background = () => {
    service.stopServing();
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  if (AppState.currentState === "active") foreground();
  AppState.addEventListener("change", (s: AppStateStatus) => (s === "active" ? foreground() : background()));
  const client = createLinkClient((m) => service.handle(m as never), { openUrl: d.openUrl });
  return { service, client };
}
