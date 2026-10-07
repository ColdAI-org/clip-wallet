/**
 * Linked devices on the desktop (r1/connect, docs/r1/integration/connect.md): Clip Desktop is
 *   - the SIGNER for a paired browser extension: the extension's native-messaging host connects to the local socket
 *     (startDesktopLinkServer), requests reach this engine and show in the approval window, the vault signs only what
 *     the person approves here;
 *   - a CLIENT of a paired phone (phone as signer): while chosen in Settings → Linked devices, the built-in browser's
 *     1Mask requests go to the phone over the Clip Link relay (withRemoteSigner in wallet.ts);
 *   - a peer for encrypted settings sync, moving a wallet, and "continue elsewhere" (clipwallet://browse?…&h=…).
 * Lives in src/main/host because the LinkService is handed the vault (harness: the only vault importer here).
 */
import { hostname } from "node:os";
import type { Family } from "@clip-wallet/core";
import type { KV, WalletEngine } from "@clip-wallet/engine";
import { LinkService, contactsSource, walletSources, type LinkVault } from "@clip-wallet/link";
import { startDesktopLinkServer } from "@clip-wallet/link/node";
import { CONTACTS_KEY, encryptedContactStore } from "@clip-wallet/social/contacts";

const SYNC_EVERY_MS = 5 * 60_000;

export type DesktopLinkVault = LinkVault & {
  sealAppData(ns: string, p: string): Promise<{ nonce: string; ct: string }>;
  openAppData(ns: string, b: { nonce: string; ct: string }): Promise<string>;
};

export interface DesktopLinkDeps {
  kv: KV;
  vault: DesktopLinkVault;
  /** Lazy: the engine is built after the link (its dapp connector is wrapped with the link's remote mode). */
  engine(): WalletEngine;
  relayUrl?: string;
  syncUrl?: string;
  onChange(): void;
  platformLabel: string;
}

export function createDesktopLink(d: DesktopLinkDeps): LinkService {
  const contacts = encryptedContactStore(d.kv, { seal: (p) => d.vault.sealAppData("contacts", p), open: (b) => d.vault.openAppData("contacts", b) }, CONTACTS_KEY);
  return new LinkService({
    platform: "desktop",
    deviceName: () => `Clip Desktop (${d.platformLabel}${hostname() ? `, ${hostname().replace(/\.local$/, "").slice(0, 30)}` : ""})`,
    kv: d.kv,
    vault: d.vault,
    fetch: globalThis.fetch.bind(globalThis),
    // Node 22+ / Electron 33+ main process: global WebSocket (undici).
    WebSocket: globalThis.WebSocket as never,
    ...(d.relayUrl ? { relayUrl: d.relayUrl } : {}),
    ...(d.syncUrl ? { syncUrl: d.syncUrl } : {}),
    sources: () => [...walletSources(d.kv), contactsSource(contacts as never)],
    // The engine serves paired extensions: same approval window, decoding, scam checks and per-site permissions.
    signerHost: {
      approveConnect: (p) => d.engine().approveConnect(p),
      accountsFor: (o, f) => d.engine().accountsFor(o, f),
      request: (r, dapp) => d.engine().request(r, dapp),
      cancel: (id) => d.engine().cancel(id),
      decode: (r) => d.engine().decodeForFeatures(r),
    },
    async grantOrigin(origin, families) {
      for (const f of families) await d.engine().permissions.grant(origin, f as Family);
    },
    onChange: d.onChange,
  });
}

/** Starts serving: relay-paired devices, the native-messaging socket, and the sync timer. Returns a stop function. */
export async function startDesktopLink(
  link: LinkService,
  o: { socketPath: string; allowedOrigins: string[] },
): Promise<{ stop(): Promise<void>; socketPath: string }> {
  await link.init();
  await link.startServing().catch(() => undefined);
  const server = await startDesktopLinkServer({
    path: o.socketPath,
    allowedOrigins: o.allowedOrigins,
    onConnection: ({ channel }) => void link.acceptNative(channel),
  });
  void link.syncNow().catch(() => undefined);
  const timer = setInterval(() => void link.syncNow().catch(() => undefined), SYNC_EVERY_MS);
  timer.unref?.();
  return {
    socketPath: server.path,
    async stop() {
      clearInterval(timer);
      link.stopServing();
      await server.close();
    },
  };
}
