import { vi } from "vitest";
import config from "../clip.config";
import { MemoryKV } from "../src/shared/storage";
import { createDependencies } from "../src/background/wiring";
import { WalletService, type Env } from "../src/background/service";
import type { OffscreenApi } from "../src/background/plugins";

export const PASSWORD = "calm orange harbour 42";
/** Cheap Argon2 for tests only; production uses the vault's defaults (64 MiB, t=3). */
export const FAST_ARGON2 = { argon2: { memoryKiB: 256, iterations: 1, parallelism: 1 } };

export function makeService(opts: { mocks?: boolean; pluginHost?: OffscreenApi | null } = {}) {
  const kv = new MemoryKV();
  let service!: WalletService;
  const deps = createDependencies({
    kv,
    mocks: opts.mocks ?? true,
    config,
    iconUrl: "chrome-extension://test/icon/128.png",
    currency: async () => (await service.prefs()).displayCurrency,
    vaultOptions: FAST_ARGON2,
  });
  const env: Env & { opened: string[] } = {
    opened: [],
    walletName: config.name,
    openApprovalWindow: vi.fn(async (id: string) => {
      env.opened.push(id);
    }),
    openTab: vi.fn(async () => undefined),
    broadcast: vi.fn(),
    armAutoLock: vi.fn(),
    passkey: () => ({ rpId: "testextensionid", rpName: config.name, mode: "extension", bridgeUrl: "https://bridge.example/b" }),
    // No offscreen document in tests unless one is passed.
    pluginHost: opts.pluginHost ?? null,
  };
  service = new WalletService(deps, kv, env);
  service.start();
  return { service, deps, kv, env };
}
