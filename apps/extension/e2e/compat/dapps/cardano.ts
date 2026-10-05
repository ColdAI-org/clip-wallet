/**
 * An unmodified Cardano dapp: CIP-30 detection the way every Cardano wallet picker does it (enumerate window.cardano,
 * keep entries with enable/isEnabled/apiVersion), then enable() and getNetworkId().
 */
interface Cip30Entry {
  name: string;
  icon: string;
  apiVersion: string;
  enable(): Promise<{ getNetworkId(): Promise<number> }>;
  isEnabled(): Promise<boolean>;
}

let entry: Cip30Entry | undefined;

const steps: Record<string, () => Promise<unknown>> = {
  detect: async () => {
    const cardano = (window as unknown as { cardano?: Record<string, Cip30Entry> }).cardano ?? {};
    const keys = Object.keys(cardano).filter((k) => typeof cardano[k]?.enable === "function" && typeof cardano[k]?.isEnabled === "function");
    const key = keys.find((k) => cardano[k]!.name === "Clip Wallet");
    if (!key) throw new Error("Clip Wallet was not detected");
    entry = cardano[key];
    return { key, apiVersion: entry!.apiVersion, hasIcon: entry!.icon.startsWith("data:"), enabled: await entry!.isEnabled() };
  },
  enable: async () => {
    const api = await entry!.enable();
    return { networkId: await api.getNetworkId(), enabled: await entry!.isEnabled() };
  },
};

(window as unknown as { __compat: unknown }).__compat = { run: (s: string) => steps[s]!() };
