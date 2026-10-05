/**
 * LinkService: everything behind Settings → Linked devices, for any host (extension service worker, Clip Desktop,
 * the mobile app). It holds no seed or private key: pairing keys, sync signing and wallet transfer go through the
 * vault's APIs (LinkVault); this service keeps only derived link secrets of paired devices and public data.
 */
import { ClipError, type Family } from "@clip-wallet/core";
import { b64url, fromB64url, hkdf32, randomBytes } from "../bytes.js";
import type { LinkVault } from "../keys.js";
import { nextFrame, type BaseChannel, type Channel } from "../pairing/channel.js";
import {
  PairingError,
  contextFromOffer,
  newOffer,
  offerToUri,
  pair,
  pairedChannelId,
  parseOfferUri,
  type Paired,
  type PairingContext,
  type PendingPairing,
  type Purpose,
  type Role,
} from "../pairing/pairing.js";
import { openSession, type SecureSession } from "../pairing/session.js";
import { RelayChannel, type WebSocketCtor } from "../relay/client.js";
import { RemoteSigner } from "../remote/client.js";
import { RemoteGrants, type RemoteMode } from "../remote/host.js";
import { serveSigner, type SignerHost } from "../remote/server.js";
import { SyncEngine, type LinkKV, type SyncSource } from "../sync/client.js";
import { receiveWallet, sendWallet } from "../transfer/transfer.js";
import { buildHandoffLink, httpsOrigin, openHandoffToken, parseHandoffLink } from "../handoff/handoff.js";
import type { LinkRequest, LinkResponseMap } from "./messages.js";
import type { HandoffView, LinkPlatform, LinkStatusView, LinkedDeviceView, PairingView } from "./views.js";

export const LINK_KV = {
  deviceId: "clip/link/device-id",
  devices: "clip/link/devices",
  settings: "clip/link/settings",
  handoffs: "clip/link/handoffs",
} as const;

interface StoredDevice {
  id: string;
  name: string;
  platform: string;
  purpose: Purpose;
  role: Role;
  servesRequests: boolean;
  transport: "relay" | "native";
  relay?: string;
  /** Derived link secret (base64url). Lets this device *ask* the other one; every signature is still approved there. */
  secret: string;
  pairedAt: number;
  lastSeenAt?: number;
}

interface Settings {
  syncEnabled: boolean;
  signerDeviceId: string | null;
  lastSyncAt?: number;
  syncError?: string;
}

/** Something that can open a native-messaging port to Clip Desktop (extension only). */
export interface NativeConnector {
  connect(): BaseChannel;
  /** Ask for the optional "nativeMessaging" permission (from a click). */
  requestPermission?(): Promise<boolean>;
}

export interface LinkServiceDeps {
  platform: LinkPlatform;
  deviceName(): string;
  kv: LinkKV;
  vault: LinkVault;
  fetch?: typeof fetch;
  WebSocket?: WebSocketCtor;
  /** https origin of services/link-relay. Unset = phone pairing and moving a wallet are hidden. */
  relayUrl?: string;
  /** https origin of services/backup (sync endpoints). Unset = sync hidden. */
  syncUrl?: string;
  /** Wallet state that syncs (link/sync/sources.ts walletSources + contactsSource). */
  sources?: () => SyncSource[];
  /** Desktop / mobile: the engine, to serve requests from paired extensions. */
  signerHost?: SignerHost;
  /** Extension: Clip Desktop over native messaging. */
  native?: NativeConnector;
  /** Restores a handed-off connection after the person tapped "Continue". */
  grantOrigin?(origin: string, families: Family[]): Promise<void>;
  onChange?(): void;
  /** A paired device sent "continue on this device" (extension: show a notification). */
  onIncomingHandoff?(h: HandoffView): void;
  now?: () => number;
}

interface Run {
  view: PairingView;
  channel?: Channel;
  pending?: PendingPairing;
  paired?: Paired;
  transport: "relay" | "native";
  relay?: string;
}

const unavailable = (what: string) => new ClipError(`${what} isn't available in this build.`, "link/off");
const notFound = () => new ClipError("That pairing has ended. Start again.", "link/not-found");

