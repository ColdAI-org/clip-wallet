import { useEffect, useRef, useState } from "react";
import type { Prefs } from "../client";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, ErrorNote, Field, Row, Screen, Toggle } from "../components";
import { PasskeyEnroll } from "./Passkey";
import { relativeTime } from "../lib/format";
import { useFeaturesOptional } from "../features/context";
import { useHardwareOptional } from "../hardware/context";
import { useSocialOptional } from "../social/context";
import { useUiT } from "../i18n";
import { LOCALES, localeInfo, resolveLocale, type LocalePref } from "@clip-wallet/i18n";

const AUTO_LOCK = [1, 5, 15, 30, 60];

export function isWalletConnectUri(uri: string): boolean {
  return /^wc:[0-9a-f]{64}@2\?/i.test(uri.trim()) && /[?&]symKey=[0-9a-f]{64}/i.test(uri) && /[?&]relay-protocol=/i.test(uri);
}

function systemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

function Section(props: { title: string; children: React.ReactNode; id?: string }) {
  const id = props.id ?? props.title.toLowerCase().replace(/\W+/g, "-");
  return (
    <section aria-labelledby={id} className="clip-settings-section">
      <h2 id={id} className="clip-h2">
        {props.title}
      </h2>
      <Card>{props.children}</Card>
    </section>
  );
}

