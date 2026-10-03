/**
 * NotificationWatcher: compares each poll with the last one and turns the differences into notices.
 *
 *   incoming   a balance went up (spam tokens never notify: unsolicited airdrops are a phishing vector)
 *   nft        a collectible appeared (not spam)
 *   confirmed  one of your transactions finished; failed: it didn't
 *   price      a price alert you set was crossed (one-shot, then it waits to be turned on again)
 *   approval   an app is waiting for your approval
 *
 * The first poll only records a baseline, so turning notifications on never floods the user with history.
 * State lives in the host's KV (public data only).
 */
import { formatAmount, formatFiat, type LocaleCode } from "@clip-wallet/i18n";
import type { KVLike } from "../contacts/store.js";
import { notificationText } from "./messages.js";
import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_KINDS, type Notice, type NotificationSettings, type Notifier, type PriceAlert, type Snapshot } from "./types.js";

export const NOTIFY_SETTINGS_KEY = "clip/social/notifications";
export const NOTIFY_STATE_KEY = "clip/social/notify-state";

/** More than this many notices from one poll collapse into one summary. */
const MAX_PER_KIND = 3;

interface WatchState {
  v: 1;
  balances: Record<string, string>;
  networks: string[];
  nfts: string[];
  activity: Record<string, string>;
  approvals: string[];
}

export interface WatcherOptions {
  kv: KVLike;
  notifier: Notifier;
  locale: () => LocaleCode | Promise<LocaleCode>;
  now?: () => number;
}

export class NotificationWatcher {
  private readonly now: () => number;
  private running?: Promise<Notice[]>;

  constructor(private readonly opts: WatcherOptions) {
    this.now = opts.now ?? Date.now;
  }

  async settings(): Promise<NotificationSettings> {
    const s = await this.opts.kv.get<Partial<NotificationSettings>>(NOTIFY_SETTINGS_KEY);
    return {
      enabled: s?.enabled ?? DEFAULT_NOTIFICATION_SETTINGS.enabled,
      kinds: { ...DEFAULT_NOTIFICATION_SETTINGS.kinds, ...(s?.kinds ?? {}) },
      alerts: Array.isArray(s?.alerts) ? s!.alerts : [],
    };
  }

  async setSettings(patch: { enabled?: boolean; kinds?: Partial<NotificationSettings["kinds"]> }): Promise<NotificationSettings> {
    const s = await this.settings();
    const next: NotificationSettings = { ...s, enabled: patch.enabled ?? s.enabled, kinds: { ...s.kinds } };
    for (const k of NOTIFICATION_KINDS) if (patch.kinds?.[k] !== undefined) next.kinds[k] = patch.kinds[k]!;
    // Turning notifications on starts from a fresh baseline.
    if (patch.enabled && !s.enabled) await this.opts.kv.remove?.(NOTIFY_STATE_KEY);
    await this.opts.kv.set(NOTIFY_SETTINGS_KEY, next);
    return next;
  }

  async addAlert(a: Omit<PriceAlert, "id" | "createdAt" | "armed" | "firedAt">, id: string): Promise<PriceAlert> {
    if (!(a.price > 0) || !Number.isFinite(a.price)) throw new RangeError("price must be positive");
    const s = await this.settings();
    if (s.alerts.length >= 50) throw new RangeError("too many alerts");
    const alert: PriceAlert = { ...a, id, createdAt: this.now(), armed: true };
    await this.opts.kv.set(NOTIFY_SETTINGS_KEY, { ...s, alerts: [...s.alerts, alert] });
    return alert;
  }

  async setAlertArmed(id: string, armed: boolean): Promise<void> {
    const s = await this.settings();
    await this.opts.kv.set(NOTIFY_SETTINGS_KEY, { ...s, alerts: s.alerts.map((a) => (a.id === id ? { ...a, armed } : a)) });
  }

  async removeAlert(id: string): Promise<void> {
    const s = await this.settings();
    await this.opts.kv.set(NOTIFY_SETTINGS_KEY, { ...s, alerts: s.alerts.filter((a) => a.id !== id) });
  }

  /** One poll. Overlapping calls share the run in progress. Returns what was shown. */
  poll(read: () => Promise<Snapshot | null>): Promise<Notice[]> {
    this.running ??= this.pollOnce(read).finally(() => (this.running = undefined));
    return this.running;
  }

