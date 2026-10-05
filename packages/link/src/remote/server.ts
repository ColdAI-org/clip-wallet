/**
 * The key-holding side of "use another device as the signer" (Clip Desktop for the extension, the phone for
 * Clip Link). Requests from the paired extension enter the same path as any dapp request on this device: the
 * engine decodes them, the approval shows HERE (the app that holds the keys), and only an approved request is
 * signed. The extension only ever gets back what a dapp would get (accounts, signatures, transaction hashes).
 */
import type { Account, DappRequest, DecodedRequest, Family } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import type { SecureSession } from "../pairing/session.js";
import { ToSigner, toPublicAccount, type FromSigner, type PublicAccount } from "./protocol.js";

/** The subset of the engine's DappHost the signer side uses (WalletEngine satisfies it). */
export interface SignerHost {
  approveConnect(p: { origin: string; family: Family; networkId: string; via: "injected" | "walletconnect"; name?: string; iconUrl?: string }): Promise<boolean>;
  accountsFor(origin: string, family: Family): Promise<Account[]>;
  request(req: DappRequest, dapp?: { name?: string; iconUrl?: string }): Promise<unknown>;
  cancel(requestId: string): void;
  /** Optional: lets the extension show what the signer decoded while it waits. */
  decode?(req: DappRequest): Promise<DecodedRequest>;
  /** Optional: public accounts to show in the extension before any app connects. */
  listAccounts?(): Promise<Account[]>;
}

export interface ServeOptions {
  /** The paired device's name, shown in approvals ("uniswap.org · via Chrome on Mac"). */
  peerName: string;
  /** Stable id of the pairing: request ids are namespaced with it. */
  pairingId: string;
  onHandoff?(h: { url: string; token?: string }): void;
}

function errorOf(e: unknown): { userMessage: string; code: string } {
  if (e instanceof ClipError) return { userMessage: e.userMessage, code: e.code };
  const u = e as { userMessage?: unknown; code?: unknown; message?: unknown } | null;
  if (u && typeof u.userMessage === "string" && typeof u.code === "string") return { userMessage: u.userMessage, code: u.code };
  return { userMessage: "The request didn't go through on your other device.", code: "link/failed" };
}

/** Serves one session until it closes. Returns a stop function. */
export function serveSigner(session: SecureSession, host: SignerHost, o: ServeOptions): () => void {
  const inflight = new Map<string, string>();
  const send = (m: FromSigner) => {
    if (session.isOpen) session.send(m);
  };
  const ns = (id: string) => `link:${o.pairingId.slice(0, 12)}:${id}`;
  const label = (name: string | undefined, origin: string) => `${(name || new URL(origin).hostname).slice(0, 60)} · via ${o.peerName}`.slice(0, 100);

  const off = session.onMessage(async (raw) => {
    const parsed = ToSigner.safeParse(raw);
    if (!parsed.success) return;
    const m = parsed.data;
    switch (m.t) {
      case "ping":
        return send({ t: "pong" });
      case "accounts": {
        const accounts = host.listAccounts ? await host.listAccounts().catch(() => []) : [];
        return send({ t: "accounts", accounts: accounts.map((a) => toPublicAccount(a as unknown as PublicAccount & Record<string, unknown>)) });
      }
      case "handoff":
        o.onHandoff?.({ url: m.url, ...(m.token ? { token: m.token } : {}) });
        return;
      case "cancel": {
        const local = inflight.get(m.id);
        if (local) host.cancel(local);
        return;
      }
      case "connect": {
        try {
          const approved = await host.approveConnect({
            origin: m.origin,
            family: m.family as Family,
            networkId: m.networkId,
            via: "injected",
            name: label(m.name, m.origin),
            ...(m.iconUrl ? { iconUrl: m.iconUrl } : {}),
          });
          const accounts = approved ? await host.accountsFor(m.origin, m.family as Family) : [];
          send({ t: "result", id: m.id, ok: true, value: { approved, accounts: accounts.map((a) => toPublicAccount(a as unknown as PublicAccount & Record<string, unknown>)) } });
        } catch (e) {
          send({ t: "result", id: m.id, ok: false, error: errorOf(e) });
        }
        return;
      }
      case "request": {
        const req = m.request as DappRequest;
        const local: DappRequest = { ...req, id: ns(req.id), via: "injected" };
        try {
          // Same rule as a dapp in this device's own browser: connect first.
          if (!(await host.accountsFor(req.origin, req.family)).length) {
            throw new ClipError("Connect this app first, then try again.", "link/not-connected");
          }
          inflight.set(m.id, local.id);
          if (host.decode) {
            void host
              .decode(local)
              .then((d) => send({ t: "decoded", id: m.id, title: d.title.slice(0, 300), lines: d.lines.slice(0, 40).map((l) => ({ label: l.label.slice(0, 100), value: l.value.slice(0, 500) })), blind: d.blind }))
              .catch(() => undefined);
          }
          const value = await host.request(local, { name: label(m.dapp?.name, req.origin), ...(m.dapp?.iconUrl ? { iconUrl: m.dapp.iconUrl } : {}) });
          send({ t: "result", id: m.id, ok: true, value });
        } catch (e) {
          send({ t: "result", id: m.id, ok: false, error: errorOf(e) });
        } finally {
          inflight.delete(m.id);
        }
        return;
      }
    }
  });
  const offClose = session.onClose(() => {
    for (const local of inflight.values()) host.cancel(local);
    inflight.clear();
  });
  return () => {
    off();
    offClose();
  };
}
