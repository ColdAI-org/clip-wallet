// A host (the phone's background, Clip Desktop's main process) wiring the engine. Only host code may import the
// vault; it builds `new ClipVault({ storage, argon2id })` with its own storage and passes it in.
import type { ClipConfig } from "@clip-wallet/config";
import { WalletEngine, createEngineClient, type KV } from "@clip-wallet/engine";
import { createEngineDependencies } from "@clip-wallet/engine/wiring";
import type { ClipVault, hashSignablePayload } from "@clip-wallet/vault";

export function startEngine(host: {
  config: ClipConfig;
  vault: ClipVault;
  hashSignablePayload: typeof hashSignablePayload;
  kv: KV; // app data (not keys): AsyncStorage on the phone, a JSON file on desktop
  openApproval(id: string): void; // show the approval sheet or window
  broadcast(): void; // tell the screens to re-read state
  subscribe(cb: () => void): () => void;
}) {
  const deps = createEngineDependencies({
    config: host.config,
    vault: host.vault,
    hashPayload: host.hashSignablePayload,
    currency: async () => "USD",
    walletConnect: { projectId: process.env.CLIP_WALLETCONNECT_PROJECT_ID, url: "https://wallet.acme.example", iconUrl: "https://wallet.acme.example/icon.png" },
    kv: host.kv,
  });
  const engine = new WalletEngine(deps, host.kv, {
    walletName: host.config.name,
    openApproval: host.openApproval,
    broadcast: host.broadcast,
    armAutoLock: () => undefined, // the host's own timer
    fetch: globalThis.fetch,
    randomUUID: () => crypto.randomUUID(),
  });
  engine.start();
  // What @clip-wallet/ui's screens talk to. Every message is validated with the engine's zod schema.
  return { engine, client: createEngineClient(engine, { subscribe: host.subscribe }) };
}

// A 1Mask port from the in-app browser: the origin comes from the host (the WebView's URL), never the page.
export function attachTab(engine: WalletEngine, port: Parameters<WalletEngine["attachDappPort"]>[0], webViewUrl: string) {
  engine.attachDappPort(port, new URL(webViewUrl).origin);
}
