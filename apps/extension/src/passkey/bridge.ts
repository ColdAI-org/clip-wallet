/**
 * Passkey ceremonies for extension pages.
 *
 * VERIFIED (sources, checked 2026-10-03):
 *  - Chrome 122+ lets an extension page call navigator.credentials.create/get with rp.id set to its own
 *    extension id, or to a registrable domain the extension holds host permissions for; it may not claim
 *    another extension's id or a public suffix. clientDataJSON.origin is chrome-extension://<id>.
 *    https://lists.w3.org/Archives/Public/public-webauthn/2023Dec/0078.html (Nina Satragno, Google)
 *    https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Use_the_web_authn_api
 *  - Firefox 150 lets extensions assert an RP id for host-permission domains (stable moz-extension origin).
 *    https://blog.mozilla.org/addons/2026/04/23/webextensions-api-changes-firefox-149-152/
 *  - The extension popup closes when the credential prompt takes focus (documented for Firefox, reported
 *    for Chrome as issuetracker 378966968), so ceremonies run in a full tab / popup window, never the
 *    action popup. The service worker has no navigator.credentials at all.
 *    https://issuetracker.google.com/issues/378966968
 *  - chrome.webAuthenticationProxy is for remote-desktop forwarding only, not for choosing an RP id.
 *    https://developer.chrome.com/docs/extensions/reference/api/webAuthenticationProxy
 *  - externally_connectable works in Chrome/Edge/Safari, not Firefox (bug 1319168), so the web bridge
 *    below is Chromium-only; Firefox < 150 would need a content-script relay.
 *    https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/externally_connectable
 *  - PRF: on by default since Chrome 116; Google Password Manager passkeys support PRF; iCloud Keychain
 *    via Chrome 132+ / Firefox 139; Windows Hello needs Windows 11 24H2+ with the Feb 2026 update
 *    (secondary source: https://www.corbado.com/blog/passkeys-prf-webauthn). Without PRF we throw
 *    "no-prf" and the user keeps the password.
 *  - EMPIRICAL: apps/extension/e2e/real.spec.ts ("passkey unlock") enrols and unlocks the real vault with PRF from the built
 *    extension's tab page against Chromium's CDP virtual authenticator (rp.id = extension id).
 *
 * Default: "extension" mode (ceremony in our own tab). Fallback "web-bridge": a small page on a web
 * origin (passkey-bridge/, PLACEHOLDER URL in src/app-settings.ts) runs the ceremony and returns the PRF
 * output via chrome.runtime.sendMessage(extensionId, ...) (externally_connectable).
 */
import { browser } from "wxt/browser";
import {
  b64urlDecode,
  b64urlEncode,
  PasskeyError,
  WebAuthnPasskeyPrf,
  type PasskeyCeremony,
  type PasskeyFactory,
  type PasskeyPrf,
} from "@clip-wallet/ui";

export const BRIDGE_RESULT = "clip-passkey-bridge-result";

interface BridgeResult {
  type: typeof BRIDGE_RESULT;
  nonce: string;
  credentialId?: string;
  prfOutput?: string;
  error?: string;
}

/** Runs the ceremony on the web-bridge origin and waits for its external message. */
export class WebBridgePasskeyPrf implements PasskeyPrf {
  constructor(private readonly c: PasskeyCeremony) {}

  private async run(op: "enroll" | "unlock", prfInput: Uint8Array, credentialId?: Uint8Array): Promise<BridgeResult> {
    const bridge = new URL(this.c.bridgeUrl);
    const nonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const params = new URLSearchParams({
      op,
      ext: browser.runtime.id,
      nonce,
      rpName: this.c.rpName,
      userId: this.c.userId,
      prfInput: b64urlEncode(prfInput),
      ...(credentialId ? { credentialId: b64urlEncode(credentialId) } : {}),
    });
    // Fragment, not query: the parameters never reach the bridge server's logs.
    const win = await browser.windows.create({ url: `${bridge.origin}${bridge.pathname}#${params}`, type: "popup", width: 420, height: 560 });
    return new Promise<BridgeResult>((resolve, reject) => {
      const timer = setTimeout(() => done(new PasskeyError("The passkey page didn't answer. Your password still works.", "failed")), 180_000);
      const on = (msg: unknown, sender: { origin?: string; url?: string }) => {
        const m = msg as BridgeResult;
        const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : "");
        if (origin !== bridge.origin || m?.type !== BRIDGE_RESULT || m.nonce !== nonce) return;
        done(undefined, m);
      };
      const done = (err?: unknown, m?: BridgeResult) => {
        clearTimeout(timer);
        browser.runtime.onMessageExternal.removeListener(on);
        if (win?.id !== undefined) void browser.windows.remove(win.id).catch(() => undefined);
        if (err) reject(err);
        else if (m?.error) reject(new PasskeyError("Passkey request was cancelled. Your password still works.", "cancelled"));
        else resolve(m!);
      };
      browser.runtime.onMessageExternal.addListener(on);
    });
  }

  async enroll(prfInput: Uint8Array) {
    const r = await this.run("enroll", prfInput);
    if (!r.credentialId || !r.prfOutput) throw new PasskeyError("This passkey can't unlock a wallet.", "no-prf");
    return { credentialId: b64urlDecode(r.credentialId), prfOutput: b64urlDecode(r.prfOutput) };
  }

  async evaluate(credentialId: Uint8Array, prfInput: Uint8Array) {
    const r = await this.run("unlock", prfInput, credentialId);
    if (!r.prfOutput) throw new PasskeyError("This passkey can't unlock a wallet.", "no-prf");
    return b64urlDecode(r.prfOutput);
  }
}

export function createPasskeyFactory(canRunHere: boolean): PasskeyFactory {
  return {
    canRunHere,
    create(c) {
      if (c.mode === "web-bridge") return new WebBridgePasskeyPrf(c);
      return new WebAuthnPasskeyPrf({ rpId: c.rpId, rpName: c.rpName, userId: b64urlDecode(c.userId || "AA"), userName: c.userName });
    },
  };
}