export class LinkService implements RemoteMode {
  readonly grants: RemoteGrants;
  private readonly runs = new Map<string, Run>();
  private readonly sessions = new Map<string, SecureSession>();
  private readonly signers = new Map<string, RemoteSigner>();
  private readonly online = new Set<string>();
  private serving = false;
  private readonly stops = new Set<() => void>();
  private settingsCache?: Settings;
  private devicesCache?: StoredDevice[];
  private readonly now: () => number;

  constructor(private readonly d: LinkServiceDeps) {
    this.grants = new RemoteGrants(d.kv);
    this.now = d.now ?? Date.now;
  }

  /* ------------------------------------------------------------------ storage */

  private async settings(): Promise<Settings> {
    this.settingsCache ??= { syncEnabled: false, signerDeviceId: null, ...((await this.d.kv.get<Settings>(LINK_KV.settings)) ?? {}) };
    return this.settingsCache;
  }
  private async saveSettings(patch: Partial<Settings>) {
    this.settingsCache = { ...(await this.settings()), ...patch };
    await this.d.kv.set(LINK_KV.settings, this.settingsCache);
  }
  private async devices(): Promise<StoredDevice[]> {
    this.devicesCache ??= (await this.d.kv.get<StoredDevice[]>(LINK_KV.devices)) ?? [];
    return this.devicesCache;
  }
  private async saveDevices(list: StoredDevice[]) {
    this.devicesCache = list;
    await this.d.kv.set(LINK_KV.devices, list);
  }
  async deviceId(): Promise<string> {
    let id = await this.d.kv.get<string>(LINK_KV.deviceId);
    if (!id) {
      id = b64url(randomBytes(9));
      await this.d.kv.set(LINK_KV.deviceId, id);
    }
    return id;
  }
  private changed() {
    this.d.onChange?.();
  }

  /** Call once the host has loaded (preloads settings so `active()` answers synchronously). */
  async init(): Promise<void> {
    await this.settings();
    await this.devices();
  }

  /* ------------------------------------------------------------------ requests */

  async handle<T extends LinkRequest["type"]>(m: Extract<LinkRequest, { type: T }>): Promise<LinkResponseMap[T]> {
    return (await this.dispatch(m as LinkRequest)) as LinkResponseMap[T];
  }

  private async dispatch(m: LinkRequest): Promise<unknown> {
    switch (m.type) {
      case "linkStatus":
        return this.status();
      case "linkPairStart":
        return this.startPairing(m.purpose, m.direction);
      case "linkPairScan":
        return this.scan(m.uri, m.direction);
      case "linkDesktopPair":
        return this.desktopPair();
      case "linkPairConfirm":
        return this.confirm(m.id, m.match);
      case "linkPairCancel":
        return this.cancel(m.id);
      case "linkTransferSend":
        return this.transferSend(m.id, m.password);
      case "linkTransferReceive":
        return this.transferReceive(m.id, m.password);
      case "linkDeviceRemove":
        return this.removeDevice(m.id);
      case "linkDeviceRename":
        return this.renameDevice(m.id, m.name);
      case "linkUseSigner":
        return this.useSigner(m.deviceId);
      case "linkSyncSet":
        return this.setSync(m.enabled);
      case "linkSyncNow":
        return void (await this.syncNow());
      case "linkSyncDelete":
        return this.deleteSync();
      case "linkHandoffCreate":
        return { link: await this.handoffLink(m.url, m.families) };
      case "linkHandoffSend":
        return this.handoffSend(m.deviceId, m.url, m.families);
      case "linkHandoffOpen":
        return this.handoffOpen(m.link);
      case "linkHandoffAccept":
        return this.handoffAccept(m.id);
      case "linkHandoffDismiss":
        return this.handoffDismiss(m.id);
    }
  }

  async status(): Promise<LinkStatusView> {
    const s = await this.settings();
    const devs = await this.devices();
    const signerDev = devs.find((x) => x.id === s.signerDeviceId);
    const signer = signerDev ? this.signers.get(signerDev.id) : undefined;
    return {
      platform: this.d.platform,
      devices: devs.map((x) => this.deviceView(x)),
      sync: { available: !!this.d.syncUrl, enabled: s.syncEnabled, ...(s.lastSyncAt ? { lastSyncAt: s.lastSyncAt } : {}), ...(s.syncError ? { error: s.syncError } : {}) },
      signer: {
        deviceId: signerDev?.id ?? null,
        ...(signerDev ? { deviceName: signerDev.name } : {}),
        online: !!signer?.online,
        waiting: signer?.waiting() ?? [],
      },
      pairings: [...this.runs.values()].map((r) => r.view),
      handoffs: (await this.d.kv.get<HandoffView[]>(LINK_KV.handoffs)) ?? [],
      capabilities: { relay: !!(this.d.relayUrl && this.d.WebSocket), desktop: this.d.platform === "desktop" || !!this.d.native, sync: !!this.d.syncUrl },
    };
  }

