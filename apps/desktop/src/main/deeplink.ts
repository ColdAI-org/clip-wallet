/**
 * Deep links (registered with app.setAsDefaultProtocolClient("clipwallet")). Same set as the phone
 * (apps/mobile/src/lib/deeplinks.ts):
 *   clipwallet://wc?uri=<encoded wc: URI>        WalletConnect pairing; the user still approves the connection
 *   clipwallet://browse?url=<encoded https URL>   open a dapp in the built-in browser (phishing check applies)
 *   clipwallet://trade#offer=… or ?offer=…        a Secure Trade offer (opens the review; Accept still asks)
 *   wc:…                                          a bare WalletConnect URI
 * Anything else is ignored. Pure, unit-tested.
 */
import { webOrigin } from "./browser/url-policy";

export type DeepLink = { kind: "wc"; uri: string } | { kind: "browse"; url: string } | { kind: "trade"; route: string } | null;

const OFFER = /(?:^|[#&?])offer=([A-Za-z0-9_-]{1,16000})(?:$|&)/;

/** WalletConnect v2 pairing URI: wc:<topic>@2?…symKey=… (https://specs.walletconnect.com/2.0/specs/clients/core/pairing/pairing-uri). */
export function isWalletConnectUri(s: string): boolean {
  return /^wc:[0-9a-f]{64}@2\?/i.test(s) && /[?&]symKey=[0-9a-f]{64}(&|$)/i.test(s) && s.length <= 1000;
}

export function parseDeepLink(raw: string | null | undefined, scheme = "clipwallet"): DeepLink {
  if (!raw) return null;
  const s = raw.trim();
  if (s.startsWith("wc:")) return isWalletConnectUri(s) ? { kind: "wc", uri: s } : null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== `${scheme}:`) return null;
  const action = u.hostname || u.pathname.replace(/^\/+/, "").split("/")[0];
  if (action === "wc") {
    const uri = u.searchParams.get("uri");
    return uri && isWalletConnectUri(uri) ? { kind: "wc", uri } : null;
  }
  if (action === "trade") {
    const m = OFFER.exec(u.hash) ?? OFFER.exec(u.search);
    return m ? { kind: "trade", route: `/trade/open?link=${encodeURIComponent(`#offer=${m[1]}`)}` } : null;
  }
  if (action === "browse") {
    const url = u.searchParams.get("url");
    return url && webOrigin(url) ? { kind: "browse", url } : null;
  }
  return null;
}

/** The deep link among a process's argv (Windows / Linux hand it over as an argument). */
export function deepLinkFromArgv(argv: readonly string[], scheme = "clipwallet"): string | null {
  return argv.find((a) => a.startsWith(`${scheme}:`) || a.startsWith("wc:")) ?? null;
}
