// packages/mobile/app.config.ts: Expo's app config from the project's clip.config.ts (@coldai/clip-wallet-mobile-kit).
import { expoConfig } from "@coldai/clip-wallet-mobile-kit/expo";

export default () => expoConfig({ configFile: "../../clip.config.ts", root: __dirname });
