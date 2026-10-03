/**
 * React Native versions of @clip-wallet/ui's components (Button, Screen, Card, Row, Chip, Field, Toggle,
 * Warnings, ErrorNote, Spinner, Empty, AssetIcon, Qr, CopyButton). Same names, same copy, same tokens.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Rect } from "react-native-svg";
import QRCode from "qrcode";
import * as Clipboard from "expo-clipboard";
import type { Warning } from "@clip-wallet/core";
import { hueFor } from "@clip-wallet/ui";
import { TABS, useWallet, type Route } from "./context";
import { IconAlert, IconBack, IconCheck, IconChevron, IconClock, IconCompass, IconGear, IconGlobe, IconGrid, IconHome } from "./icons";
import { useMobileT, type MobileMessageId } from "../i18n";

/* ------------------------------------------------------------------ text */

export function T(props: { children: ReactNode; v?: "display" | "h1" | "h2" | "body" | "lede" | "hint" | "label" | "mono"; style?: object; color?: string; testID?: string; numberOfLines?: number; selectable?: boolean }) {
  const { theme } = useWallet();
  const v = props.v ?? "body";
  const base = {
    display: { fontSize: 30, fontWeight: "700" as const, color: theme.c.text, letterSpacing: -0.5 },
    h1: { fontSize: 22, fontWeight: "700" as const, color: theme.c.text },
    h2: { fontSize: 13, fontWeight: "600" as const, color: theme.c.text2, textTransform: "uppercase" as const, letterSpacing: 0.6 },
    body: { fontSize: 16, color: theme.c.text },
    lede: { fontSize: 15, lineHeight: 21, color: theme.c.text2 },
    hint: { fontSize: 13, lineHeight: 18, color: theme.c.text3 },
    label: { fontSize: 14, fontWeight: "500" as const, color: theme.c.text2 },
    mono: { fontSize: 13, fontFamily: theme.mono, color: theme.c.text },
  }[v];
  return (
    <Text testID={props.testID} numberOfLines={props.numberOfLines} selectable={props.selectable} style={[base, props.color ? { color: props.color } : null, props.style]}>
      {props.children}
    </Text>
  );
}

/* ------------------------------------------------------------------ buttons */

export function Button(props: {
  children: ReactNode;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  block?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const { theme } = useWallet();
  const v = props.variant ?? "primary";
  const bg = v === "primary" ? theme.c.accent : v === "danger" ? theme.c.dangerBg : v === "secondary" ? theme.c.surface2 : "transparent";
  const fg = v === "primary" ? theme.c.accentText : v === "danger" ? theme.c.dangerFg : theme.c.text;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        { backgroundColor: bg, borderRadius: theme.r.md, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, opacity: props.disabled ? 0.45 : pressed ? 0.8 : 1 },
        props.block ? { alignSelf: "stretch" } : { flex: 1 },
        props.style,
      ]}
    >
      {typeof props.children === "string" ? <Text style={{ color: fg, fontSize: 16, fontWeight: "600" }}>{props.children}</Text> : props.children}
    </Pressable>
  );
}

export function LinkButton(props: { children: string; onPress: () => void; testID?: string }) {
  const { theme } = useWallet();
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" testID={props.testID} hitSlop={8}>
      <Text style={{ color: theme.c.accent, fontSize: 14, fontWeight: "600" }}>{props.children}</Text>
    </Pressable>
  );
}

export function IconButton(props: { onPress: () => void; label: string; children: ReactNode; testID?: string }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.label} testID={props.testID} hitSlop={10} style={{ padding: 6 }}>
      {props.children}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ layout */

