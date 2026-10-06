/**
 * The wallet's own artwork for the screens that show it (onboarding, About). A wallet project passes its bundled
 * icon once at start-up (registerClipWallet({ icon: require("./assets/icon.png") })); until then the screens draw no
 * image. It is the same 1024 px icon the app store listing uses (create-clip-wallet renders it from the logo).
 */
import type { ImageSourcePropType } from "react-native";

let icon: ImageSourcePropType | undefined;

export function setBrandIcon(source: ImageSourcePropType | undefined): void {
  icon = source;
}

export function brandIcon(): ImageSourcePropType | undefined {
  return icon;
}
