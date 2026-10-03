/**
 * SocialService: the background side of contacts, Clip handles, notifications and Discover, for any host (the
 * extension's service worker, the mobile engine, tests). Holds no keys: handle actions end in `enqueue`, the
 * host's normal approval path; contacts are sealed by the vault through `cipher`.
 */
import type { AssetRef, ChainContext, DappRequest, DecodedRequest, Family, Network } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import type { LocaleCode } from "@clip-wallet/i18n";
import { ClipHandlesBackend, parseHandle } from "@clip-wallet/names";
import { ContactBook, initialOf } from "./contacts/book.js";
import { encryptedContactStore, plainContactStore, type AppDataCipher, type KVLike } from "./contacts/store.js";
import type { AddressValidators, Contact, ContactLookup } from "./contacts/types.js";
import { DiscoverService } from "./discover/service.js";
import type { TokenRiskSource } from "./discover/risk.js";
import { buildHandleRequest, refineHandleRequest, type HandleAction, type HandlesContract } from "./handles/publish.js";
import type { SocialRequest, SocialResponseMap } from "./messages.js";
import { notificationText } from "./notifications/messages.js";
import type { Notifier, Snapshot } from "./notifications/types.js";
import { NotificationWatcher } from "./notifications/watcher.js";
import type { ContactView, HandleView } from "./views.js";

export interface SocialHost {
  kv: KVLike;
  /** The vault's app-data sealing for "contacts" (ClipVault.sealAppData/openAppData). Absent → plain storage. */
  cipher?: AppDataCipher;
  /** ChainModule.isAddress per family the wallet has. */
  validators: AddressValidators;
  networks: Network[];
  assets: AssetRef[];
  /** The wallet's own address per family (the active accounts). Unlocked only. */
  ownAddresses(): Promise<{ family: Family; address: string }[]>;
  /** Context for the Hedera network handles live on (the user's Hedera account). */
  hederaCtx(): Promise<ChainContext>;
  /** decode → approval queue; returns the approval id. */
  enqueue(request: DappRequest, appName: string): Promise<{ id: string }>;
  /** ClipHandles: the read backend (from @clip-wallet/names) and the deployed contract id for writes. */
  handles?: { backend: ClipHandlesBackend; contract?: HandlesContract };
  notifier: Notifier;
  /** Public-data snapshot for notifications (notifications/source.ts publicSnapshot). */
  snapshot(): Promise<Snapshot | null>;
  locale(): LocaleCode | Promise<LocaleCode>;
  fetch: typeof fetch;
  risk?: TokenRiskSource;
  coingeckoIds?: Record<string, string>;
  coingeckoDemoKey?: string;
  randomId?: () => string;
  now?: () => number;
  /** Name shown on approvals the wallet itself creates ("Clip Wallet"). */
  walletName: string;
}

export class SocialService {
  readonly contacts: ContactBook;
  readonly notifications: NotificationWatcher;
  readonly discover: DiscoverService;
  private readonly randomId: () => string;

  constructor(private readonly host: SocialHost) {
    this.randomId = host.randomId ?? (() => globalThis.crypto.randomUUID());
    this.contacts = new ContactBook({
      store: host.cipher ? encryptedContactStore(host.kv, host.cipher) : plainContactStore(host.kv),
      validators: host.validators,
      randomId: this.randomId,
      ...(host.now ? { now: host.now } : {}),
    });
    this.notifications = new NotificationWatcher({ kv: host.kv, notifier: host.notifier, locale: () => host.locale(), ...(host.now ? { now: host.now } : {}) });
    this.discover = new DiscoverService({
      fetch: host.fetch,
      networks: host.networks,
      assets: host.assets,
      kv: host.kv,
      ...(host.coingeckoIds ? { coingeckoIds: host.coingeckoIds } : {}),
      ...(host.risk ? { risk: host.risk } : {}),
      ...(host.coingeckoDemoKey ? { coingeckoDemoKey: host.coingeckoDemoKey } : {}),
      ...(host.now ? { now: host.now } : {}),
    });
  }