export function Screen(props: { title?: ReactNode; back?: boolean | (() => void); actions?: ReactNode; children: ReactNode; nav?: boolean; scroll?: boolean; footer?: ReactNode }) {
  const { theme, back } = useWallet();
  const t = useMobileT();
  const insets = useSafeAreaInsets();
  const onBack = typeof props.back === "function" ? props.back : back;
  const body = (
    <View style={{ padding: theme.s(4), gap: theme.s(4), paddingBottom: theme.s(8) }}>{props.children}</View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: theme.c.bg, paddingTop: insets.top }}>
      {(props.title || props.back || props.actions) && (
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: theme.s(3), height: 48, gap: 8 }}>
          {props.back ? (
            <IconButton onPress={onBack} label={t("m.common.back")} testID="back">
              <IconBack color={theme.c.text} size={24} />
            </IconButton>
          ) : (
            <View style={{ width: 8 }} />
          )}
          <View style={{ flex: 1 }}>{typeof props.title === "string" ? <T v="h1" style={{ fontSize: 18 }}>{props.title}</T> : props.title}</View>
          <View style={{ flexDirection: "row", gap: 4 }}>{props.actions}</View>
        </View>
      )}
      {props.scroll === false ? <View style={{ flex: 1 }}>{props.children}</View> : <ScrollView keyboardShouldPersistTaps="handled">{body}</ScrollView>}
      {props.footer && <View style={{ padding: theme.s(4), paddingBottom: props.nav ? theme.s(4) : insets.bottom + theme.s(3), gap: theme.s(3) }}>{props.footer}</View>}
      {props.nav && <TabBar />}
    </View>
  );
}

const TAB_META: Record<(typeof TABS)[number], { label: MobileMessageId; Icon: typeof IconHome }> = {
  home: { label: "m.common.tab.home", Icon: IconHome },
  collectibles: { label: "m.common.tab.collectibles", Icon: IconGrid },
  explore: { label: "m.common.tab.explore", Icon: IconCompass },
  activity: { label: "m.common.tab.activity", Icon: IconClock },
  browser: { label: "m.common.tab.browse", Icon: IconGlobe },
  settings: { label: "m.common.tab.settings", Icon: IconGear },
};

export function TabBar() {
  const { theme, route, navigate } = useWallet();
  const t = useMobileT();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.c.border, backgroundColor: theme.c.surface, paddingBottom: insets.bottom, paddingTop: 6 }}>
      {TABS.map((name) => {
        const { label, Icon } = TAB_META[name];
        const active = route.name === name;
        const color = active ? theme.c.accent : theme.c.text3;
        return (
          <Pressable key={name} testID={`tab-${name}`} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => navigate({ name } as Route)} style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 4 }}>
            <Icon color={color} size={22} />
            <Text style={{ fontSize: 11, color, fontWeight: active ? "600" : "400" }}>{t(label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Card(props: { children: ReactNode; style?: ViewStyle }) {
  const { theme } = useWallet();
  return <View style={[{ backgroundColor: theme.c.surface, borderRadius: theme.r.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.c.border, padding: theme.s(4), gap: theme.s(3) }, props.style]}>{props.children}</View>;
}

export function Row(props: { label: ReactNode; value: ReactNode; hint?: ReactNode; testID?: string }) {
  return (
    <View testID={props.testID} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingVertical: 6 }}>
      {typeof props.label === "string" ? <T v="label">{props.label}</T> : props.label}
      <View style={{ alignItems: "flex-end", flexShrink: 1 }}>
        {typeof props.value === "string" ? <T style={{ textAlign: "right", fontSize: 15 }}>{props.value}</T> : props.value}
        {props.hint ? <T v="hint">{props.hint}</T> : null}
      </View>
    </View>
  );
}

export function Chip(props: { children: ReactNode; tone?: "neutral" | "accent" | "muted"; testID?: string }) {
  const { theme } = useWallet();
  const bg = props.tone === "accent" ? theme.c.accentSoft : theme.c.surface2;
  const fg = props.tone === "accent" ? theme.c.accent : theme.c.text2;
  return (
    <View testID={props.testID} style={{ backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "500" }}>{props.children}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Field(props: TextInputProps & { label: string; hint?: ReactNode; error?: string | null; trailing?: ReactNode }) {
  const { theme } = useWallet();
  const { label, hint, error, trailing, style, ...input } = props;
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label}</T>
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: theme.c.surface, borderRadius: theme.r.md, borderWidth: 1, borderColor: error ? theme.c.dangerFg : theme.c.border, paddingHorizontal: 14 }}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={theme.c.text3}
          style={[{ flex: 1, fontSize: 16, color: theme.c.text, paddingVertical: 13 }, style]}
          autoCorrect={false}
          {...input}
        />
        {trailing}
      </View>
      {error ? (
        <T v="hint" color={theme.c.dangerFg}>
          {error}
        </T>
      ) : hint ? (
        typeof hint === "string" ? <T v="hint">{hint}</T> : hint
      ) : null}
    </View>
  );
}

