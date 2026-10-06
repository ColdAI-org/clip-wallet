/** Shared bootstrap for the wallet and approval windows (same packages/ui screens as the extension). */
import "./globals";
import "@fontsource-variable/inter";
import "@clip-wallet/ui/styles.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalWindowApp, WalletApp, type UiOptions } from "@clip-wallet/ui";
import { DESKTOP } from "../../shared/app-config";
import { createFeaturesClient, createHardwareClient, createLinkBridgeClient, createSecurityClient, createSocialBridgeClient, createWalletClient, desktopInfo, touchIdFactory } from "./clients";
import { desktop } from "./bridge";
import { startHidAgent } from "./hid-agent";

const options: Partial<UiOptions> = {
  // The wallet's own icon (clip.config icon, inlined at build time): no file to keep in step.
  iconUrl: DESKTOP.identity.icon,
  ...(DESKTOP.config.services.mediaProxyUrl ? { mediaProxyUrl: DESKTOP.config.services.mediaProxyUrl } : {}),
  currencies: ["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD"],
};

function render(node: ReactNode) {
  createRoot(document.getElementById("root")!).render(<StrictMode>{node}</StrictMode>);
}

export async function mountWallet() {
  document.documentElement.dataset.platform = desktop().platform;
  const info = await desktopInfo();
  startHidAgent();
  render(
    <WalletApp
      client={createWalletClient()}
      config={DESKTOP.config}
      options={options}
      variant="tab"
      passkeys={touchIdFactory(!!info?.biometrics.available)}
      features={createFeaturesClient()}
      hardware={createHardwareClient()}
      social={createSocialBridgeClient()}
      security={createSecurityClient()}
      link={createLinkBridgeClient()}
    />,
  );
}

export async function mountApproval() {
  document.documentElement.dataset.platform = desktop().platform;
  const info = await desktopInfo();
  startHidAgent();
  const focusId = decodeURIComponent(location.hash.slice(1)) || undefined;
  render(
    <ApprovalWindowApp
      client={createWalletClient()}
      config={DESKTOP.config}
      options={options}
      passkeys={touchIdFactory(!!info?.biometrics.available)}
      focusId={focusId}
      hardware={createHardwareClient()}
      social={createSocialBridgeClient()}
      onEmpty={() => void desktop().desktop({ op: "closeSelf" })}
    />,
  );
}
