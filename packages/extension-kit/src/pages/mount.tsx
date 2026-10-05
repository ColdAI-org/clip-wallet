/** Shared bootstrap for the popup, full-tab and approval-window pages. */
import "../shared/node-globals";
import "@fontsource-variable/inter";
import "@clip-wallet/ui/styles.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalWindowApp, WalletApp, type UiOptions, type Variant } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import config from "../config";
import { CURRENCIES, MEDIA_PROXY_URL } from "../app-settings";
import { createBusClient } from "../shared/bus";
import { createFeaturesBusClient } from "../shared/features-bus";
import { call, hardwareClient } from "./hardware/client";
import { SignAgent, withDeviceSteps } from "./hardware/agent";
import { cancelDevice, deviceSigner, keystoneExchange, onDeviceChange } from "./hardware/devices";
import { createSocialBusClient } from "../shared/social-bus";
import { createSecurityBusClient } from "../shared/security-bus";
import { createLinkBusClient } from "../shared/link-bus";
import { createPasskeyFactory } from "../passkey/bridge";
import type {} from "../globals";

const options: Partial<UiOptions> = {
  iconUrl: browser.runtime.getURL("/icon/128.png"),
  mediaProxyUrl: MEDIA_PROXY_URL,
  currencies: CURRENCIES,
};

function render(node: ReactNode) {
  createRoot(document.getElementById("root")!).render(<StrictMode>{node}</StrictMode>);
}

export function mountWallet(variant: Exclude<Variant, "window">) {
  const client = createBusClient(undefined, __CLIP_MOCKS__);
  // The action popup can't host a WebAuthn ceremony (the OS sheet closes it); the tab can.
  const passkeys = createPasskeyFactory(variant === "tab");
  render(<WalletApp client={client} config={config} options={options} variant={variant} passkeys={passkeys} features={createFeaturesBusClient()} hardware={hardwareClient} social={createSocialBusClient()} security={createSecurityBusClient()} link={createLinkBusClient()} />);
}

export function mountApprovalWindow() {
  const bus = createBusClient(undefined, __CLIP_MOCKS__);
  // Hardware accounts sign here (WebHID, camera); the background verifies what comes back.
  const agent = new SignAgent({ call: (m) => call(m as never), signer: deviceSigner, cancelDevice, exchange: keystoneExchange });
  bus.onChange?.(() => void agent.poll());
  void agent.poll();
  const client = withDeviceSteps(bus, agent, onDeviceChange);
  const focusId = decodeURIComponent(location.hash.slice(1)) || undefined;
  render(
    <ApprovalWindowApp
      client={client}
      config={config}
      options={options}
      passkeys={createPasskeyFactory(true)}
      focusId={focusId}
      hardware={hardwareClient}
      social={createSocialBusClient()}
      onEmpty={() => window.close()}
    />,
  );
}
