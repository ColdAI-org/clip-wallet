/**
 * In-app browser: dapps get 1Mask (EIP-6963 + EIP-1193, Solana and Bitcoin Wallet Standard) exactly as on
 * desktop. bridge.ts replaces the content script: the origin always comes from the WebView's own URL.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, TextInput, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWallet } from "../ui/context";
import { IconButton, TabBar, T } from "../ui/kit";
import { IconBack, IconChevron, IconReload, IconShield } from "../ui/icons";
import { createWebViewBridge, webOrigin } from "../browser/bridge";
import { INPAGE_JS } from "../browser/inpage.generated";
import { APP } from "../env";
import { useMobileT } from "../i18n";

export const START_URL = "https://app.uniswap.org";

/** "uniswap.org" → https://uniswap.org; localhost:8787 → http://localhost:8787 (dev only). */
export function normaliseAddress(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : /^(localhost|127\.0\.0\.1|10\.|192\.168\.)/.test(t) ? `http://${t}` : `https://${t}`;
  return webOrigin(withScheme) ? withScheme : null;
}

export function Browser(props: { url?: string }) {
  const { wallet, theme } = useWallet();
  const t = useMobileT();
  const insets = useSafeAreaInsets();
  const web = useRef<WebView>(null);
  const [url, setUrl] = useState(props.url ?? START_URL);
  const [typed, setTyped] = useState(url);
  const [nav, setNav] = useState<{ canGoBack: boolean; canGoForward: boolean; title: string; loading: boolean }>({ canGoBack: false, canGoForward: false, title: "", loading: true });

  useEffect(() => {
    if (props.url) {
      setUrl(props.url);
      setTyped(props.url);
    }
  }, [props.url]);

  const bridge = useMemo(
    () =>
      createWebViewBridge({
        attach: (port, origin) => wallet.engine.attachDappPort(port, origin),
        inject: (js) => web.current?.injectJavaScript(js),
        inpageJs: INPAGE_JS,
        channel: wallet.channel,
        networks: wallet.browserNetworks,
        identity: APP.identity,
      }),
    [wallet],
  );
  useEffect(() => () => bridge.dispose(), [bridge]);

  const onNav = (s: WebViewNavigation) => {
    bridge.onNavigation(s.url);
    setTyped(s.url);
    setNav({ canGoBack: s.canGoBack, canGoForward: s.canGoForward, title: s.title, loading: s.loading });
  };
  const secure = typed.startsWith("https://");

  return (
    <View style={{ flex: 1, backgroundColor: theme.c.bg, paddingTop: insets.top }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6 }}>
        <IconButton label={t("m.common.back")} onPress={() => web.current?.goBack()}>
          <IconBack color={nav.canGoBack ? theme.c.text : theme.c.text3} />
        </IconButton>
        <IconButton label={t("m.browser.forward")} onPress={() => web.current?.goForward()}>
          <IconChevron color={nav.canGoForward ? theme.c.text : theme.c.text3} />
        </IconButton>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.c.surface2, borderRadius: theme.r.md, paddingHorizontal: 10 }}>
          {secure && <IconShield color={theme.c.positive} size={14} />}
          <TextInput
            testID="address-bar"
            accessibilityLabel={t("m.browser.address")}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectTextOnFocus
            onSubmitEditing={() => {
              const next = normaliseAddress(typed);
              if (next) setUrl(next);
              Keyboard.dismiss();
            }}
            style={{ flex: 1, color: theme.c.text, paddingVertical: 9, fontSize: 15 }}
          />
        </View>
        <IconButton label={t("m.browser.reload")} onPress={() => web.current?.reload()}>
          <IconReload color={theme.c.text} />
        </IconButton>
      </View>
      <WebView
        ref={web}
        testID="webview"
        source={{ uri: url }}
        originWhitelist={["https://*", "http://localhost*", "http://127.0.0.1*", "http://10.*", "http://192.168.*"]}
        injectedJavaScriptBeforeContentLoaded={bridge.injectedBeforeLoad}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        injectedJavaScriptForMainFrameOnly
        onMessage={(e) => bridge.onMessage(e.nativeEvent.data, e.nativeEvent.url)}
        onNavigationStateChange={onNav}
        onLoadStart={(e) => bridge.onNavigation(e.nativeEvent.url)}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        webviewDebuggingEnabled={__DEV__}
        style={{ flex: 1, backgroundColor: theme.c.bg }}
      />
      {nav.loading && <T v="hint" style={{ position: "absolute", top: insets.top + 52, alignSelf: "center" }}>{t("m.browser.loading")}</T>}
      <TabBar />
    </View>
  );
}