  private deviceView(x: StoredDevice): LinkedDeviceView {
    return {
      id: x.id,
      name: x.name,
      platform: x.platform,
      purpose: x.purpose,
      servesRequests: x.servesRequests,
      pairedAt: x.pairedAt,
      ...(x.lastSeenAt ? { lastSeenAt: x.lastSeenAt } : {}),
      online: this.online.has(x.id) || !!this.signers.get(x.id)?.online,
    };
  }

  /* ------------------------------------------------------------------ pairing */

  private me() {
    return { name: this.d.deviceName().slice(0, 60), platform: this.d.platform };
  }

  private relayChannel(channel: string, role: "a" | "b", relay = this.d.relayUrl): RelayChannel {
    if (!relay || !this.d.WebSocket) throw unavailable("Linking with a phone");
    return new RelayChannel({ relay, channel, role, WebSocket: this.d.WebSocket, keepaliveMs: 20_000 });
  }

  private newRun(view: Omit<PairingView, "id">, transport: "relay" | "native", relay?: string): Run {
    for (const [id, r] of this.runs) if (r.view.state === "done" || r.view.state === "failed") this.runs.delete(id);
    const run: Run = { view: { id: b64url(randomBytes(9)), ...view }, transport, ...(relay ? { relay } : {}) };
    this.runs.set(run.view.id, run);
    return run;
  }

  private fail(run: Run, e: unknown) {
    const err =
      e instanceof PairingError
        ? { code: `link/${e.code}`, userMessage: pairingMessage(e.code) }
        : e instanceof ClipError
          ? { code: e.code, userMessage: e.userMessage }
          : { code: "link/failed", userMessage: "Linking didn't work. Start again on both devices." };
    run.view = { ...run.view, state: "failed", error: err };
    run.channel?.close("failed");
    this.changed();
  }

  private follow(run: Run, p: Promise<PendingPairing>) {
    p.then(
      (pending) => {
        run.pending = pending;
        run.view = { ...run.view, state: "compare", sas: pending.sas, peerName: pending.peer.name };
        this.changed();
      },
      (e) => this.fail(run, e),
    );
  }

  /** Shows a QR (this device is the initiator). */
  async startPairing(purpose: "signer" | "device-add", direction?: "send" | "receive"): Promise<PairingView> {
    if (!this.d.relayUrl || !this.d.WebSocket) throw unavailable("Linking with a phone");
    const key = this.d.vault.pairingKey();
    const offer = newOffer({ key, purpose, relay: this.d.relayUrl, name: this.me().name });
    const dir = purpose === "device-add" ? (direction ?? ((await this.d.vault.status()) === "empty" ? "receive" : "send")) : undefined;
    const run = this.newRun({ purpose, uri: offerToUri(offer), state: "waiting", ...(dir ? { direction: dir } : {}) }, "relay", this.d.relayUrl);
    const ch = this.relayChannel(offer.channel, "a");
    run.channel = ch;
    this.follow(run, pair({ channel: ch, role: "i", key, ctx: contextFromOffer(offer, "i"), me: this.me(), timeoutMs: 10 * 60_000 }));
    return run.view;
  }

  /** Scanned someone else's QR (this device is the responder). */
  async scan(uri: string, direction?: "send" | "receive"): Promise<PairingView> {
    const offer = parseOfferUri(uri);
    if (!offer || !offer.relay) throw new ClipError("That isn't a Clip pairing code.", "link/bad-code");
    if (!this.d.WebSocket) throw unavailable("Linking with another device");
    const key = this.d.vault.pairingKey();
    const dir = offer.purpose === "device-add" ? (direction ?? ((await this.d.vault.status()) === "empty" ? "receive" : "send")) : undefined;
    const run = this.newRun({ purpose: offer.purpose, state: "connecting", peerName: offer.name, ...(dir ? { direction: dir } : {}) }, "relay", offer.relay);
    const ch = this.relayChannel(offer.channel, "b", offer.relay);
    run.channel = ch;
    this.follow(run, pair({ channel: ch, role: "r", key, ctx: contextFromOffer(offer, "r"), me: this.me() }));
    this.changed();
    return run.view;
  }

