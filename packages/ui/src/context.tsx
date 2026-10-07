import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { WalletClient, WalletState } from "./client";
import type { ClipConfig } from "./theme/config";
import { defaultClipConfig, defaultUiOptions, type UiOptions } from "./theme/config";
import { tokensFor, type ColorMode } from "./theme/tokens";
import type { PasskeyPrfFactory } from "./lib/passkey";
import { dirOf, resolveLocale, type LocaleCode } from "@clip-wallet/i18n";
import { LocaleProvider } from "@clip-wallet/i18n/react";
import { BgTextProvider } from "./i18n/bg";
import { setFormatLocale } from "./lib/format";

function deviceLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export type Variant = "popup" | "tab" | "window";

export interface PasskeyFactory extends PasskeyPrfFactory {
  /** False in the action popup: the OS passkey sheet would close it, so ceremonies move to a tab. */
  canRunHere: boolean;
}

interface UiContextValue {
  client: WalletClient;
  config: ClipConfig;
  options: UiOptions;
  variant: Variant;
  state: WalletState | null;
  refresh: () => Promise<WalletState>;
  passkeys?: PasskeyFactory;
}

const UiContext = createContext<UiContextValue | null>(null);

export function useUi(): UiContextValue {
  const v = useContext(UiContext);
  if (!v) throw new Error("useUi outside <ClipProvider>");
  return v;
}

function systemMode(): ColorMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ClipProvider(props: {
  client: WalletClient;
  config?: ClipConfig;
  options?: Partial<UiOptions>;
  variant?: Variant;
  passkeys?: PasskeyFactory;
  /** Seed state for tests and to avoid a flash on first paint. */
  initialState?: WalletState;
  children: ReactNode;
}) {
  const config = props.config ?? defaultClipConfig;
  const options = useMemo<UiOptions>(() => ({ ...defaultUiOptions, ...props.options }), [props.options]);
  const [state, setState] = useState<WalletState | null>(props.initialState ?? null);
  const [sysMode, setSysMode] = useState<ColorMode>(systemMode);

  const refresh = useCallback(async () => {
    const s = await props.client.getState();
    setState(s);
    return s;
  }, [props.client]);

  useEffect(() => {
    if (!props.initialState) void refresh();
  }, [refresh, props.initialState]);

  useEffect(() => props.client.onChange?.(() => void refresh()), [props.client, refresh]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSysMode(mq.matches ? "dark" : "light");
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const locale: LocaleCode = resolveLocale(state?.prefs.locale, deviceLanguages(), config.languages);
  setFormatLocale(locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dirOf(locale);
  }, [locale]);

  const pref = state?.prefs.theme ?? "system";
  const mode: ColorMode = pref === "system" ? sysMode : pref;

  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(tokensFor(config, mode))) root.style.setProperty(k, v);
    root.dataset.theme = mode;
    root.dataset.variant = props.variant ?? "popup";
    root.style.colorScheme = mode;
  }, [config, mode, props.variant]);

  const value = useMemo<UiContextValue>(
    () => ({ client: props.client, config, options, variant: props.variant ?? "popup", state, refresh, passkeys: props.config?.passkeys.enabled === false ? undefined : props.passkeys }),
    [props.client, config, options, props.variant, state, refresh, props.passkeys],
  );
  return (
    <UiContext.Provider value={value}>
      <LocaleProvider locale={locale}>
        <BgTextProvider>{props.children}</BgTextProvider>
      </LocaleProvider>
    </UiContext.Provider>
  );
}

/* ------------------------------------------------------------------ router */

interface RouterValue {
  path: string;
  navigate: (path: string, opts?: { replace?: boolean }) => void;
  back: () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function useRouter(): RouterValue {
  const v = useContext(RouterContext);
  if (!v) throw new Error("useRouter outside <Router>");
  return v;
}

/** Tiny hash router. `memory` keeps routes out of location (tests, approval window). */
export function Router(props: { initial?: string; memory?: boolean; children: ReactNode }) {
  const read = () => (props.memory ? props.initial ?? "/" : location.hash.replace(/^#/, "") || props.initial || "/");
  const [stack, setStack] = useState<string[]>(() => [read()]);

  useEffect(() => {
    if (props.memory) return;
    const on = () => {
      const p = location.hash.replace(/^#/, "") || "/";
      setStack((s) => (s[s.length - 1] === p ? s : [...s, p]));
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [props.memory]);

  const value = useMemo<RouterValue>(
    () => ({
      path: stack[stack.length - 1] ?? "/",
      navigate: (path, opts) => {
        setStack((s) => (opts?.replace ? [...s.slice(0, -1), path] : [...s, path]));
        if (!props.memory) history.replaceState(null, "", `#${path}`);
      },
      back: () => {
        setStack((s) => {
          const next = s.length > 1 ? s.slice(0, -1) : ["/"];
          if (!props.memory) history.replaceState(null, "", `#${next[next.length - 1]}`);
          return next;
        });
      },
    }),
    [stack, props.memory],
  );
  return <RouterContext.Provider value={value}>{props.children}</RouterContext.Provider>;
}

/** Small helper for async data in screens. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn().then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(undefined);
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
