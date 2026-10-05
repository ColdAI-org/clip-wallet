/**
 * The contract between a picker page and pickers.spec.ts. The page renders the library's stock connect UI, unmodified,
 * and below it one line the spec reads: the account the LIBRARY reports (its own hook/state), in #account. It also
 * exposes `window.__picker`:
 *   info        which library and version
 *   disconnect  the library's own disconnect call (what its account menu calls)
 */
import { useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export interface PickerInfo {
  library: string;
  /** Anything about the configuration a reader of the results should know (all defaults unless said here). */
  config: string;
}

export function expose(info: PickerInfo, api: { disconnect?: () => Promise<unknown> | unknown } = {}) {
  (window as unknown as { __picker: unknown }).__picker = { info, disconnect: async () => void (await api.disconnect?.()) };
}

/** The account line: what the library says is connected ("" when nothing is). */
export function Account({ address }: { address?: string | null }) {
  useEffect(() => {
    (window as unknown as { __account?: string }).__account = address ?? "";
  }, [address]);
  return (
    <p>
      Connected account: <span id="account">{address ?? ""}</span>
    </p>
  );
}

export function mount(node: ReactNode) {
  createRoot(document.getElementById("root")!).render(node);
}