  /** Extension: pair with Clip Desktop on this computer (a code shows in both apps). */
  async desktopPair(): Promise<PairingView> {
    if (!this.d.native) throw unavailable("Clip Desktop");
    if (this.d.native.requestPermission && !(await this.d.native.requestPermission())) {
      throw new ClipError("Allow the connection to Clip Desktop to continue.", "link/permission");
    }
    const key = this.d.vault.pairingKey();
    const run = this.newRun({ purpose: "desktop", state: "connecting" }, "native");
    const ch = this.d.native.connect();
    run.channel = ch;
    ch.send(JSON.stringify({ t: "intent", kind: "pair" }));
    this.follow(run, pair({ channel: ch, role: "i", key, ctx: nativeContext(), me: this.me() }));
    return run.view;
  }

  /** Desktop app: a native-messaging host connected (from startDesktopLinkServer). */
  async acceptNative(ch: Channel): Promise<void> {
    let intent: { kind?: string; device?: string };
    try {
      intent = await nextFrame(ch, (m): m is { t: "intent"; kind: string; device?: string } => !!m && typeof m === "object" && (m as { t?: string }).t === "intent", 30_000);
    } catch {
      ch.close("no intent");
      return;
    }
    if (intent.kind === "pair") {
      const key = this.d.vault.pairingKey();
      const run = this.newRun({ purpose: "desktop", state: "connecting" }, "native");
      run.channel = ch;
      this.follow(run, pair({ channel: ch, role: "r", key, ctx: nativeContext(), me: this.me() }));
      this.changed();
      return;
    }
    const dev = (await this.devices()).find((x) => x.id === intent.device && x.transport === "native");
    if (!dev || !this.d.signerHost) {
      ch.close("unknown device");
      return;
    }
    try {
      // Same tick: the extension can't answer before openSession is listening.
      ch.send(JSON.stringify({ t: "intent-ok" }));
      const s = await openSession(ch, fromB64url(dev.secret), dev.role);
      this.attachServing(dev, s);
    } catch {
      ch.close("handshake");
    }
  }

  async confirm(id: string, match: boolean): Promise<PairingView> {
    const run = this.runs.get(id);
    if (!run?.pending) throw notFound();
    if (!match) {
      run.pending.reject("mismatch");
      run.view = { ...run.view, state: "failed", error: { code: "link/rejected", userMessage: pairingMessage("rejected") } };
      run.channel?.close("rejected");
      this.changed();
      return run.view;
    }
    run.view = { ...run.view, state: "confirming" };
    this.changed();
    run.pending.confirm().then(
      async (paired) => {
        run.paired = paired;
        if (run.view.purpose === "device-add") {
          run.view = { ...run.view, state: "password" };
        } else {
          await this.remember(run, paired);
          run.view = { ...run.view, state: "done" };
          run.channel?.close("paired");
        }
        this.changed();
      },
      (e) => this.fail(run, e),
    );
    return run.view;
  }

  async cancel(id: string): Promise<void> {
    const run = this.runs.get(id);
    if (!run) return;
    run.pending?.reject("cancelled");
    run.channel?.close("cancelled");
    this.runs.delete(id);
    this.changed();
  }

  private async remember(run: Run, paired: Paired) {
    const id = b64url(hkdf32(paired.linkSecret, new Uint8Array(0), "clip/link/v1/device-id", 12));
    const servesRequests = this.d.platform !== "extension";
    const dev: StoredDevice = {
      id,
      name: paired.peer.name || "Device",
      platform: paired.peer.platform || "",
      purpose: run.view.purpose,
      role: paired.role,
      servesRequests,
      transport: run.transport,
      ...(run.relay ? { relay: run.relay } : {}),
      secret: b64url(paired.linkSecret),
      pairedAt: this.now(),
    };
    await this.saveDevices([...(await this.devices()).filter((x) => x.id !== id), dev]);
    if (servesRequests && this.serving && dev.transport === "relay") this.serveDevice(dev);
  }

  /* ------------------------------------------------------------------ moving a wallet */

