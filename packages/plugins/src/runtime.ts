/**
 * Runs INSIDE the sandboxed iframe (one iframe per plugin). After SES `lockdown()` (see sandbox-entry.ts) the
 * plugin's bundle is evaluated in a fresh `Compartment` whose global object holds only:
 *
 *   module, exports     where the bundle puts its handlers (CommonJS-style: module.exports.onTransaction = …)
 *   clip                hardened object with only what was granted: clip.notify(text), clip.fetch(url)
 *   console             no-op (plugins can't write to the wallet's console)
 *
 * plus the frozen, shared JavaScript intrinsics (Array, JSON, Promise…). No `window`, `document`, `fetch`,
 * `chrome`, `postMessage`, `parent`, storage, timers, `Date.now` or `Math.random`. The compartment's own
 * `Function`/`eval` evaluate in the same powerless global, and SES rejects dynamic `import(...)`.
 *
 * This file has no DOM dependency so the same code runs in the unit tests (with real SES) and in the iframe.
 */
import {
  type Grant,
  type HostToSandbox,
  type SandboxToHost,
  InsightOutputSchema,
  NameOutputSchema,
  LIMITS,
  parseFromHost,
} from "./messages.js";

/** The parts of SES the runtime needs (passed in so tests and the iframe share this file). */
export interface SesApi {
  Compartment: new (options: { globals?: Record<string, unknown>; __options__: true }) => {
    evaluate(source: string): unknown;
    globalThis: Record<string, unknown>;
  };
  harden<T>(x: T): T;
}

export interface RuntimeEnv extends SesApi {
  post(msg: SandboxToHost): void;
}

type Handler = (args: { request?: unknown; name?: string }) => unknown;

export function createSandboxRuntime(env: RuntimeEnv) {
  const { Compartment, harden } = env;
  let loaded = false;
  let handlers: Partial<Record<"onTransaction" | "onNameLookup", Handler>> = {};
  let fetchSeq = 0;
  const pendingFetch = new Map<string, (r: { ok: boolean; status: number; body: string }) => void>();

  function post(msg: SandboxToHost) {
    env.post(msg);
  }

  function makeClip(grant: Grant) {
    const api: Record<string, unknown> = {};
    if (grant.notifications) {
      api.notify = (text: unknown) => {
        if (typeof text !== "string") return;
        const t = text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "").slice(0, LIMITS.maxNotification);
        if (t) post({ type: "notify", text: t });
      };
    }
    if (grant.network) {
      api.fetch = (url: unknown) =>
        new Promise((resolve) => {
          const id = `f${++fetchSeq}`;
          pendingFetch.set(id, (r) => resolve(harden({ ...r })));
          post({ type: "fetch", id, url: String(url).slice(0, 2000) });
        });
    }
    return harden(api);
  }

  function load(m: Extract<HostToSandbox, { type: "load" }>) {
    if (loaded) return post({ type: "load-failed", reason: "already loaded" });
    loaded = true;
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    const noop = () => undefined;
    const compartment = new Compartment({
      globals: {
        module: mod,
        exports: mod.exports,
        clip: makeClip(m.grant),
        console: harden({ log: noop, info: noop, warn: noop, error: noop, debug: noop }),
      },
      __options__: true,
    });
    try {
      compartment.evaluate(m.source);
    } catch (e) {
      return post({ type: "load-failed", reason: String((e as Error)?.message ?? e).slice(0, 200) });
    }
    const exp = mod.exports;
    const h: typeof handlers = {};
    if (m.grant.transactionInsight && typeof exp.onTransaction === "function") h.onTransaction = exp.onTransaction as Handler;
    if (m.grant.nameResolution && typeof exp.onNameLookup === "function") h.onNameLookup = exp.onNameLookup as Handler;
    handlers = h;
    post({ type: "ready", handlers: Object.keys(h) as ("onTransaction" | "onNameLookup")[] });
  }

  async function invoke(m: Extract<HostToSandbox, { type: "invoke" }>) {
    const fn = handlers[m.handler];
    if (!fn) return post({ type: "result", id: m.id, ok: false, error: "not provided" });
    try {
      // Fresh stack (SES caveat on re-entrancy), hardened input so the plugin can't mutate shared state.
      const raw = await Promise.resolve().then(() =>
        fn(harden(m.handler === "onTransaction" ? { request: m.params } : { name: (m.params as { name: string }).name })),
      );
      // Copy out of the guest's objects before looking at them (no getters/proxies reach the host).
      const plain: unknown = raw === undefined ? null : JSON.parse(JSON.stringify(raw));
      const schema = m.handler === "onTransaction" ? InsightOutputSchema : NameOutputSchema;
      const parsed = schema.safeParse(m.handler === "onTransaction" && plain === null ? {} : plain);
      if (!parsed.success) return post({ type: "result", id: m.id, ok: false, error: "bad output" });
      post({ type: "result", id: m.id, ok: true, value: parsed.data });
    } catch (e) {
      post({ type: "result", id: m.id, ok: false, error: String((e as Error)?.message ?? "failed").slice(0, 200) });
    }
  }

  /** Feed every message from the host here. Malformed messages are ignored. */
  function receive(raw: unknown) {
    const m = parseFromHost(raw);
    if (!m) return;
    if (m.type === "load") return load(m);
    if (!loaded) return;
    if (m.type === "invoke") return void invoke(m);
    if (m.type === "fetch-result") {
      const r = pendingFetch.get(m.id);
      if (r) {
        pendingFetch.delete(m.id);
        r({ ok: m.ok, status: m.status, body: m.body });
      }
    }
  }

  return { receive };
}
