/**
 * Deep links. Accepted:
 *   clipwallet://wc?uri=<encoded wc: URI>          WalletConnect pairing (what dapps open on mobile)
 *   clipwallet://browse?url=<encoded https URL>     open a dapp in the in-app browser
 *   clipwallet://trade#offer=… or ?offer=…          a Secure Trade offer (opens the review; Accept still asks)
 *   clipwallet://link?v=1&c=…&k=…                   a Clip Link pairing code (both screens still show a code to compare)
 *   clipwallet://browse?url=…&h=…                   "continue elsewhere" from a device with this wallet (h opens only there)
 *   https://<associated domain>/wc?uri=…, /trade#offer=…   universal links (placeholder until a domain is associated)
 *   wc:…                                            a bare WalletConnect URI (some apps hand it over as-is)
 * Anything else is ignored. Pairing still requires the user to approve the connection.
 */
import { isWalletConnectUri } from "@clip-wallet/ui";
import { webOrigin } from "../browser/bridge";
import { parseOfferUri } from "@clip-wallet/link";

export type DeepLink =
  | { kind: "wc"; uri: string }
  | { kind: "browse"; url: string; handoff?: string }
  | { kind: "trade"; link: string }
  | { kind: "link"; uri: string }
  | null;

/** Same payload shape and limit @clip-wallet/features' decodeOffer accepts (it does the real checks). */
const OFFER = /(?:^|[#&?])offer=([A-Za-z0-9_-]{1,16000})(?:$|&)/;

export function parseDeepLink(raw: string | null | undefined, opts: { scheme: string; universalHost?: string }): DeepLink {
  if (!raw) return null;
  const s = raw.trim();
  if (s.startsWith("wc:")) return isWalletConnectUri(s) ? { kind: "wc", uri: s } : null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const isApp = u.protocol === `${opts.scheme}:`;
  const isUniversal = u.protocol === "https:" && !!opts.universalHost && u.hostname === opts.universalHost;
  if (!isApp && !isUniversal) return null;
  // clipwallet://wc?… parses with host "wc"; https://host/wc?… with pathname "/wc".
  const action = isApp ? u.hostname || u.pathname.replace(/^\/+/, "") : u.pathname.replace(/^\/+/, "");
  if (action === "wc") {
    const uri = u.searchParams.get("uri");
    return uri && isWalletConnectUri(uri) ? { kind: "wc", uri } : null;
  }
  if (action === "trade") {
    // The offer travels in the fragment (never sent to a server) or the query; hand over just that part.
    const m = OFFER.exec(u.hash) ?? OFFER.exec(u.search);
    return m ? { kind: "trade", link: `#offer=${m[1]}` } : null;
  }
  if (action === "browse") {
    const url = u.searchParams.get("url");
    if (!url || !webOrigin(url)) return null;
    return u.searchParams.get("h") && isApp ? { kind: "browse", url, handoff: s } : { kind: "browse", url };
  }
  if (action === "link" && isApp) {
    return parseOfferUri(s) ? { kind: "link", uri: s } : null;
  }
  return null;
}

/**
 * A scanned Secure Trade QR: any link (ours, the extension's https link, another wallet's) carrying an
 * `offer=` payload. Returns just the `#offer=…` part; @clip-wallet/features decodes and checks it.
 */
export function tradeOfferFrom(text: string): string | null {
  const m = OFFER.exec(text.trim());
  return m ? `#offer=${m[1]}` : null;
}