  async transferSend(id: string, password: string): Promise<PairingView> {
    const run = this.runs.get(id);
    if (!run?.paired || !run.channel || run.view.state !== "password") throw notFound();
    run.view = { ...run.view, state: "transferring" };
    this.changed();
    try {
      // Throws vault/wrong-password before anything leaves this device; the person can try again.
      await sendWallet({ channel: run.channel, paired: run.paired, vault: this.d.vault, password });
      run.view = { ...run.view, state: "done" };
    } catch (e) {
      if (e instanceof ClipError && e.code === "vault/wrong-password") {
        run.view = { ...run.view, state: "password" };
        this.changed();
        throw e;
      }
      this.fail(run, e);
    }
    run.paired.linkSecret.fill(0);
    this.changed();
    return run.view;
  }

  async transferReceive(id: string, password: string): Promise<PairingView> {
    const run = this.runs.get(id);
    if (!run?.paired || !run.channel || run.view.state !== "password") throw notFound();
    if ((await this.d.vault.status()) !== "empty") throw new ClipError("This device already has a wallet. Remove it first to add another one here.", "link/has-wallet");
    run.view = { ...run.view, state: "transferring" };
    this.changed();
    try {
      await receiveWallet({ channel: run.channel, paired: run.paired, vault: this.d.vault, password });
      run.view = { ...run.view, state: "done" };
    } catch (e) {
      this.fail(run, e);
    }
    run.paired.linkSecret.fill(0);
    this.changed();
    return run.view;
  }

  /* ------------------------------------------------------------------ devices */

  async removeDevice(id: string): Promise<void> {
    await this.saveDevices((await this.devices()).filter((x) => x.id !== id));
    this.sessions.get(id)?.close("removed");
    this.signers.get(id)?.close();
    this.signers.delete(id);
    if ((await this.settings()).signerDeviceId === id) {
      await this.saveSettings({ signerDeviceId: null });
      await this.grants.clear();
    }
    this.changed();
  }

  async renameDevice(id: string, name: string): Promise<void> {
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
    if (!clean) return;
    await this.saveDevices((await this.devices()).map((x) => (x.id === id ? { ...x, name: clean } : x)));
    this.changed();
  }

  /* ------------------------------------------------------------------ remote signer (extension side) */

  /** RemoteMode: true while dapp requests go to another device. */
  active(): boolean {
    const id = this.settingsCache?.signerDeviceId;
    return !!id && !!this.devicesCache?.some((x) => x.id === id);
  }

  signer(): RemoteSigner | undefined {
    const id = this.settingsCache?.signerDeviceId;
    const dev = this.devicesCache?.find((x) => x.id === id);
    return dev ? this.signerFor(dev) : undefined;
  }

  async useSigner(deviceId: string | null): Promise<void> {
    if (deviceId !== null) {
      const dev = (await this.devices()).find((x) => x.id === deviceId);
      if (!dev || dev.servesRequests) throw notFound();
    }
    const prev = (await this.settings()).signerDeviceId;
    if (prev !== deviceId) await this.grants.clear();
    await this.saveSettings({ signerDeviceId: deviceId });
    this.changed();
  }

  private signerFor(dev: StoredDevice): RemoteSigner {
    let s = this.signers.get(dev.id);
    if (s) return s;
    s = new RemoteSigner({
      connect: () => this.connectTo(dev),
      onChange: () => this.changed(),
      onHandoff: (h) => void this.incomingHandoff(dev, h.url, h.token),
    });
    this.signers.set(dev.id, s);
    return s;
  }

  private async connectTo(dev: StoredDevice): Promise<SecureSession> {
    const secret = fromB64url(dev.secret);
    let ch: Channel;
    if (dev.transport === "native") {
      if (!this.d.native) throw unavailable("Clip Desktop");
      const nc = this.d.native.connect();
      // Wait for the desktop app to find this pairing before the handshake, so no frame is sent into the void.
      const ready = nextFrame(nc, (m): m is { t: "intent-ok" } => !!m && typeof m === "object" && (m as { t?: string }).t === "intent-ok", 15_000);
      nc.send(JSON.stringify({ t: "intent", kind: "resume", device: dev.id }));
      await ready;
      ch = nc;
    } else {
      const rc = this.relayChannel(pairedChannelId(secret), dev.role === "i" ? "a" : "b", dev.relay);
      await rc.ready();
      ch = rc;
    }
    // The phone may need a moment to open the app: wait up to 2 minutes for it to answer.
    const s = await openSession(ch, secret, dev.role, 120_000);
    await this.touch(dev.id);
    return s;
  }

