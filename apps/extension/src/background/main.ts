/**
 * Service-worker bootstrap: builds dependencies (wiring.ts), the WalletService, and connects it to the
 * browser: the page message bus, the auto-lock alarm, the approval window and the passkey web bridge.
 */
import { browser } from "wxt/browser";
import { ClipError } from "@clip-wallet/core";
import { PORT_NAME } from "@clip-wallet/1mask/background";
import config from "../../clip.config";
import { PASSKEY_BRIDGE_URL, passkeyRpId } from "../app-settings";
import { CHANGE_EVENT, Request, type Envelope } from "../shared/messages";
import { AreaKV } from "../shared/storage";
import { createDependencies } from "./wiring";
import { WalletService, type Env } from "./service";
import { createFeatureHost, createFeatures } from "./features";
import { withFixtureFeatures } from "./mocks/mock-features";
import { startSocial } from "./social";
import { COINGECKO_IDS } from "@clip-wallet/features";

const AUTOLOCK_ALARM = "clip-autolock";

export function toEnvelope(e: unknown): Envelope {
  if (e instanceof ClipError) return { ok: false, error: { userMessage: e.userMessage, code: e.code } };
  return { ok: false, error: { userMessage: "Something went wrong. Please try again.", code: "internal" } };
}

export function startBackground() {
  const kv = new AreaKV(browser.storage.local);
  let service: WalletService | undefined;
  const deps = createDependencies({
    kv,
    mocks: __CLIP_MOCKS__,
    config,
    iconUrl: browser.runtime.getURL("/icon/128.png"),
    currency: async () => (await service!.prefs()).displayCurrency,
    features: __CLIP_FEATURES__,
  });

  let approvalWindowId: number | undefined;
  const extOrigin = new URL(browser.runtime.getURL("/")).origin;

  const env: Env = {
    walletName: config.name,
    async openApprovalWindow(id) {
      const url = browser.runtime.getURL(`/approval.html#${encodeURIComponent(id)}`);
      if (approvalWindowId !== undefined) {
        try {
          await browser.windows.update(approvalWindowId, { focused: true });
          return;
        } catch {
          approvalWindowId = undefined;
        }
      }
      const w = await browser.windows.create({ url, type: "popup", width: 376, height: 640, focused: true });
      approvalWindowId = w?.id;
    },
    async openTab(route) {
      await browser.tabs.create({ url: browser.runtime.getURL(`/tab.html#${route}`) });
    },
    broadcast() {
      browser.runtime.sendMessage({ event: CHANGE_EVENT }).catch(() => undefined);
    },
    armAutoLock(minutes) {
      void browser.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: minutes });
    },
    // Extension pages have no default RP id: pass it explicitly (the extension id unless rpOrigin is set).
    passkey: () => ({ rpId: passkeyRpId() ?? browser.runtime.id, rpName: config.name, mode: "extension", bridgeUrl: PASSKEY_BRIDGE_URL }),
  };

  service = new WalletService(deps, kv, env);
  service.start();
  const svc = service;
  const features = createFeatures(
    createFeatureHost({
      networks: deps.networks,
      assets: deps.assets,
      kv,
      ctx: (id) => svc.featureCtx(id),
      balances: () => svc.featureBalances(),
      enqueue: (request, appName) => svc.enqueueWalletRequest(request, appName),
      decode: (request) => svc.decodeForFeatures(request),
      usd: (key) => deps.prices.usd(key),
    }),
    __CLIP_FEATURES__,
  );
  // Fixture mode: sample staking, quotes and liquidity instead of live network calls.
  svc.attachFeatures(deps.mocks ? withFixtureFeatures(features) : features);

  // Contacts, Clip handles, notifications and Discover (social stream).
  svc.attachSocial(
    startSocial({
      networks: deps.networks,
      assets: deps.assets,
      chains: deps.chains,
      loadChains: () => deps.loadChains(),
      kv,
      vault: deps.vault as never,
      ctx: (id) => svc.featureCtx(id),
      enqueue: async (request, appName) => ({ id: (await svc.enqueueWalletRequest(request, appName)).id }),
      approvals: async () => svc.socialApprovals(),
      prices: deps.prices,
      walletName: config.name,
      coingeckoIds: COINGECKO_IDS,
      iconUrl: browser.runtime.getURL("/icon/128.png"),
      ...(config.services.clipHandles ? { handles: config.services.clipHandles } : {}),
    }),
  );

  // 1Mask: content scripts connect a port per tab; the router cross-checks the browser-reported origin.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    const senderOrigin = port.sender?.origin ?? (port.sender?.url ? new URL(port.sender.url).origin : undefined);
    deps.dapps.attachPort?.(port as never, senderOrigin);
  });

  browser.windows?.onRemoved.addListener((id) => {
    if (id === approvalWindowId) approvalWindowId = undefined;
  });

  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === AUTOLOCK_ALARM) void svc.lock();
  });

  browser.runtime.onInstalled.addListener((d) => {
    if (d.reason === "install") void env.openTab("/");
  });

  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    // Only our own extension pages may use the wallet bus; content scripts (1Mask) use their port.
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(extOrigin)) return undefined;
    if (msg && typeof msg === "object" && "event" in msg) return undefined;
    const parsed = Request.safeParse(msg);
    if (!parsed.success) {
      return Promise.resolve<Envelope>({ ok: false, error: { userMessage: "Something went wrong. Please try again.", code: "bus/invalid" } });
    }
    return svc.handle(parsed.data).then(
      (data): Envelope => ({ ok: true, data }),
      (e): Envelope => toEnvelope(e),
    );
  });

  return svc;
}