function Sessions() {
  const t = useUiT();
  const { client, state } = useUi();
  const { navigate } = useRouter();
  const { data, reload, error } = useAsync(() => client.listSessions(), [client]);
  return (
    <Section title={t("settings.sessions.title")} id="connected-apps">
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {data && data.length === 0 && <p className="clip-hint">{t("settings.sessions.none")}</p>}
      <ul className="clip-sessions">
        {data?.map((s) => (
          <li key={s.id} className="clip-session">
            <div>
              <div className="clip-session__name">{s.dapp.name}</div>
              <div className="clip-session__meta">
                {s.dapp.domain} · {s.via === "walletconnect" ? t("settings.sessions.walletConnect") : t("settings.sessions.inBrowser")} · {relativeTime(s.connectedAt)}
                {state?.prefs.advanced && s.networkIds.length > 0 && <> · {s.networkIds.join(", ")}</>}
              </div>
            </div>
            {s.via === "injected" && (
              <Button variant="ghost" aria-label={t("settings.sessions.accountsFor", { app: s.dapp.name })} onClick={() => navigate(`/accounts?origin=${encodeURIComponent(s.dapp.origin)}`)}>
                {t("settings.sessions.accounts")}
              </Button>
            )}
            <Button
              variant="secondary"
              aria-label={t("settings.sessions.disconnectApp", { app: s.dapp.name })}
              onClick={async () => {
                await client.disconnect(s.id);
                reload();
              }}
            >
              {t("settings.sessions.disconnect")}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function WalletConnectPair() {
  const t = useUiT();
  const { client } = useUi();
  const [uri, setUri] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = isWalletConnectUri(uri);
  return (
    <Section title={t("settings.wc.title")} id="walletconnect">
      <p className="clip-hint">{t("settings.wc.hint")}</p>
      <Field
        label={t("settings.wc.code")}
        placeholder="wc:…"
        autoComplete="off"
        spellCheck={false}
        value={uri}
        onChange={(e) => {
          setUri(e.target.value);
          setErr(null);
          setMsg(null);
        }}
        error={uri && !valid ? t("settings.wc.invalid") : null}
      />
      <ErrorNote message={err} />
      {msg && <p className="clip-notice clip-notice--info">{msg}</p>}
      <div className="clip-actions">
        <Button variant="secondary" onClick={() => client.openFullTab("/scan")}>
          {t("settings.wc.scan")}
        </Button>
        <Button
          disabled={!valid}
          onClick={async () => {
            try {
              await client.pairWalletConnect(uri.trim());
              setUri("");
              setMsg(t("settings.wc.started"));
            } catch (e) {
              setErr(userMessageOf(e));
            }
          }}
        >
          {t("settings.wc.connect")}
        </Button>
      </div>
    </Section>
  );
}

function AdvancedNetworks(props: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => Promise<void> }) {
  const t = useUiT();
  const { client } = useUi();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const [draft, setDraft] = useState<Record<string, string>>(props.prefs.rpcOverrides);
  return (
    <Section title={t("settings.networks")} id="networks">
      {data?.networks.map((n) => (
        <div key={n.id} className="clip-network-adv">
          <Row label={n.name} value={<code className="clip-mono">{n.id}</code>} hint={n.chainId !== undefined ? t("settings.networks.chainId", { id: n.chainId }) : undefined} />
          <Field
            label={t("settings.networks.rpcFor", { network: n.name })}
            placeholder={n.rpcUrl ?? "https://"}
            value={draft[n.id] ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, [n.id]: e.target.value }))}
            onBlur={() => {
              const v = (draft[n.id] ?? "").trim();
              const next = { ...props.prefs.rpcOverrides };
              if (v && /^https:\/\//.test(v)) next[n.id] = v;
              else delete next[n.id];
              void props.setPrefs({ rpcOverrides: next });
            }}
            error={draft[n.id] && !/^https:\/\//.test(draft[n.id]!) ? t("settings.networks.httpsOnly") : null}
          />
        </div>
      ))}
    </Section>
  );
}

export function Settings() {
  const t = useUiT();
  const { client, state, refresh, config, options } = useUi();
  const [enrolling, setEnrolling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  const { navigate } = useRouter();
  const features = useFeaturesOptional();
  const hardware = useHardwareOptional();
  const social = useSocialOptional();
  if (!state) return null;
  const prefs = state.prefs;
  const setPrefs = async (p: Partial<Prefs>) => {
    try {
      await client.setPrefs(p);
      await refresh();
    } catch (e) {
      setErr(userMessageOf(e));
    }
  };

  return (
    <Screen nav title={t("settings.title")}>
      <ErrorNote message={err} />
      {features && (
        <Section title={t("settings.more")} id="more">
          <nav className="clip-menu" aria-label={t("settings.more")}>
            <button type="button" className="clip-menu__item" onClick={() => navigate("/stake")}>{t("settings.more.stake")}</button>
            <button type="button" className="clip-menu__item" onClick={() => navigate("/swap")}>{t("settings.more.swap")}</button>
            <button type="button" className="clip-menu__item" onClick={() => navigate("/buy")}>{t("settings.more.buy")}</button>
            <button type="button" className="clip-menu__item" onClick={() => navigate("/trade")}>{t("settings.more.trade")}</button>
            <button type="button" className="clip-menu__item" onClick={() => navigate("/explore")}>{t("settings.more.explore")}</button>
          </nav>
        </Section>
      )}
      {social && (
        <Section title={t("settings.people")} id="people">
          <nav className="clip-menu" aria-label={t("settings.people")}>
            <button type="button" className="clip-menu__item" onClick={() => navigate("/contacts")}>{t("social.contacts.title")}</button>
            <button type="button" className="clip-menu__item" onClick={() => navigate("/handle")}>{t("social.handle.menu")}</button>
            <button type="button" className="clip-menu__item" onClick={() => navigate("/settings/notifications")}>{t("social.notify.menu")}</button>
          </nav>
        </Section>
      )}
      <Section title={t("settings.display")} id="display">
        <label className="clip-select-row">
          <span>{t("settings.language")}</span>
          <select
            className="clip-select"
            value={prefs.locale ?? "system"}
            onChange={(e) => setPrefs({ locale: e.target.value as LocalePref })}
          >
            <option value="system">{t("settings.language.system", { language: localeInfo(resolveLocale("system", systemLanguages())).nativeName })}</option>
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>
                {l.nativeName}
              </option>
            ))}
          </select>
        </label>
        <label className="clip-select-row">
          <span>{t("settings.currency")}</span>
          <select className="clip-select" value={prefs.displayCurrency} onChange={(e) => setPrefs({ displayCurrency: e.target.value })}>
            {options.currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="clip-select-row">
          <span>{t("settings.appearance")}</span>
          <select className="clip-select" value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as Prefs["theme"] })}>
            <option value="system">{t("settings.appearance.system")}</option>
            <option value="light">{t("settings.appearance.light")}</option>
            <option value="dark">{t("settings.appearance.dark")}</option>
          </select>
        </label>
      </Section>

      <Section title={t("settings.security")} id="security">
        <label className="clip-select-row">
          <span>{t("settings.autoLock")}</span>
          <select className="clip-select" value={prefs.autoLockMinutes} onChange={(e) => setPrefs({ autoLockMinutes: Number(e.target.value) })}>
            {AUTO_LOCK.map((m) => (
              <option key={m} value={m}>
                {m === 60 ? t("settings.autoLock.hour") : t("settings.autoLock.minutes", { n: m })}
              </option>
            ))}
          </select>
        </label>
        <div className="clip-passkey-row">
          <div>
            <div className="clip-toggle__label">{t("settings.passkey.title")}</div>
            <div className="clip-toggle__desc">{state.passkey.enrolled ? t("settings.passkey.on") : t("settings.passkey.off")}</div>
          </div>
          {state.passkey.enrolled ? (
            <Button
              variant="secondary"
              onClick={async () => {
                await client.passkeyRemove();
                await refresh();
              }}
            >
              {t("settings.passkey.remove")}
            </Button>
          ) : (
            !enrolling && (
              <Button variant="secondary" onClick={() => setEnrolling(true)}>
                {t("settings.passkey.setUp")}
              </Button>
            )
          )}
        </div>
        {enrolling && <PasskeyEnroll onDone={() => setEnrolling(false)} />}
        <nav className="clip-menu" aria-label={t("settings.backupAndAccounts")}>
          <button type="button" className="clip-menu__item" onClick={() => navigate("/backup")}>{t("settings.backup")}</button>
          <button type="button" className="clip-menu__item" onClick={() => navigate("/accounts")}>{t("settings.accounts")}</button>
          {hardware && (
            <button type="button" className="clip-menu__item" onClick={() => navigate("/settings/hardware")} title={t("settings.hardware.hint")}>
              {t("settings.hardware")}
            </button>
          )}
        </nav>
        <Button
          variant="secondary"
          block
          onClick={async () => {
            await client.lock();
            await refresh();
          }}
        >
          {t("settings.lockNow")}
        </Button>
      </Section>

      <Sessions />
      <WalletConnectPair />

      <Section title={t("settings.advanced")} id="advanced">
        <Toggle
          label={t("settings.advanced.mode")}
          description={t("settings.advanced.modeHint")}
          checked={prefs.advanced}
          onChange={(v) => setPrefs({ advanced: v })}
        />
      </Section>
      {prefs.advanced && <AdvancedNetworks prefs={prefs} setPrefs={setPrefs} />}

      {state.mocks && client.devSimulateRequest && (
        <Section title={t("settings.dev.title")} id="developer-mock-data">
          <p className="clip-hint">{t("settings.dev.hint")}</p>
          <div className="clip-dev-buttons">
            {(["pay", "connect", "blind", "approval-for-all"] as const).map((k) => (
              <Button
                key={k}
                variant="secondary"
                onClick={async () => {
                  const id = await client.devSimulateRequest!(k);
                  setDevMsg(t("settings.dev.queued", { kind: k }));
                  await refresh();
                  navigate(`/approval/${encodeURIComponent(id)}`);
                }}
              >
                {k}
              </Button>
            ))}
          </div>
          {devMsg && <p className="clip-hint">{devMsg}</p>}
        </Section>
      )}

      <p className="clip-about">
        {t("settings.about", { name: config.name })}
      </p>
    </Screen>
  );
}

/* ------------------------------------------------------------------ camera QR scan (full tab) */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

export function ScanWalletConnect() {
  const t = useUiT();
  const { client } = useUi();
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>(t("settings.scan.point"));
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stop = false;
    const Detector = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    if (!Detector) {
      setErr(t("settings.scan.noDetector"));
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          const hit = codes.find((c) => isWalletConnectUri(c.rawValue));
          if (hit) {
            setStatus(t("settings.scan.found"));
            await client.pairWalletConnect(hit.rawValue);
            setDone(true);
            setStatus(t("settings.scan.started"));
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (e) {
        setErr(e && typeof e === "object" && "name" in e && (e as { name: string }).name === "NotAllowedError" ? t("settings.scan.blocked") : userMessageOf(e));
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen title={t("settings.scan.title")}>
      {!done && !err && <video ref={video} className="clip-scan-video" muted playsInline aria-label={t("settings.scan.preview")} />}
      <ErrorNote message={err} />
      <p className="clip-lede">{status}</p>
    </Screen>
  );
}