  /** For the security stream (address poisoning) and approval screens. */
  lookup(): ContactLookup {
    return this.contacts;
  }

  /** Clears decrypted contacts from memory. Call when the wallet locks. */
  onLock(): void {
    this.contacts.forget();
  }

  /** One notification poll (the host's timer calls this). */
  poll() {
    return this.notifications.poll(() => this.host.snapshot());
  }

  /** Plain-words approvals for ClipHandles calls; chain after the features refine. */
  refine(request: DappRequest, decoded: DecodedRequest): DecodedRequest {
    return refineHandleRequest(request, decoded, this.host.handles?.contract);
  }

  /** Messages that work while locked (notification settings live outside the vault). */
  static readonly LOCKED_OK: ReadonlySet<SocialRequest["type"]> = new Set(["socNotifySettings", "socNotifySet", "socAlertArm", "socAlertRemove", "socNotifyTest", "socDiscover"]);

  async handle<T extends SocialRequest["type"]>(m: Extract<SocialRequest, { type: T }>): Promise<SocialResponseMap[T]> {
    return (await this.dispatch(m as SocialRequest)) as SocialResponseMap[T];
  }

  private async dispatch(m: SocialRequest): Promise<unknown> {
    switch (m.type) {
      case "socContacts":
        return { contacts: (await this.contacts.list()).map(view), encrypted: this.contacts.encrypted };
      case "socContactSave": {
        const input = { name: m.input.name, addresses: m.input.addresses as Contact["addresses"], ...(m.input.notes ? { notes: m.input.notes } : {}), ...(m.input.handle ? { handle: m.input.handle } : {}) };
        return view(m.id ? await this.contacts.update(m.id, input) : await this.contacts.add(input));
      }
      case "socContactDelete":
        return this.contacts.remove(m.id);
      case "socContactSearch":
        return (await this.contacts.search(m.query, m.family as Family | undefined)).map((x) => ({ contact: view(x.contact), entry: x.entry }));
      case "socAddressCheck": {
        const fam = m.family as Family | undefined;
        const hit = await this.contacts.byAddress(m.address, fam);
        const look = hit ? [] : await this.contacts.lookalikes(m.address, fam);
        return { ...(hit ? { contact: { contact: view(hit.contact), entry: hit.entry } } : {}), lookalikes: look.map((l) => ({ contact: view(l.contact), entry: l.entry, samePrefix: l.samePrefix, sameSuffix: l.sameSuffix })) };
      }
      case "socDetectFamily":
        return (Object.entries(this.host.validators) as [Family, (a: string) => boolean][]).filter(([, ok]) => ok(m.address.trim())).map(([f]) => f);
      case "socHandleStatus":
        return this.handleStatus();
      case "socHandleCheck": {
        const h = parseHandle(`@${m.handle.replace(/^@/, "")}`);
        if (!h) return { valid: false, available: false };
        return { valid: true, available: (await this.backend().available(h)) ?? false };
      }
      case "socHandleLookup": {
        const hit = await this.backend().lookup(m.input.startsWith("@") || m.input.endsWith(".clip") ? m.input : `@${m.input}`);
        if (!hit) return null;
        const r = await this.backend().resolve(`@${hit.handle}`);
        return { handle: hit.handle, byFamily: hit.byFamily, recentlyRegistered: !!r?.handle?.recentlyRegistered };
      }
      case "socHandleRegister": {
        const h = parseHandle(`@${m.handle.replace(/^@/, "")}`);
        if (!h) throw new ClipError("Handles use 3–32 lowercase letters, numbers and single hyphens.", "handles/invalid");
        if ((await this.backend().available(h)) === false) throw new ClipError(`@${h} is taken. Try another one.`, "handles/taken");
        return this.queue({ kind: "register", handle: h });
      }
      case "socHandlePublish": {
        const own = await this.host.ownAddresses();
        for (const r of m.records) {
          // Only the wallet's own addresses can be published, and only through this screen.
          if (r.address && !own.some((o) => o.family === r.family && o.address === r.address))
            throw new ClipError("You can only publish this wallet's own addresses.", "handles/not-yours");
        }
        return this.queue({ kind: "publish", records: m.records as { family: Family; address: string }[] });
      }
      case "socHandleRelease": {
        const st = await this.handleStatus();
        return this.queue({ kind: "release", recordCount: st.mine?.records.length ?? 1 });
      }
      case "socHandleReverse":
        return this.queue({ kind: "reverse", enabled: m.enabled });
      case "socNotifySettings":
        return this.notifications.settings();
      case "socNotifySet":
        return this.notifications.setSettings({ ...(m.enabled !== undefined ? { enabled: m.enabled } : {}), ...(m.kinds ? { kinds: m.kinds } : {}) });
      case "socAlertAdd": {
        const asset = this.host.assets.find((a) => a.key === m.assetKey);
        if (!asset) throw new ClipError("Pick an asset this wallet knows.", "alerts/asset");
        return this.notifications.addAlert({ assetKey: m.assetKey, symbol: asset.symbol, direction: m.direction, price: m.price, currency: m.currency }, this.randomId());
      }
      case "socAlertArm":
        return this.notifications.setAlertArmed(m.id, m.armed);
      case "socAlertRemove":
        return this.notifications.removeAlert(m.id);
      case "socNotifyTest": {
        const t = notificationText(await this.host.locale());
        await this.host.notifier.show({ id: `test:${this.randomId()}`, kind: "confirmed", title: t("test.title"), body: t("test.body"), route: "/settings/notifications" });
        return;
      }
      case "socDiscover":
        return this.discover.feed({ ...(m.refresh ? { refresh: true } : {}) });
    }
  }