  private async pollOnce(read: () => Promise<Snapshot | null>): Promise<Notice[]> {
    const settings = await this.settings();
    if (!settings.enabled) return [];
    const snap = await read();
    if (!snap) return [];
    const prev = await this.opts.kv.get<WatchState>(NOTIFY_STATE_KEY);
    const locale = await this.opts.locale();
    const t = notificationText(locale);
    const notices: Notice[] = [];
    const stamp = this.now();

    // Balances: only networks read both times; missing keys on a read network are zero.
    const balances: Record<string, string> = {};
    const readNets = new Set(snap.networksRead);
    for (const [k, v] of Object.entries(prev?.balances ?? {})) if (!readNets.has(k.split("|")[1]!)) balances[k] = v; // keep last known
    const incoming: Notice[] = [];
    for (const b of snap.balances) {
      const k = `${b.key}|${b.networkId}`;
      balances[k] = (BigInt(balances[k] ?? "0") + BigInt(b.amount)).toString();
    }
    if (prev) {
      const prevNets = new Set(prev.networks);
      const seen = new Set<string>();
      for (const b of snap.balances) {
        const k = `${b.key}|${b.networkId}`;
        if (seen.has(k) || b.spam || !prevNets.has(b.networkId)) continue;
        seen.add(k);
        const delta = BigInt(balances[k]!) - BigInt(prev.balances[k] ?? "0");
        if (delta <= 0n) continue;
        const amount = formatAmount(delta, b.decimals, 6, locale);
        incoming.push({ id: `in:${k}:${stamp}`, kind: "incoming", title: t("incoming.title"), body: t("incoming.body", { amount, symbol: b.symbol }), route: `/asset/${encodeURIComponent(b.key)}` });
      }
    }
    if (settings.kinds.incoming) notices.push(...collapse(incoming, () => ({ id: `in:many:${stamp}`, kind: "incoming", title: t("incoming.title"), body: t("incoming.many", { count: incoming.length }), route: "/" })));

    // Collectibles
    let nftIds = prev?.nfts ?? [];
    if (snap.nftsRead) {
      const before = new Set(prev?.nfts ?? []);
      const fresh = prev ? snap.nfts.filter((n) => !before.has(n.id) && !n.spam) : [];
      nftIds = snap.nfts.map((n) => n.id);
      if (settings.kinds.nft) {
        const list = fresh.map<Notice>((n) => ({ id: `nft:${n.id}`, kind: "nft", title: t("nft.title"), body: t("nft.body", { name: n.name ?? n.collection }), route: `/collectible/${encodeURIComponent(n.id)}` }));
        notices.push(...collapse(list, () => ({ id: `nft:many:${stamp}`, kind: "nft", title: t("nft.title"), body: t("nft.many", { count: list.length }), route: "/collectibles" })));
      }
    }

    // Your transactions
    const activity: Record<string, string> = {};
    for (const a of snap.activity) activity[a.id] = a.status;
    if (prev) {
      for (const a of snap.activity) {
        if (a.kind === "receive" || a.kind === "connect") continue;
        const was = prev.activity[a.id];
        if (was === a.status || (was !== undefined && was !== "pending")) continue;
        if (a.status === "done" && settings.kinds.confirmed) notices.push({ id: `tx:${a.id}:done`, kind: "confirmed", title: t("confirmed.title"), body: a.title, route: "/activity" });
        if (a.status === "failed" && settings.kinds.failed) notices.push({ id: `tx:${a.id}:failed`, kind: "failed", title: t("failed.title"), body: t("failed.body", { what: a.title }), route: "/activity" });
      }
    }

    // Approvals waiting
    if (prev && settings.kinds.approval) {
      const before = new Set(prev.approvals);
      for (const a of snap.approvals) {
        if (before.has(a.id)) continue;
        notices.push({ id: `ap:${a.id}`, kind: "approval", title: t("approval.title", { app: a.app }), body: a.title, route: `/approval/${encodeURIComponent(a.id)}` });
      }
    }

    // Price alerts (checked on every poll, baseline or not: the user set them explicitly).
    const alerts = settings.alerts.map((a) => ({ ...a }));
    let alertsChanged = false;
    for (const a of alerts) {
      if (!a.armed) continue;
      const p = snap.price(a.assetKey, a.currency);
      if (p === undefined) continue;
      if (a.direction === "above" ? p < a.price : p > a.price) continue;
      a.armed = false;
      a.firedAt = stamp;
      alertsChanged = true;
      if (settings.kinds.price)
        notices.push({
          id: `price:${a.id}:${stamp}`,
          kind: "price",
          title: t(a.direction === "above" ? "price.above" : "price.below", { symbol: a.symbol, price: formatFiat(a.price, a.currency, locale) }),
          body: t("price.now", { symbol: a.symbol, price: formatFiat(p, a.currency, locale) }),
          route: `/asset/${encodeURIComponent(a.assetKey)}`,
        });
    }
    if (alertsChanged) await this.opts.kv.set(NOTIFY_SETTINGS_KEY, { ...settings, alerts });

    const networks = [...new Set([...(prev?.networks ?? []).filter((n) => !readNets.has(n)), ...snap.networksRead])];
    await this.opts.kv.set<WatchState>(NOTIFY_STATE_KEY, { v: 1, balances, networks, nfts: nftIds, activity, approvals: snap.approvals.map((a) => a.id) });

    for (const n of notices) await this.opts.notifier.show(n).catch(() => undefined);
    return notices;
  }
}

function collapse(list: Notice[], summary: () => Notice): Notice[] {
  return list.length > MAX_PER_KIND ? [summary()] : list;
}
