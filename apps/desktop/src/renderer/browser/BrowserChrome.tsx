/**
 * The browser's toolbar (tab strip, address bar, start page, site prompts). Our own page on the clip-app: origin,
 * default session, no wallet secrets: it sees tab titles and URLs and sends navigation commands to the main
 * process, which re-checks every one (url-policy.ts) before a tab loads anything.
 *
 * The address bar always shows the site's origin as the browser process committed it: host in full weight,
 * "Not secure" for plain http (local development only), a red flag for listed scam sites.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { dirOf, isLocaleCode, type LocaleCode } from "@clip-wallet/i18n";
import { LocaleProvider, useT } from "@clip-wallet/i18n/react";
import { tokensFor } from "@clip-wallet/ui";
import { DESKTOP } from "../../shared/app-config";
import { DESKTOP_CATALOGS, type DesktopMessageId } from "../../shared/i18n";
import type { ChromeCall, ChromeState, PromptView, TabView } from "../../shared/ipc";
import { desktop, unwrap } from "../shared/bridge";

const send = async (c: ChromeCall) => unwrap(await desktop().chrome(c));

function hostOf(origin: string): string {
  try {
    return new URL(origin).host.replace(/^www\./, "");
  } catch {
    return origin;
  }
}

function Icon(props: { d: string; label: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={props.d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  back: "M15 18l-6-6 6-6",
  forward: "M9 18l6-6-6-6",
  reload: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  stop: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  close: "M7 7l10 10M17 7L7 17",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z",
  warn: "M12 3l10 18H2zM12 10v4M12 17v.5",
  star: "M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.5 6.5 20.4l1-6.3L3 9.7l6.2-.9z",
  wallet: "M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM3 7l12-3v3M16 13.5h.01",
};

function Chrome(props: { state: ChromeState }) {
  const t = useT(DESKTOP_CATALOGS);
  const { state } = props;
  const tab = state.tabs.find((x) => x.id === state.activeId) ?? null;
  const prompt = state.prompts.find((p) => p.tabId === tab?.id) ?? null;
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setInput(tab?.url ?? "");
  }, [tab?.url, tab?.id, editing]);
  useEffect(() => {
    // A fresh tab starts with the cursor in the address bar.
    if (tab && !tab.origin) inputRef.current?.focus();
  }, [tab?.id, tab?.origin]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tab) return;
    setError(null);
    try {
      await send({ op: "navigate", tabId: tab.id, input });
      setEditing(false);
      inputRef.current?.blur();
    } catch (err) {
      setError((err as { userMessage?: string }).userMessage ?? t("d.browser.badUrl"));
    }
  };

  const covered = !!tab && !tab.origin;
  return (
    <div className={`chrome ${covered ? "chrome--covered" : ""}`}>
      <div className="tabs" role="tablist">
        {state.tabs.map((x) => (
          <div key={x.id} className={`tab ${x.id === state.activeId ? "tab--active" : ""}`} role="tab" aria-selected={x.id === state.activeId}>
            <button type="button" className="tab__title" onClick={() => void send({ op: "selectTab", tabId: x.id })} title={x.url || t("d.browser.untitled")}>
              {x.risk === "danger" && <span className="tab__danger" aria-hidden="true">!</span>}
              <span>{x.title || t("d.browser.untitled")}</span>
            </button>
            <button type="button" className="icon-btn icon-btn--small" aria-label={t("d.browser.closeTab")} onClick={() => void send({ op: "closeTab", tabId: x.id })}>
              <Icon d={ICONS.close} label="" />
            </button>
          </div>
        ))}
        <button type="button" className="icon-btn" aria-label={t("d.browser.newTab")} onClick={() => void send({ op: "newTab" })}>
          <Icon d={ICONS.plus} label="" />
        </button>
      </div>
      {tab && (
        <div className="toolbar">
          <button type="button" className="icon-btn flip" aria-label={t("d.browser.back")} disabled={!tab.canGoBack} onClick={() => void send({ op: "back", tabId: tab.id })}>
            <Icon d={ICONS.back} label="" />
          </button>
          <button type="button" className="icon-btn flip" aria-label={t("d.browser.forward")} disabled={!tab.canGoForward} onClick={() => void send({ op: "forward", tabId: tab.id })}>
            <Icon d={ICONS.forward} label="" />
          </button>
          {tab.loading ? (
            <button type="button" className="icon-btn" aria-label={t("d.browser.stop")} onClick={() => void send({ op: "stop", tabId: tab.id })}>
              <Icon d={ICONS.stop} label="" />
            </button>
          ) : (
            <button type="button" className="icon-btn" aria-label={t("d.browser.reload")} disabled={!tab.origin} onClick={() => void send({ op: "reload", tabId: tab.id })}>
              <Icon d={ICONS.reload} label="" />
            </button>
          )}
          <form className={`address ${tab.risk === "danger" ? "address--danger" : ""}`} onSubmit={submit} dir="ltr">
            {!editing && tab.origin ? (
              <button type="button" className="address__view" onClick={() => (setEditing(true), setTimeout(() => inputRef.current?.select(), 0))} aria-label={t("d.browser.address")} data-testid="address-origin">
                {tab.risk === "danger" ? (
                  <span className="badge badge--danger"><Icon d={ICONS.warn} label="" /> {t("d.phish.title")}</span>
                ) : tab.secure ? (
                  <span className="badge badge--secure" title={t("d.browser.secure")}><Icon d={ICONS.lock} label="" /></span>
                ) : (
                  <span className="badge badge--insecure">{t("d.browser.notSecure")}</span>
                )}
                <span className="address__host">{hostOf(tab.origin)}</span>
                <span className="address__rest">{tab.url.slice(tab.origin.length)}</span>
              </button>
            ) : (
              <input
                ref={inputRef}
                aria-label={t("d.browser.address")}
                placeholder={t("d.browser.placeholder")}
                value={input}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onFocus={() => setEditing(true)}
                onBlur={() => setEditing(false)}
                onKeyDown={(e) => e.key === "Escape" && (setEditing(false), inputRef.current?.blur())}
                onChange={(e) => setInput(e.target.value)}
              />
            )}
            {tab.connected && <span className="connected" title={t("d.browser.connected")} aria-label={t("d.browser.connected")} role="img" />}
          </form>
          <button
            type="button"
            className={`icon-btn ${tab.bookmarked ? "icon-btn--on" : ""}`}
            aria-label={tab.bookmarked ? t("d.browser.unbookmark") : t("d.browser.bookmark")}
            aria-pressed={tab.bookmarked}
            disabled={!tab.origin}
            onClick={() => void send({ op: "toggleBookmark", tabId: tab.id })}
          >
            <Icon d={ICONS.star} label="" />
          </button>
          <button type="button" className="wallet-btn" onClick={() => void send({ op: "openWallet" })}>
            <Icon d={ICONS.wallet} label="" /> {t("d.browser.openWallet")}
          </button>
        </div>
      )}
      {error && editing && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab && !tab.origin && !prompt && <StartPage state={state} />}
      {prompt && <Prompt prompt={prompt} />}
    </div>
  );
}

function StartPage(props: { state: ChromeState }) {
  const t = useT(DESKTOP_CATALOGS);
  const tab = props.state.tabs.find((x) => x.id === props.state.activeId)!;
  const open = (url: string) => void send({ op: "navigate", tabId: tab.id, input: url });
  return (
    <main className="start">
      <h1>{t("d.start.title")}</h1>
      <section>
        <h2>{t("d.start.bookmarks")}</h2>
        {props.state.bookmarks.length === 0 ? (
          <p className="muted">{t("d.start.noBookmarks")}</p>
        ) : (
          <ul className="tiles">
            {props.state.bookmarks.map((b) => (
              <li key={b.url} className="tile">
                <button type="button" className="tile__open" onClick={() => open(b.url)}>
                  <span className="tile__name">{b.title}</span>
                  <span className="tile__host" dir="ltr">{hostOf(b.url)}</span>
                </button>
                <button type="button" className="icon-btn icon-btn--small" aria-label={t("d.start.remove", { site: hostOf(b.url) })} onClick={() => void send({ op: "removeBookmark", url: b.url })}>
                  <Icon d={ICONS.close} label="" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {props.state.featured.length > 0 && (
        <section>
          <h2>{t("d.start.featured")}</h2>
          <ul className="tiles">
            {props.state.featured.map((d) => (
              <li key={d.url} className="tile">
                <button type="button" className="tile__open" onClick={() => open(d.url)}>
                  <span className="tile__name">{d.name}</span>
                  {d.description && <span className="tile__desc">{d.description}</span>}
                  <span className="tile__host" dir="ltr">{hostOf(d.url)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

const PERMISSION_TEXT: Record<string, DesktopMessageId> = {
  camera: "d.perm.camera",
  microphone: "d.perm.microphone",
  notifications: "d.perm.notifications",
  clipboard: "d.perm.clipboard",
  location: "d.perm.location",
};

function Prompt(props: { prompt: PromptView }) {
  const t = useT(DESKTOP_CATALOGS);
  const p = props.prompt;
  const answer = (choice: "allow" | "deny" | "leave" | "proceed") => void send({ op: "answer", promptId: p.id, choice });
  const site = hostOf(p.origin);
  if (p.kind === "phishing") {
    return (
      <div className="backdrop">
        <div className="dialog dialog--danger" role="alertdialog" aria-labelledby="pt" aria-describedby="pb">
          <h2 id="pt">{t("d.phish.title")}</h2>
          <p id="pb">{t("d.phish.body", { site })}</p>
          {p.reasons.length > 0 && (
            <ul className="reasons">
              {p.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button type="button" className="btn btn--primary" autoFocus onClick={() => answer("leave")}>
              {t("d.phish.leave")}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => answer("proceed")}>
              {t("d.phish.proceed")}
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="backdrop">
      <div className="dialog" role="alertdialog" aria-labelledby="pt" aria-describedby="pb">
        <h2 id="pt">{t("d.perm.title", { site, permission: t(PERMISSION_TEXT[p.permission] ?? "d.perm.other") })}</h2>
        <p id="pb">{t("d.perm.body")}</p>
        <div className="actions">
          <button type="button" className="btn btn--primary" autoFocus onClick={() => answer("deny")}>
            {t("d.perm.deny")}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => answer("allow")}>
            {t("d.perm.allow")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function BrowserChrome() {
  const [state, setState] = useState<ChromeState | null>(null);
  useEffect(() => {
    const off = desktop().onChromeState(setState);
    void send({ op: "state" }).then((s) => setState(s as ChromeState));
    return off;
  }, []);
  const locale: LocaleCode = state && isLocaleCode(state.locale) ? state.locale : "en";
  const mode = state?.theme ?? "light";
  const tokens = useMemo(() => tokensFor(DESKTOP.config, mode), [mode]);
  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    root.lang = locale;
    root.dir = dirOf(locale);
  }, [tokens, mode, locale]);
  if (!state) return null;
  return (
    <LocaleProvider locale={locale}>
      <Chrome state={state} />
    </LocaleProvider>
  );
}