  private backend(): ClipHandlesBackend {
    const b = this.host.handles?.backend;
    if (!b || !b.enabled) throw new ClipError("Clip handles aren't switched on in this version yet.", "names/clip-off");
    return b;
  }

  private async handleStatus(): Promise<HandleView> {
    const own = await this.host.ownAddresses().catch(() => []);
    const publishable = own.filter((o) => this.host.validators[o.family]?.(o.address));
    const b = this.host.handles?.backend;
    if (!b?.enabled || !this.host.handles?.contract) return { enabled: false, publishable, hederaReady: false };
    let hederaReady = false;
    let owner: string | undefined;
    try {
      const ctx = await this.host.hederaCtx();
      owner = /^0x[0-9a-f]{40}$/i.test(ctx.account.address) ? ctx.account.address : undefined;
      hederaReady = !!ctx.account.hederaAccountId;
    } catch {
      hederaReady = false;
    }
    const mine = owner ? await b.owned(owner).catch(() => null) : null;
    if (!mine) return { enabled: true, publishable, hederaReady };
    const records = mine.records.families.map((f, i) => ({ family: f as Family, address: mine.records.addrs[i] ?? "" })).filter((r) => r.address);
    const reverse = owner ? await b.reverseOn(owner).catch(() => false) : false;
    return { enabled: true, mine: { handle: mine.handle, records, reverse, registeredAt: mine.records.registeredAt * 1000 }, publishable, hederaReady };
  }

  private async queue(action: HandleAction): Promise<{ approvalId: string }> {
    const contract = this.host.handles?.contract;
    if (!contract) throw new ClipError("Clip handles aren't switched on in this version yet.", "names/clip-off");
    const request = await buildHandleRequest(action, contract, await this.host.hederaCtx());
    const { id } = await this.host.enqueue(request, this.host.walletName);
    return { approvalId: id };
  }
}

function view(c: Contact): ContactView {
  return { ...c, initial: initialOf(c.name) };
}
