/**
 * Entry script of the extension's sandbox page (`plugin-sandbox.html`, listed under `sandbox.pages` in the
 * manifest, CSP = SANDBOX_CSP). Chrome serves sandbox pages in a unique opaque origin with no extension APIs;
 * this script then hardens the realm with SES and runs exactly one plugin.
 *
 * It only talks to `window.parent` (the wallet's offscreen host document) and ignores every other sender.
 *
 * @module
 */
import "ses";
import { createSandboxRuntime, type SesApi } from "./runtime.js";
import type { SandboxToHost } from "./messages.js";

declare const lockdown: (opts?: Record<string, string>) => void;
declare const Compartment: SesApi["Compartment"];
declare const harden: SesApi["harden"];

lockdown({ errorTaming: "safe", overrideTaming: "severe", consoleTaming: "safe", localeTaming: "safe" });

// Sandboxed pages have an opaque ("null") origin, but their URL is still chrome-extension://<id>/…: the parent
// (an extension page) has exactly that origin, so replies can be addressed to it and nowhere else.
const parentOrigin = `${location.protocol}//${location.host}`;
const parentWindow = window.parent;

const runtime = createSandboxRuntime({
  Compartment,
  harden,
  post: (msg: SandboxToHost) => parentWindow.postMessage(msg, parentOrigin),
});

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== parentWindow || e.origin !== parentOrigin) return;
  runtime.receive(e.data);
});

parentWindow.postMessage({ type: "booted" } satisfies SandboxToHost, parentOrigin);
