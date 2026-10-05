/**
 * Settings → Linked devices: sign on your phone or in Clip Desktop, sync settings, move this wallet to another
 * device, and continue a page elsewhere. Pairing always ends with the same 6-digit code on both screens; the
 * person compares them before anything is linked or sent.
 */
import { useCallback, useEffect, useState } from "react";
import { userMessageOf } from "../client";
import { useRouter, useUi } from "../context";
import { Button, Card, Empty, ErrorNote, Field, Qr, Screen, Spinner, Toggle } from "../components";
import { relativeTime } from "../lib/format";
import { useUiT } from "../i18n";
import type { BrowserConnectorView, LinkStatusView, PairingView } from "./client";
import { useLink } from "./context";

/** Status, refreshed when the background says so and every 1.5 s while a screen is open (pairing is live). */
export function useLinkStatus(): { status: LinkStatusView | undefined; error: unknown; reload: () => void } {
  const link = useLink();
  const [status, setStatus] = useState<LinkStatusView>();
  const [error, setError] = useState<unknown>();
  const reload = useCallback(() => {
    link.status().then(
      (s) => {
        setStatus(s);
        setError(undefined);
      },
      (e) => setError(e),
    );
  }, [link]);
  useEffect(() => {
    reload();
    const off = link.onChange?.(reload);
    const t = setInterval(reload, 1500);
    return () => {
      off?.();
      clearInterval(t);
    };
  }, [link, reload]);
  return { status, error, reload };
}

const formatSas = (s: string) => `${s.slice(0, 3)} ${s.slice(3)}`;

/* ------------------------------------------------------------------ home */

