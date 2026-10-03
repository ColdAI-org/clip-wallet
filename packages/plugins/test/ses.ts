/**
 * Locks down this test process exactly like the sandbox page does (sandbox-entry.ts), then exposes SES's
 * Compartment and harden. Import this first in any test that runs plugin code.
 */
import "ses";
import type { SesApi } from "../src/runtime.js";

declare const lockdown: (opts?: Record<string, string>) => void;
declare const Compartment: SesApi["Compartment"];
declare const harden: SesApi["harden"];

// errorTaming/stackFiltering "unsafe"/"verbose" only so test failures stay readable; the sandbox uses "safe".
lockdown({ errorTaming: "unsafe", overrideTaming: "severe", consoleTaming: "unsafe", stackFiltering: "verbose", localeTaming: "unsafe", errorTrapping: "none", unhandledRejectionTrapping: "none" });

export const ses: SesApi = { Compartment, harden };
