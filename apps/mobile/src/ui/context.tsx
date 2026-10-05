import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { I18nManager, View, useColorScheme } from "react-native";
import { setFormatLocale, type WalletClient, type WalletState } from "@clip-wallet/ui";
import type { Family } from "@clip-wallet/core";
import { dirOf, resolveLocale, type LocaleCode } from "@clip-wallet/i18n";
import { LocaleProvider } from "@clip-wallet/i18n/react";
import { deviceLanguages } from "../i18n/device";
import type { MobileWallet } from "../background/host";
import { APP } from "../env";
import { themeFor, type Theme } from "./theme";

export type Route =
  | { name: "home" }
  | { name: "collectibles" }
  | { name: "activity" }
  | { name: "browser"; url?: string }
  | { name: "settings" }
  | { name: "asset"; id: string }
  | { name: "send"; assetKey?: string }
  | { name: "receive"; assetKey?: string }
  | { name: "scan" }
  | { name: "explore" }
  /* features (same screens as the extension's /stake, /swap, /buy, /trade) */
  | { name: "stake"; assetKey?: string }
  | { name: "swap"; sell?: string; buy?: string }
  | { name: "buy"; assetKey?: string }
  | { name: "trade" }
  | { name: "trade-new" }
  | { name: "trade-open"; link?: string }
  | { name: "trade-detail"; id: string }
  /* platform: backup, accounts */
  | { name: "backup" }
  | { name: "backup-phrase" }
  | { name: "backup-passkey" }
  | { name: "accounts"; origin?: string }
  /* hardware wallets */
  | { name: "hardware" }
  | { name: "hardware-connect" }
  /* social: contacts, notifications */
  | { name: "contacts" }
  /** Edit a contact (`id`) or add one, optionally prefilled with an address. */
  | { name: "contact"; id?: string; address?: string; family?: Family }
  | { name: "notifications" }
  /* Settings → Security (permissions, spam cleanup, scam protection) and Advanced → Plugins */
  | { name: "security" }
  | { name: "security-permissions" }
  | { name: "security-cleanup" }
  | { name: "security-protection" }
  | { name: "plugins" };

export const TABS = ["home", "collectibles", "explore", "activity", "browser", "settings"] as const;

interface Ctx {
  wallet: MobileWallet;
  client: WalletClient;
  state: WalletState | null;
  refresh: () => Promise<void>;
  theme: Theme;
  route: Route;
  navigate: (r: Route) => void;
  back: () => void;
  canGoBack: boolean;
  /** Pending approval shown as a sheet over everything. */
  approvalId: string | null;
  showApproval: (id: string | null) => void;
}

const WalletCtx = createContext<Ctx | null>(null);

export function useWallet(): Ctx {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}

export function WalletProvider(props: { wallet: MobileWallet; children: ReactNode; initialRoute?: Route }) {
  const { wallet } = props;
  const [state, setState] = useState<WalletState | null>(null);
  const [stack, setStack] = useState<Route[]>([props.initialRoute ?? { name: "home" }]);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const scheme = useColorScheme();
  const refresh = useCallback(async () => {
    setState(await wallet.client.getState());
  }, [wallet]);

  useEffect(() => {
    void refresh();
    return wallet.events.on((e) => {
      if (e.type === "approval") setApprovalId(e.id);
      else void refresh();
    });
  }, [wallet, refresh]);

  const mode = state?.prefs.theme && state.prefs.theme !== "system" ? state.prefs.theme : scheme === "dark" ? "dark" : "light";
  const theme = useMemo(() => themeFor(APP.config, mode), [mode]);
  const locale: LocaleCode = resolveLocale(state?.prefs.locale, deviceLanguages());
  const dir = dirOf(locale);
  setFormatLocale(locale);
  useEffect(() => {
    // Native RTL (I18nManager) applies from the next launch; the root `direction` style below flips the layout now.
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== (dir === "rtl")) I18nManager.forceRTL(dir === "rtl");
  }, [dir]);
  const route = stack[stack.length - 1]!;

  const value: Ctx = {
    wallet,
    client: wallet.client,
    state,
    refresh,
    theme,
    route,
    navigate: (r) => setStack((s) => ((TABS as readonly string[]).includes(r.name) ? [r] : [...s, r])),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    canGoBack: stack.length > 1,
    approvalId,
    showApproval: setApprovalId,
  };
  return (
    <WalletCtx.Provider value={value}>
      <LocaleProvider locale={locale}>
        <View style={{ flex: 1, direction: dir }}>{props.children}</View>
      </LocaleProvider>
    </WalletCtx.Provider>
  );
}

/** Same contract as @clip-wallet/ui's useAsync: reloads when deps change or the wallet broadcasts a change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const { wallet } = useWallet();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    setLoading(true);
    fn().then(
      (d) => alive.current && (setData(d), setError(null), setLoading(false)),
      (e) => alive.current && (setError(e), setLoading(false)),
    );
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  useEffect(() => wallet.events.on((e) => e.type === "change" && setN((x) => x + 1)), [wallet]);
  return { data, error, loading, reload: () => setN((x) => x + 1) };
}