export function LinkedDevices() {
  const t = useUiT();
  const link = useLink();
  const { config } = useUi();
  const { navigate } = useRouter();
  const { status, error, reload } = useLinkStatus();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<{ url: string; families: string[] } | null>(null);
  const [handoff, setHandoff] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void link.currentPage?.().then(setPage, () => setPage(null));
  }, [link]);

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function startPair(fn: () => Promise<PairingView>) {
    setErr(null);
    try {
      const v = await fn();
      navigate(`/settings/devices/pair/${encodeURIComponent(v.id)}`);
    } catch (e) {
      setErr(userMessageOf(e));
    }
  }

  if (!status) {
    return (
      <Screen back title={t("link.title")}>
        <ErrorNote message={error ? userMessageOf(error) : null} />
        {!error && <Spinner />}
      </Screen>
    );
  }
  const signerDevice = status.devices.find((d) => d.id === status.signer.deviceId);
  const signers = status.devices.filter((d) => !d.servesRequests);
  return (
    <Screen back title={t("link.title")}>
      <p className="clip-lede">{t("link.lede")}</p>
      <ErrorNote message={err} />

      {status.handoffs.length > 0 && (
        <section className="clip-section" aria-label={t("link.handoff.title")}>
          <h2 className="clip-section__title">{t("link.handoff.title")}</h2>
          {status.handoffs.map((h) => (
            <Card key={h.id}>
              <div data-testid="handoff">
                <strong>{t("link.handoff.from", { site: new URL(h.origin).hostname, device: h.from ?? "" })}</strong>
                <p className="clip-hint">{h.verified ? t("link.handoff.verified") : t("link.handoff.unverified")}</p>
                <div className="clip-row-buttons">
                  <Button
                    onClick={() =>
                      run(async () => {
                        const r = await link.handoffAccept({ id: h.id });
                        link.openUrl?.(r.url);
                      })
                    }
                  >
                    {t("link.handoff.open")}
                  </Button>
                  <Button variant="ghost" onClick={() => run(() => link.handoffDismiss({ id: h.id }))}>
                    {t("link.handoff.dismiss")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </section>
      )}

      {status.platform !== "mobile" && (
        <section className="clip-section" aria-label={t("link.signer.title")}>
          <h2 className="clip-section__title">{t("link.signer.title")}</h2>
          <p className="clip-hint" data-testid="signer-mode">
            {signerDevice ? t("link.signer.remote", { device: signerDevice.name }) : t("link.signer.local")}
          </p>
          {signerDevice && status.signer.waiting.length > 0 && (
            <Card>
              {status.signer.waiting.map((w) => (
                <div key={w.id} role="status">
                  <strong>{t("link.signer.waiting", { device: signerDevice.name })}</strong>
                  {w.title && <p>{w.title}</p>}
                  <p className="clip-hint">{t("link.signer.waitingHint", { name: config.name, device: signerDevice.name })}</p>
                </div>
              ))}
            </Card>
          )}
          {signerDevice && (
            <Button variant="secondary" block disabled={busy} onClick={() => run(() => link.useSigner({ deviceId: null }))}>
              {t("link.signer.stop")}
            </Button>
          )}
        </section>
      )}

      <section className="clip-section" aria-label={t("link.devices.title")}>
        <h2 className="clip-section__title">{t("link.devices.title")}</h2>
        {status.devices.length === 0 && <Empty title={t("link.devices.none")}>{t("link.devices.noneHint")}</Empty>}
        <ul className="clip-list" aria-label={t("link.devices.title")}>
          {status.devices.map((d) => (
            <li key={d.id} data-testid="linked-device">
              <Card>
                <div className="clip-select-row">
                  <span>
                    <strong>{d.name}</strong>
                    <span className="clip-hint" style={{ display: "block" }}>
                      {d.online ? t("link.signer.online") : d.lastSeenAt ? t("link.devices.lastSeen", { time: relativeTime(d.lastSeenAt) }) : t("link.signer.offline")}
                    </span>
                  </span>
                  <span className="clip-row-buttons">
                    {status.platform !== "mobile" && signers.includes(d) && status.signer.deviceId !== d.id && (
                      <Button variant="secondary" disabled={busy} onClick={() => run(() => link.useSigner({ deviceId: d.id }))}>
                        {t("link.signer.use")}
                      </Button>
                    )}
                    <Button variant="ghost" disabled={busy} onClick={() => run(() => link.deviceRemove({ id: d.id }))}>
                      {t("link.devices.remove")}
                    </Button>
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <nav className="clip-menu" aria-label={t("link.title")}>
        {status.capabilities.relay && status.platform !== "mobile" && (
          <div>
            <button type="button" className="clip-menu__item" onClick={() => void startPair(() => link.pairStart({ purpose: "signer" }))}>
              {t("link.action.phone")}
            </button>
            <p className="clip-hint">{t("link.action.phoneHint")}</p>
          </div>
        )}
        {status.capabilities.desktop && status.platform === "extension" && (
          <div>
            <button type="button" className="clip-menu__item" onClick={() => void startPair(() => link.desktopPair())}>
              {t("link.action.desktop")}
            </button>
            <p className="clip-hint">{t("link.action.desktopHint")}</p>
          </div>
        )}
        {status.capabilities.relay && (
          <div>
            <button type="button" className="clip-menu__item" onClick={() => void startPair(() => link.pairStart({ purpose: "device-add", direction: "send" }))}>
              {t("link.action.add")}
            </button>
            <p className="clip-hint">{t("link.action.addHint")}</p>
          </div>
        )}
      </nav>

      {link.browserConnector && <BrowserConnector />}

      {page && (
        <section className="clip-section" aria-label={t("link.handoff.title")}>
          <h2 className="clip-section__title">{t("link.handoff.title")}</h2>
          {handoff ? (
            <Qr value={handoff} label={t("link.handoff.qr", { name: config.name })} />
          ) : (
            <Button variant="secondary" block onClick={() => run(async () => setHandoff((await link.handoffCreate(page)).link))}>
              {t("link.handoff.current")}
            </Button>
          )}
          {handoff && <p className="clip-hint">{t("link.handoff.qr", { name: config.name })}</p>}
        </section>
      )}

      {status.capabilities.sync && (
        <section className="clip-section" aria-label={t("link.sync.title")}>
          <h2 className="clip-section__title">{t("link.sync.title")}</h2>
          <Toggle
            label={t("link.sync.toggle")}
            description={t("link.sync.hint")}
            checked={status.sync.enabled}
            disabled={busy}
            onChange={(v) => run(() => link.syncSet({ enabled: v }))}
          />
          {status.sync.enabled && (
            <>
              <p className="clip-hint" role="status">
                {status.sync.error ?? (status.sync.lastSyncAt ? t("link.sync.last", { time: relativeTime(status.sync.lastSyncAt) }) : t("link.sync.never"))}
              </p>
              <div className="clip-row-buttons">
                <Button variant="secondary" disabled={busy} onClick={() => run(() => link.syncNow())}>
                  {t("link.sync.now")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await link.syncDelete();
                      setNote(t("link.sync.deleted"));
                    })
                  }
                >
                  {t("link.sync.delete")}
                </Button>
              </div>
            </>
          )}
          {note && <p className="clip-hint" role="status">{note}</p>}
        </section>
      )}
    </Screen>
  );
}

/** Clip Desktop: the extension connector (native-messaging host) per browser, with repair and remove. */
function BrowserConnector() {
  const t = useUiT();
  const link = useLink();
  const { config } = useUi();
  const [view, setView] = useState<BrowserConnectorView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void link.browserConnector?.status().then(setView, (e) => setErr(userMessageOf(e)));
  }, [link]);
  const act = async (fn: () => Promise<BrowserConnectorView>) => {
    setErr(null);
    setBusy(true);
    try {
      setView(await fn());
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  if (!view?.available) return null;
  const names: Record<string, string> = { chrome: "Chrome", chromium: "Chromium", edge: "Edge", brave: "Brave", firefox: "Firefox" };
  const ready = view.browsers.filter((b) => b.installed).map((b) => names[b.browser]);
  return (
    <section className="clip-section" aria-label={t("link.connector.title")} data-testid="browser-connector">
      <h2 className="clip-section__title">{t("link.connector.title")}</h2>
      <p className="clip-hint">{t("link.connector.hint", { name: config.name })}</p>
      <p role="status">{ready.length ? t("link.connector.ready", { browsers: ready.join(", ") }) : t("link.connector.none")}</p>
      <ErrorNote message={err} />
      <div className="clip-row-buttons">
        <Button variant="secondary" disabled={busy} onClick={() => void act(() => link.browserConnector!.repair())}>
          {t("link.connector.repair")}
        </Button>
        {ready.length > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => void act(() => link.browserConnector!.remove())}>
            {t("link.connector.remove")}
          </Button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ pairing */

function titleFor(p: PairingView, t: ReturnType<typeof useUiT>) {
  return p.purpose === "desktop" ? t("link.pair.title.desktop") : p.purpose === "device-add" ? t("link.pair.title.add") : t("link.pair.title.signer");
}

/** One pairing, from QR to "linked" (or to moving the wallet). */
export function Pairing(props: { id: string; onDone?: () => void }) {
  const t = useUiT();
  const link = useLink();
  const { config, refresh } = useUi();
  const { navigate } = useRouter();
  const { status } = useLinkStatus();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const p = status?.pairings.find((x) => x.id === props.id);
  const done = props.onDone ?? (() => navigate("/settings/devices", { replace: true }));

  useEffect(() => {
    if (p?.state === "done" && p.purpose === "device-add" && p.direction === "receive") void refresh();
  }, [p?.state, p?.purpose, p?.direction, refresh]);

  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <Screen back title={t("link.title")}><Spinner /></Screen>;
  if (!p) {
    return (
      <Screen back title={t("link.title")}>
        <Empty title={t("link.pair.failed")} />
        <Button block onClick={done}>{t("link.pair.close")}</Button>
      </Screen>
    );
  }
  const cancel = () => void link.pairCancel({ id: p.id }).finally(done);
  const peer = p.peerName ?? "";

  return (
    <Screen back={cancel} title={titleFor(p, t)}>
      <ErrorNote message={err} />
      {p.state === "waiting" && p.uri && (
        <div className="clip-center" data-testid="pair-qr">
          <Qr value={p.uri} label={t("link.pair.qr")} />
          <p className="clip-hint">{p.purpose === "device-add" ? t("link.pair.scanAdd", { name: config.name }) : t("link.pair.scan", { name: config.name })}</p>
          <Button variant="ghost" onClick={cancel}>{t("link.pair.cancel")}</Button>
        </div>
      )}
      {(p.state === "connecting" || (p.state === "waiting" && !p.uri)) && (
        <div className="clip-center">
          <Spinner label={p.purpose === "desktop" ? t("link.pair.desktopWaiting") : t("link.pair.connecting")} />
          <p className="clip-hint">{p.purpose === "desktop" ? t("link.pair.desktopWaiting") : t("link.pair.connecting")}</p>
          <Button variant="ghost" onClick={cancel}>{t("link.pair.cancel")}</Button>
        </div>
      )}
      {p.state === "compare" && p.sas && (
        <div className="clip-center">
          <h2>{t("link.pair.compare")}</h2>
          <p className="clip-sas" data-testid="sas" aria-label={p.sas.split("").join(" ")} style={{ fontSize: "2.25rem", fontVariantNumeric: "tabular-nums", letterSpacing: "0.08em", direction: "ltr" }}>
            {formatSas(p.sas)}
          </p>
          <p className="clip-hint">{t("link.pair.compareHint", { device: peer })}</p>
          <Button block disabled={busy} onClick={() => act(() => link.pairConfirm({ id: p.id, match: true }))}>
            {t("link.pair.match")}
          </Button>
          <Button block variant="secondary" disabled={busy} onClick={() => act(() => link.pairConfirm({ id: p.id, match: false }))}>
            {t("link.pair.noMatch")}
          </Button>
        </div>
      )}
      {p.state === "confirming" && <Spinner label={t("link.pair.confirming")} />}
      {p.state === "password" && p.direction !== "receive" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await link.transferSend({ id: p.id, password: pw });
              setPw("");
            });
          }}
        >
          <h2>{t("link.transfer.sendTitle", { device: peer })}</h2>
          <p className="clip-hint">{t("link.transfer.sendHint")}</p>
          <Field label={t("link.transfer.password")} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Button block type="submit" disabled={busy || !pw}>{t("link.transfer.send")}</Button>
        </form>
      )}
      {p.state === "password" && p.direction === "receive" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pw !== pw2) return setErr(t("link.transfer.mismatch"));
            void act(async () => {
              await link.transferReceive({ id: p.id, password: pw });
              setPw("");
              setPw2("");
            });
          }}
        >
          <h2>{t("link.transfer.receiveTitle")}</h2>
          <p className="clip-hint">{t("link.transfer.receiveHint")}</p>
          <Field label={t("link.transfer.newPassword")} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Field label={t("link.transfer.repeat")} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <Button block type="submit" disabled={busy || pw.length < 8}>{t("link.transfer.receive")}</Button>
        </form>
      )}
      {p.state === "transferring" && <Spinner label={t("link.transfer.moving")} />}
      {p.state === "done" && (
        <div className="clip-center" role="status">
          <h2>
            {p.purpose === "device-add"
              ? p.direction === "receive"
                ? t("link.transfer.received")
                : t("link.transfer.sent", { device: peer })
              : t("link.pair.done", { device: peer })}
          </h2>
          {p.purpose !== "device-add" && <p className="clip-hint">{t("link.pair.doneHint")}</p>}
          <Button block onClick={done}>{t("link.pair.close")}</Button>
        </div>
      )}
      {p.state === "failed" && (
        <div className="clip-center" role="alert">
          <h2>{t("link.pair.failed")}</h2>
          <p>{p.error?.userMessage}</p>
          <Button block onClick={done}>{t("link.pair.again")}</Button>
        </div>
      )}
    </Screen>
  );
}

/** A new, empty device: show a QR the old device scans, then set a password here. */
export function ReceiveWallet(props: { onDone: () => void }) {
  const link = useLink();
  const t = useUiT();
  const [id, setId] = useState<string>();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    link.pairStart({ purpose: "device-add", direction: "receive" }).then(
      (v) => setId(v.id),
      (e) => setErr(userMessageOf(e)),
    );
  }, [link]);
  if (err) {
    return (
      <Screen back={props.onDone} title={t("link.action.receive")}>
        <ErrorNote message={err} />
      </Screen>
    );
  }
  if (!id) return <Screen back={props.onDone} title={t("link.action.receive")}><Spinner /></Screen>;
  return <Pairing id={id} onDone={props.onDone} />;
}
