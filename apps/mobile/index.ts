// Polyfills first: WalletConnect's RN compat (getRandomValues, TextEncoder, URL, Buffer…) + randomUUID.
import "./src/polyfills";
import { createElement } from "react";
import { registerRootComponent } from "expo";
import { App } from "./src/App";
import { createMobileWallet } from "./src/background/host";

const wallet = createMobileWallet();

registerRootComponent(() => createElement(App, { wallet }));