export function Toggle(props: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string }) {
  const { theme } = useWallet();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontSize: 15, fontWeight: "500" }}>{props.label}</T>
        {props.description ? <T v="hint">{props.description}</T> : null}
      </View>
      <Switch testID={props.testID} accessibilityLabel={props.label} value={props.checked} onValueChange={props.onChange} disabled={props.disabled} trackColor={{ true: theme.c.accent, false: theme.c.border }} />
    </View>
  );
}

/* ------------------------------------------------------------------ feedback */

const LEVEL_ORDER: Record<Warning["level"], number> = { danger: 0, caution: 1, info: 2 };

export function Notice(props: { level: Warning["level"]; children: ReactNode; testID?: string }) {
  const { theme } = useWallet();
  const [bg, fg] = props.level === "danger" ? [theme.c.dangerBg, theme.c.dangerFg] : props.level === "caution" ? [theme.c.cautionBg, theme.c.cautionFg] : [theme.c.infoBg, theme.c.infoFg];
  return (
    <View testID={props.testID} accessibilityRole={props.level === "danger" ? "alert" : "text"} style={{ flexDirection: "row", gap: 10, backgroundColor: bg, borderRadius: theme.r.md, padding: 12, alignItems: "flex-start" }}>
      <IconAlert color={fg} size={18} />
      <Text style={{ color: fg, flex: 1, fontSize: 14, lineHeight: 19 }}>{props.children}</Text>
    </View>
  );
}

