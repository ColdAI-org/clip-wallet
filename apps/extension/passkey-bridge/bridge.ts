/**
 * Passkey web bridge page script (fallback ceremony on a web origin). See index.html.
 * Input arrives in the URL fragment; output goes to the extension id from the fragment, which only
 * accepts it from this origin (externally_connectable) with the matching nonce.
 */
import { WebAuthnPasskeyPrf, b64urlDecode, b64urlEncode } from "@clip-wallet/ui";

declare const chrome: { runtime: { sendMessage(extId: string, msg: unknown): Promise<unknown> } };

const p = new URLSearchParams(location.hash.slice(1));
history.replaceState(null, "", location.pathname); // drop the fragment from history
const status = document.getElementById("status")!;

async function run() {
  const ext = p.get("ext") ?? "";
  const nonce = p.get("nonce") ?? "";
  const prf = new WebAuthnPasskeyPrf({
    rpId: location.hostname,
    rpName: p.get("rpName") ?? "Wallet",
    userId: b64urlDecode(p.get("userId") ?? "AA"),
    userName: p.get("rpName") ?? "Wallet",
  });
  const prfInput = b64urlDecode(p.get("prfInput") ?? "");
  try {
    if (p.get("op") === "enroll") {
      const r = await prf.enroll(prfInput);
      await chrome.runtime.sendMessage(ext, { type: "clip-passkey-bridge-result", nonce, credentialId: b64urlEncode(r.credentialId), prfOutput: b64urlEncode(r.prfOutput) });
    } else {
      const out = await prf.evaluate(b64urlDecode(p.get("credentialId") ?? ""), prfInput);
      await chrome.runtime.sendMessage(ext, { type: "clip-passkey-bridge-result", nonce, prfOutput: b64urlEncode(out) });
    }
    status.textContent = "Done. You can close this window.";
  } catch {
    await chrome.runtime.sendMessage(ext, { type: "clip-passkey-bridge-result", nonce, error: "failed" }).catch(() => undefined);
    status.textContent = "That didn't work. Close this window and use your password.";
  }
}

// A user gesture is required for WebAuthn in a freshly opened window.
document.getElementById("go")!.addEventListener("click", () => void run(), { once: true });
