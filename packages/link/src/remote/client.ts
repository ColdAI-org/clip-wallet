/**
 * The extension side of "use another device as the signer". It forwards connect and signing requests to the
 * paired device and waits; the person approves (or rejects) on the device that holds the keys. While it waits
 * the extension can show what that device decoded ("Waiting for your phone: Send 10 USDC to 0x12…ab").
 */
import { ClipError, type Account, type DappRequest, type Family } from "@clip-wallet/core";
import type { SecureSession } from "../pairing/session.js";
import { FromSigner, type PublicAccount } from "./protocol.js";

export interface WaitingView {
  id: string;
  origin: string;
  kind: "connect" | "request";
  title?: string;
  lines?: { label: string; value: string }[];
  blind?: boolean;
  since: number;
}

export interface RemoteSignerOptions {
  /** Opens (or reopens) the encrypted session to the paired device. */
  connect(): Promise<SecureSession>;
  /** How long to wait for the person to approve on the other device. */
  approvalTimeoutMs?: number;
  now?: () => number;
  onChange?(): void;
  onHandoff?(h: { url: string; token?: string }): void;
}

const unreachable = () => new ClipError("Your other device didn't answer. Open Clip there and try again.", "link/unreachable");
const timedOut = () => new ClipError("Nobody approved this on your other device in time. Try again.", "link/timeout");

let seq = 0;

export class RemoteSigner {
  private session?: SecureSession;
  private opening?: Promise<SecureSession>;
  private readonly waits = new Map<string, { view: WaitingView; resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly now: () => number;
  private accountsCache: PublicAccount[] = [];

  constructor(private readonly o: RemoteSignerOptions) {
    this.now = o.now ?? Date.now;
  }

  get online(): boolean {
    return !!this.session?.isOpen;
  }

  waiting(): WaitingView[] {
    return [...this.waits.values()].map((w) => w.view);
  }

  async ensure(): Promise<SecureSession> {
    if (this.session?.isOpen) return this.session;
    this.opening ??= this.o
      .connect()
      .then((s) => {
        this.session = s;
        s.onMessage((m) => this.receive(m));
        s.onClose(() => {
          this.session = undefined;
          this.o.onChange?.();
        });
        this.o.onChange?.();
        return s;
      })
      .finally(() => {
        this.opening = undefined;
      });
    try {
      return await this.opening;
    } catch {
      throw unreachable();
    }
  }

  close() {
    this.session?.close("closed");
    for (const [id, w] of this.waits) {
      clearTimeout(w.timer);
      w.reject(unreachable());
      this.waits.delete(id);
    }
  }

  /** Public accounts of the other device (cached). */
  async accounts(): Promise<PublicAccount[]> {
    const s = await this.ensure();
    const got = new Promise<PublicAccount[]>((resolve) => {
      const off = s.onMessage((m) => {
        const p = FromSigner.safeParse(m);
        if (p.success && p.data.t === "accounts") {
          off();
          resolve(p.data.accounts as PublicAccount[]);
        }
      });
      setTimeout(() => {
        off();
        resolve(this.accountsCache);
      }, 10_000);
    });
    s.send({ t: "accounts" });
    this.accountsCache = await got;
    return this.accountsCache;
  }

  async connectApp(p: { origin: string; family: Family; networkId: string; name?: string; iconUrl?: string }): Promise<{ approved: boolean; accounts: Account[] }> {
    const id = `c${++seq}-${this.now()}`;
    const v = (await this.call(id, { t: "connect", id, ...p }, { id, origin: p.origin, kind: "connect", since: this.now() })) as { approved?: boolean; accounts?: Account[] };
    return { approved: !!v?.approved, accounts: Array.isArray(v?.accounts) ? v.accounts : [] };
  }

  request(req: DappRequest, dapp?: { name?: string; iconUrl?: string }): Promise<unknown> {
    const id = `r${++seq}-${this.now()}`;
    return this.call(id, { t: "request", id, request: req, ...(dapp ? { dapp } : {}) }, { id, origin: req.origin, kind: "request", since: this.now() });
  }

  /** Cancels a waiting request by its dapp request id. */
  cancelRequest(requestId: string) {
    for (const [id, w] of this.waits) {
      if (id === requestId || w.view.id === requestId) {
        try {
          this.session?.send({ t: "cancel", id });
        } catch {
          /* closed */
        }
        clearTimeout(w.timer);
        this.waits.delete(id);
        w.reject(new ClipError("This request was cancelled.", "link/cancelled"));
      }
    }
    this.o.onChange?.();
  }

  async handoff(url: string, token?: string) {
    const s = await this.ensure();
    s.send({ t: "handoff", url, ...(token ? { token } : {}) });
  }

  private async call(id: string, msg: unknown, view: WaitingView): Promise<unknown> {
    const s = await this.ensure();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waits.delete(id);
        try {
          s.send({ t: "cancel", id });
        } catch {
          /* closed */
        }
        reject(timedOut());
        this.o.onChange?.();
      }, this.o.approvalTimeoutMs ?? 5 * 60_000);
      this.waits.set(id, { view, resolve, reject, timer });
      this.o.onChange?.();
      try {
        s.send(msg);
      } catch {
        clearTimeout(timer);
        this.waits.delete(id);
        reject(unreachable());
      }
      s.onClose(() => {
        const w = this.waits.get(id);
        if (!w) return;
        clearTimeout(w.timer);
        this.waits.delete(id);
        w.reject(unreachable());
        this.o.onChange?.();
      });
    });
  }

  private receive(raw: unknown) {
    const p = FromSigner.safeParse(raw);
    if (!p.success) return;
    const m = p.data;
    if (m.t === "handoff") {
      this.o.onHandoff?.({ url: m.url, ...(m.token ? { token: m.token } : {}) });
      return;
    }
    if (m.t === "decoded") {
      const w = this.waits.get(m.id);
      if (w) {
        w.view = { ...w.view, title: m.title, lines: m.lines, blind: m.blind };
        this.o.onChange?.();
      }
      return;
    }
    if (m.t !== "result") return;
    const w = this.waits.get(m.id);
    if (!w) return;
    clearTimeout(w.timer);
    this.waits.delete(m.id);
    if (m.ok) w.resolve(m.value);
    else w.reject(new ClipError(m.error?.userMessage ?? "The request didn't go through on your other device.", m.error?.code ?? "link/failed"));
    this.o.onChange?.();
  }
}
