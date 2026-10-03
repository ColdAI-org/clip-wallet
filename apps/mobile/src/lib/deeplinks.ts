/**
 * Deep links. Accepted:
 *   clipwallet://wc?uri=<encoded wc: URI>          WalletConnect pairing (what dapps open on mobile)
 *   clipwallet://browse?url=<encoded https URL>     open a dapp in the in-app browser
 *   https://<associated domain>/wc?uri=…            universal link (placeholder until a domain is associated)
 *   wc:…                                            a bare WalletConnect URI (some apps hand it over as-is)
 * Anything else is ignored. Pairing still requires the user to approve the connection.
 */
import { isWalletConnectUri } from "@clip-wallet/ui";
import { webOrigin } from "../browser/bridge";

export type DeepLink = { kind: "wc"; uri: string } | { kind: "browse"; url: string } | null;

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
  if (action === "browse") {
    const url = u.searchParams.get("url");
    return url && webOrigin(url) ? { kind: "browse", url } : null;
  }
  return null;
}