  private async touch(id: string) {
    await this.saveDevices((await this.devices()).map((x) => (x.id === id ? { ...x, lastSeenAt: this.now() } : x)));
  }

  /* ------------------------------------------------------------------ serving (desktop / phone side) */

  /** Phone / desktop: listen for paired extensions on the relay (call when the app comes to the foreground). */
  async startServing(): Promise<void> {
    if (this.serving || !this.d.signerHost) return;
    this.serving = true;
    for (const dev of await this.devices()) if (dev.servesRequests && dev.transport === "relay") this.serveDevice(dev);
  }

  stopServing(): void {
    this.serving = false;
    for (const s of [...this.stops]) s();
    this.stops.clear();
    for (const s of this.sessions.values()) s.close("stopped");
    this.sessions.clear();
    this.online.clear();
    this.changed();
  }

  private serveDevice(dev: StoredDevice) {
    let stopped = false;
    let backoff = 2000;
    let current: Channel | undefined;
    const stop = () => {
      stopped = true;
      current?.close("stopped");
    };
    this.stops.add(stop);
    const loop = async () => {
      while (!stopped && this.serving && (await this.devices()).some((x) => x.id === dev.id)) {
        try {
          const secret = fromB64url(dev.secret);
          const ch = this.relayChannel(pairedChannelId(secret), dev.role === "i" ? "a" : "b", dev.relay);
          current = ch;
          await ch.ready();
          backoff = 2000;
          const s = await openSession(ch, secret, dev.role, 10 * 60_000);
          // The extension reconnected (new handshake waiting): start over.
          ch.peer.on((present) => present && s.close("peer reconnected"));
          this.attachServing(dev, s);
          await new Promise<void>((r) => s.onClose(() => r()));
        } catch {
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 30_000);
        }
      }
      this.stops.delete(stop);
    };
    void loop();
  }

  private attachServing(dev: StoredDevice, s: SecureSession) {
    if (!this.d.signerHost) return;
    this.sessions.get(dev.id)?.close("replaced");
    this.sessions.set(dev.id, s);
    this.online.add(dev.id);
    void this.touch(dev.id);
    const stop = serveSigner(s, this.d.signerHost, {
      peerName: dev.name,
      pairingId: dev.id,
      onHandoff: (h) => void this.incomingHandoff(dev, h.url, h.token),
    });
    s.onClose(() => {
      stop();
      if (this.sessions.get(dev.id) === s) {
        this.sessions.delete(dev.id);
        this.online.delete(dev.id);
      }
      this.changed();
    });
    this.changed();
  }

  /* ------------------------------------------------------------------ settings sync */

  private engine?: SyncEngine;

  private async syncEngine(): Promise<SyncEngine> {
    if (!this.d.syncUrl) throw unavailable("Sync");
    this.engine ??= new SyncEngine({
      baseUrl: this.d.syncUrl,
      fetch: this.d.fetch ?? globalThis.fetch.bind(globalThis),
      keys: () => this.d.vault.syncKeys(),
      kv: this.d.kv,
      device: await this.deviceId(),
      now: this.now,
    });
    return this.engine;
  }

  async setSync(enabled: boolean): Promise<void> {
    await this.saveSettings({ syncEnabled: enabled, ...(enabled ? {} : { syncError: undefined }) });
    if (enabled) await this.syncNow().catch(() => undefined);
    this.changed();
  }

  /** Runs one sync round if sync is on and the wallet is unlocked. Hosts call it on a timer and after edits. */
  async syncNow(): Promise<boolean> {
    const s = await this.settings();
    if (!s.syncEnabled || !this.d.syncUrl) return false;
    if ((await this.d.vault.status()) !== "unlocked") return false;
    try {
      const e = await this.syncEngine();
      await e.syncSources(this.d.sources?.() ?? []);
      await this.saveSettings({ lastSyncAt: this.now(), syncError: undefined });
      return true;
    } catch (err) {
      await this.saveSettings({ syncError: err instanceof ClipError ? err.userMessage : "Sync didn't work this time." });
      throw err;
    } finally {
      this.changed();
    }
  }

  async deleteSync(): Promise<void> {
    const e = await this.syncEngine();
    await e.deleteRemote();
    await this.saveSettings({ syncEnabled: false, lastSyncAt: undefined, syncError: undefined });
    this.changed();
  }

  /* ------------------------------------------------------------------ continue elsewhere */

  private async dataKey(): Promise<Uint8Array | undefined> {
    if ((await this.d.vault.status()) !== "unlocked") return undefined;
    return (await this.d.vault.syncKeys()).dataKey;
  }

  async handoffLink(url: string, families: string[]): Promise<string> {
    const dataKey = await this.dataKey();
    return buildHandoffLink({ url, families, ...(dataKey ? { dataKey } : {}), now: this.now() });
  }

  async handoffSend(deviceId: string, url: string, families: string[]): Promise<void> {
    const dev = (await this.devices()).find((x) => x.id === deviceId);
    if (!dev) throw notFound();
    const link = parseHandoffLink(await this.handoffLink(url, families))!;
    const live = this.sessions.get(dev.id);
    if (live?.isOpen) {
      live.send({ t: "handoff", url: link.url, ...(link.token ? { token: link.token } : {}) });
      return;
    }
    if (dev.servesRequests) throw new ClipError("Your other device isn't connected right now. Open Clip there and try again.", "link/unreachable");
    await this.signerFor(dev).handoff(link.url, link.token);
  }

  private async addHandoff(h: HandoffView) {
    const list = ((await this.d.kv.get<HandoffView[]>(LINK_KV.handoffs)) ?? []).filter((x) => x.url !== h.url && this.now() - x.at < 60 * 60_000);
    await this.d.kv.set(LINK_KV.handoffs, [h, ...list].slice(0, 10));
    this.changed();
  }

  private async incomingHandoff(dev: StoredDevice, url: string, token?: string) {
    const origin = httpsOrigin(url);
    if (!origin) return;
    const dataKey = token ? await this.dataKey().catch(() => undefined) : undefined;
    const claims = token && dataKey ? openHandoffToken(token, url, dataKey, this.now()) : null;
    const h: HandoffView = { id: b64url(randomBytes(9)), url, origin, verified: !!claims, families: claims?.families ?? [], from: dev.name, at: this.now() };
    await this.addHandoff(h);
    this.d.onIncomingHandoff?.(h);
  }

  async handoffOpen(link: string): Promise<HandoffView> {
    const p = parseHandoffLink(link);
    if (!p) throw new ClipError("That link can't be opened here.", "link/bad-handoff");
    const dataKey = p.token ? await this.dataKey().catch(() => undefined) : undefined;
    const claims = p.token && dataKey ? openHandoffToken(p.token, p.url, dataKey, this.now()) : null;
    const h: HandoffView = { id: b64url(randomBytes(9)), url: p.url, origin: httpsOrigin(p.url)!, verified: !!claims, families: claims?.families ?? [], at: this.now() };
    await this.addHandoff(h);
    return h;
  }

  /** The person tapped "Continue": restore the connection (only for a verified handoff) and return the URL to open. */
  async handoffAccept(id: string): Promise<{ url: string }> {
    const list = (await this.d.kv.get<HandoffView[]>(LINK_KV.handoffs)) ?? [];
    const h = list.find((x) => x.id === id);
    if (!h) throw notFound();
    if (h.verified && h.families.length && this.d.grantOrigin) await this.d.grantOrigin(h.origin, h.families as Family[]);
    await this.d.kv.set(LINK_KV.handoffs, list.filter((x) => x.id !== id));
    this.changed();
    return { url: h.url };
  }

  async handoffDismiss(id: string): Promise<void> {
    await this.d.kv.set(LINK_KV.handoffs, ((await this.d.kv.get<HandoffView[]>(LINK_KV.handoffs)) ?? []).filter((x) => x.id !== id));
    this.changed();
  }
}

function nativeContext(): PairingContext {
  return { purpose: "desktop", channel: "native", secret: new Uint8Array(0) };
}

export function pairingMessage(code: PairingError["code"]): string {
  switch (code) {
    case "mismatch":
      return "The codes didn't match, so nothing was connected. Start again on both devices.";
    case "rejected":
      return "Linking was cancelled. Nothing was connected.";
    case "timeout":
      return "The other device didn't answer in time. Start again on both devices.";
    case "bad-key":
      return "Something interfered with the connection, so it was stopped. Start again on both devices.";
    case "bad-offer":
      return "The two devices were set up for different things. Start again on both devices.";
    default:
      return "The connection to the other device closed. Start again on both devices.";
  }
}
