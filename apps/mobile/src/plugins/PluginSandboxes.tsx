/**
 * The hidden WebViews plugins run in: one per running plugin, mounted at the app root (outside every screen) so a
 * plugin keeps running while you move around and an approval can ask it. Each WebView:
 *  - loads only the inline sandbox page (SES + runtime, CSP with no network) at about:blank (opaque origin);
 *    every other load is refused (`onShouldStartLoadWithRequest`, `originWhitelist`), so JavaScript only ever runs
 *    in the sandbox HTML;
 *  - has no injected script of ours: react-native-webview's postMessage in both directions is the only bridge,
 *    and both sides check every message against the plugin schemas (protocol.ts);
 *  - keeps no storage, cache, cookies, file access, windows, media, location or debugging;
 *  - is non-persistent on iOS (`incognito` = a non-persistent WKWebsiteDataStore). Not on Android, where
 *    react-native-webview's `incognito` clears every cookie of the app (the in-app browser's sessions too); there
 *    the page's opaque origin has no cookie access and DOM storage is off.
 * WebKit / Android run web content in a separate process, so a plugin that loops forever freezes only its own
 * WebView; the host's timeouts then stop the plugin and the WebView unmounts.
 */
import { useEffect, useReducer, useRef } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import type { SandboxFrame, WebViewChannels } from "./channels";
import { SANDBOX_URL, allowSandboxLoad } from "./protocol";
import { PLUGIN_SANDBOX_HTML } from "./sandbox.generated";

function Sandbox(props: { frame: SandboxFrame; channels: WebViewChannels }) {
  const { frame, channels } = props;
  const ref = useRef<WebView>(null);
  useEffect(() => channels.attach(frame.key, (data) => ref.current?.postMessage(data)), [channels, frame.key]);
  const gone = () => channels.crashed(frame.key);
  return (
    <WebView
      ref={ref}
      testID={`plugin-sandbox-${frame.pluginId}`}
      source={{ html: PLUGIN_SANDBOX_HTML, baseUrl: SANDBOX_URL }}
      originWhitelist={[SANDBOX_URL]}
      onShouldStartLoadWithRequest={allowSandboxLoad}
      onMessage={(e) => channels.receive(frame.key, e.nativeEvent.data, e.nativeEvent.url)}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      domStorageEnabled={false}
      cacheEnabled={false}
      cacheMode="LOAD_NO_CACHE"
      incognito={Platform.OS === "ios"}
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      allowsAirPlayForMediaPlayback={false}
      allowsInlineMediaPlayback={false}
      mediaPlaybackRequiresUserAction
      mediaCapturePermissionGrantType="deny"
      geolocationEnabled={false}
      saveFormDataDisabled
      textInteractionEnabled={false}
      mixedContentMode="never"
      webviewDebuggingEnabled={false}
      onContentProcessDidTerminate={gone}
      onRenderProcessGone={gone}
      onError={gone}
      style={{ width: 1, height: 1, backgroundColor: "transparent" }}
    />
  );
}

export function PluginSandboxes(props: { channels: WebViewChannels }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => props.channels.subscribe(rerender), [props.channels]);
  const frames = props.channels.frames();
  if (!frames.length) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", left: -10, top: -10, width: 1, height: 1, opacity: 0, overflow: "hidden" }}
    >
      {frames.map((f) => (
        <Sandbox key={f.key} frame={f} channels={props.channels} />
      ))}
    </View>
  );
}
