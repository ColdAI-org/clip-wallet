/** The extension's line icons (packages/ui/src/components/icons.tsx) in react-native-svg. */
import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { ReactNode } from "react";

type P = { color: string; size?: number };
const S = (p: P & { children: ReactNode }) => (
  <Svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none" stroke={p.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {p.children}
  </Svg>
);

export const IconHome = (p: P) => (
  <S {...p}>
    <Path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </S>
);
export const IconGrid = (p: P) => (
  <S {...p}>
    <Rect x="3" y="3" width="7.5" height="7.5" rx="2" />
    <Rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
    <Rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
    <Rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
  </S>
);
export const IconClock = (p: P) => (
  <S {...p}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 7v5l3 2" />
  </S>
);
export const IconGlobe = (p: P) => (
  <S {...p}>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </S>
);
export const IconGear = (p: P) => (
  <S {...p}>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </S>
);
export const IconArrowUp = (p: P) => (
  <S {...p}>
    <Path d="M12 19V5M5 12l7-7 7 7" />
  </S>
);
export const IconArrowDown = (p: P) => (
  <S {...p}>
    <Path d="M12 5v14M19 12l-7 7-7-7" />
  </S>
);
export const IconBack = (p: P) => (
  <S {...p}>
    <Path d="M15 18l-6-6 6-6" />
  </S>
);
export const IconChevron = (p: P) => (
  <S {...p}>
    <Path d="M9 18l6-6-6-6" />
  </S>
);
export const IconCheck = (p: P) => (
  <S {...p}>
    <Path d="M20 6 9 17l-5-5" />
  </S>
);
export const IconLock = (p: P) => (
  <S {...p}>
    <Rect x="4" y="11" width="16" height="10" rx="2" />
    <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </S>
);
export const IconShield = (p: P) => (
  <S {...p}>
    <Path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
    <Path d="m9 12 2 2 4-4" />
  </S>
);
export const IconAlert = (p: P) => (
  <S {...p}>
    <Path d="M12 3 2 21h20z" />
    <Path d="M12 10v5M12 18h.01" />
  </S>
);
export const IconFingerprint = (p: P) => (
  <S {...p}>
    <Path d="M12 11v3a8 8 0 0 1-1.5 4.5M8 8.5A5 5 0 0 1 17 11v1.5M6 12a6 6 0 0 1 .6-2.6M17 15.5a13 13 0 0 1-1 3.5M9 12a3 3 0 0 1 6 0v1a11 11 0 0 1-1.6 5.6M4 7.5A9 9 0 0 1 20.5 9" />
  </S>
);
export const IconScan = (p: P) => (
  <S {...p}>
    <Path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
  </S>
);
export const IconReload = (p: P) => (
  <S {...p}>
    <Path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </S>
);
