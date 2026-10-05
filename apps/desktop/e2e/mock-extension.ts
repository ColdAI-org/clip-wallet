/**
 * A stand-in for the Clip Wallet browser extension and its browser, for the native-messaging e2e.
 *
 *   mock browser    does what Chrome's runtime.connectNative does: finds the host manifest in the per-user
 *                   NativeMessagingHosts folder (the one Clip Desktop wrote), checks the extension's origin is in
 *                   allowed_origins, starts the manifest's `path` with the origin as argv[1], and speaks the
 *                   native-messaging framing (32-bit length + JSON) on its stdio.
 *   mock extension  the extension's real LinkService ("extension" platform) with a NativeConnector over that port,
 *                   exactly as apps/extension/src/background/link.ts builds it.
 *
 * Its vault is EMPTY: the extension in signer mode holds no wallet; the vault only makes the ephemeral X25519 pairing
 * keys (packages/vault pairingKey(), which works empty). That is why this file may import @clip-wallet/vault
 * (tools/harness allowlist); no phrase or private key exists on this side.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { ClipVault, MemoryStorage } from "@clip-wallet/vault";
import { MemoryKV } from "@clip-wallet/engine";
import { FrameDecoder, LinkService, NativePortChannel, encodeFrame, installTarget, nativeHostName, type HostManifest, type NativePortLike } from "@clip-wallet/link";

export interface MockExtension {
  link: LinkService;
  /** Host processes started (one per connectNative). */
  hosts: ChildProcessWithoutNullStreams[];
  close(): void;
}

/** Chrome's connectNative, for a profile whose NativeMessagingHosts live under `home`. */
export function connectNative(o: { os: "darwin" | "linux" | "win32"; home: string; rdns: string; origin: string; hosts: ChildProcessWithoutNullStreams[] }): NativePortLike {
  const name = nativeHostName(o.rdns);
  const target = installTarget(o.os, "chrome", name, { home: o.home });
  const manifest = JSON.parse(readFileSync(target.manifestPath, "utf8")) as HostManifest;
  if (manifest.name !== name || manifest.type !== "stdio" || !manifest.allowed_origins?.includes(o.origin)) {
    throw new Error("Specified native messaging host not found."); // Chrome's own wording
  }
  const child = spawn(manifest.path, [o.origin], { stdio: ["pipe", "pipe", "pipe"], shell: o.os === "win32" });
  o.hosts.push(child);
  const messages = new Set<(m: unknown) => void>();
  const disconnects = new Set<() => void>();
  const dec = new FrameDecoder();
  child.stdout.on("data", (chunk: Buffer) => {
    for (const m of dec.push(chunk)) for (const l of messages) l(m);
  });
  child.on("exit", () => {
    for (const l of disconnects) l();
  });
  return {
    postMessage: (m) => void child.stdin.write(encodeFrame(m, 64 * 1024 * 1024)),
    onMessage: { addListener: (cb) => void messages.add(cb) },
    onDisconnect: { addListener: (cb) => void disconnects.add(cb) },
    disconnect: () => void child.kill(),
  };
}

export function startMockExtension(o: { os: "darwin" | "linux" | "win32"; home: string; rdns: string; extensionId: string }): MockExtension {
  const hosts: ChildProcessWithoutNullStreams[] = [];
  const origin = `chrome-extension://${o.extensionId}/`;
  const link = new LinkService({
    platform: "extension",
    deviceName: () => "Chrome on this computer (test)",
    kv: new MemoryKV(),
    vault: new ClipVault({ storage: new MemoryStorage() }),
    native: { connect: () => new NativePortChannel(connectNative({ ...o, origin, hosts })), requestPermission: async () => true },
  });
  return {
    link,
    hosts,
    close() {
      link.stopServing();
      for (const h of hosts) h.kill();
    },
  };
}