export function Warnings(props: { warnings: Warning[] }) {
  if (!props.warnings.length) return null;
  const sorted = [...props.warnings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  return (
    <View style={{ gap: 8 }}>
      {sorted.map((w) => (
        <Notice key={w.code + w.message} level={w.level} testID={`warning-${w.code}`}>
          {w.message}
        </Notice>
      ))}
    </View>
  );
}

export function ErrorNote(props: { message: string | null | undefined }) {
  if (!props.message) return null;
  return (
    <Notice level="danger" testID="error">
      {props.message}
    </Notice>
  );
}

export function Spinner() {
  const { theme } = useWallet();
  const t = useMobileT();
  return <ActivityIndicator color={theme.c.accent} accessibilityLabel={t("m.kit.loading")} style={{ padding: 16 }} />;
}

export function Empty(props: { title: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 32, gap: 6 }}>
      <T style={{ fontWeight: "600" }}>{props.title}</T>
      {props.children ? <T v="hint" style={{ textAlign: "center" }}>{props.children}</T> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ assets */

export function AssetIcon(props: { symbol: string; size?: number }) {
  const size = props.size ?? 36;
  const hue = hueFor(props.symbol);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue}, 70%, 92%)`, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: `hsl(${hue}, 55%, 32%)`, fontWeight: "700", fontSize: size * 0.42 }}>{props.symbol.slice(0, 1)}</Text>
    </View>
  );
}

/** QR from the same `qrcode` library the extension uses, drawn as react-native-svg rects (no images, no WebView). */
export function Qr(props: { value: string; label: string; size?: number }) {
  const size = props.size ?? 200;
  const modules = useMemo(() => {
    try {
      return QRCode.create(props.value, { errorCorrectionLevel: "M" }).modules;
    } catch {
      return null;
    }
  }, [props.value]);
  if (!modules) return null;
  const n = modules.size;
  const cell = size / (n + 2);
  const rects: ReactNode[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (modules.get(x, y)) rects.push(<Rect key={`${x}-${y}`} x={(x + 1) * cell} y={(y + 1) * cell} width={cell + 0.3} height={cell + 0.3} fill="#141414" />);
  return (
    <View accessibilityRole="image" accessibilityLabel={props.label} style={{ alignSelf: "center", backgroundColor: "#fff", borderRadius: 12, padding: 6 }}>
      <Svg width={size} height={size}>{rects}</Svg>
    </View>
  );
}

export function CopyButton(props: { value: string; label?: string }) {
  const t = useMobileT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <Button
      variant="secondary"
      block
      onPress={async () => {
        await Clipboard.setStringAsync(props.value);
        setDone(true);
      }}
    >
      {done ? t("m.common.copied") : props.label ?? t("m.common.copy")}
    </Button>
  );
}

/* ------------------------------------------------------------------ choices (RN has no <select>) */

/** One-of-many as tappable rows (the extension's radio list / clip-options). */
export function Choices<V extends string | number>(props: {
  label: string;
  options: { value: V; title: string; hint?: string; badge?: string }[];
  value: V | undefined;
  onChange: (v: V) => void;
  testID?: string;
}) {
  const { theme } = useWallet();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={props.label} testID={props.testID} style={{ gap: 8 }}>
      {props.options.map((o) => {
        const on = o.value === props.value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            testID={props.testID ? `${props.testID}-${o.value}` : undefined}
            onPress={() => props.onChange(o.value)}
            style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: 14, borderRadius: theme.r.md, borderWidth: on ? 2 : 1, borderColor: on ? theme.c.accent : theme.c.border, backgroundColor: theme.c.surface }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <T style={{ fontWeight: "600", fontSize: 15 }}>{o.title}</T>
                {o.badge ? <Chip tone="accent">{o.badge}</Chip> : null}
              </View>
              {o.hint ? <T v="hint">{o.hint}</T> : null}
            </View>
            {on ? <IconCheck color={theme.c.accent} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small one-of-many pills in a row (asset pickers, slippage, "Open for"). */
export function Pills<V extends string | number>(props: { label: string; options: { value: V; label: string }[]; value: V | undefined; onChange: (v: V) => void; testID?: string }) {
  const { theme } = useWallet();
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{props.label}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" accessibilityRole="radiogroup" accessibilityLabel={props.label} contentContainerStyle={{ gap: 8 }}>
        {props.options.map((o) => {
          const on = o.value === props.value;
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${props.label}: ${o.label}`}
              testID={props.testID ? `${props.testID}-${o.value}` : undefined}
              onPress={() => props.onChange(o.value)}
              style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: on ? theme.c.accent : theme.c.surface2 }}
            >
              <Text style={{ color: on ? theme.c.accentText : theme.c.text, fontWeight: "600", fontSize: 14 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function Checkbox(props: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; testID?: string }) {
  const { theme } = useWallet();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked, disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={() => props.onChange(!props.checked)}
      testID={props.testID}
      style={{ flexDirection: "row", gap: 10, alignItems: "center", opacity: props.disabled ? 0.5 : 1 }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: props.checked ? theme.c.accent : theme.c.border, backgroundColor: props.checked ? theme.c.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
        {props.checked ? <IconCheck color={theme.c.accentText} size={14} /> : null}
      </View>
      <T style={{ flex: 1, fontSize: 15 }}>{props.label}</T>
    </Pressable>
  );
}

/** Numbered steps ("What you'll approve", device instructions). */
export function Steps(props: { items: string[]; label?: string }) {
  const { theme } = useWallet();
  return (
    <View accessibilityLabel={props.label} style={{ gap: 10 }}>
      {props.items.map((s, i) => (
        <View key={s + i} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.c.surface2, alignItems: "center", justifyContent: "center" }}>
            <T v="hint">{i + 1}</T>
          </View>
          <T style={{ flex: 1, fontSize: 15 }}>{s}</T>
        </View>
      ))}
    </View>
  );
}

/** A menu row that opens a screen (Settings → More / Security, Explore actions). */
export function MenuItem(props: { title: string; hint?: string; onPress: () => void; testID?: string; icon?: ReactNode }) {
  const { theme } = useWallet();
  return (
    <Pressable accessibilityRole="button" testID={props.testID} onPress={props.onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
      {props.icon}
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontWeight: "500" }}>{props.title}</T>
        {props.hint ? <T v="hint">{props.hint}</T> : null}
      </View>
      <IconChevron color={theme.c.text3} />
    </Pressable>
  );
}
