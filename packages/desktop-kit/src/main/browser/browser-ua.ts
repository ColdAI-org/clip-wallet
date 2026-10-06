/**
 * Sites see Chromium's user agent, not ours: drop the Electron token and the app's own ("Acme-Wallet/0.1.0",
 * "acme-wallet-desktop/0.1.0").
 */
export function stripAppTokens(ua: string, name: string): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const names = [name, name.replace(/\s+/g, "-"), slug, `${slug}-desktop`, "@clip-wallet/desktop"];
  const re = new RegExp(`\\s(?:Electron|${[...new Set(names)].map(esc).join("|")})/\\S+`, "gi");
  return ua.replace(re, "");
}
