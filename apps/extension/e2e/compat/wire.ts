/**
 * Records what crosses 1Mask's page ↔ content-script channel while an unmodified dapp library runs: every request
 * (family + method), its outcome reduced to a SHAPE (keys, types, error codes; no addresses, signatures, ids or
 * times), and every event. The compat suite snapshots these traces so a change that alters a method's result,
 * an error code or an event a dapp library relies on fails the suite.
 *
 * Runs as a Playwright init script in the page's main world (the same world 1Mask's inpage script lives in).
 */
export const WIRE_TAP = `(() => {
  const SRC_IN = "1mask-inpage", SRC_OUT = "1mask-content";
  const shape = (v, depth = 0) => {
    if (depth > 6) return "<deep>";
    if (v === null || v === undefined) return v === null ? null : "<undefined>";
    if (typeof v === "string") {
      if (/^0x[0-9a-fA-F]{40}$/.test(v)) return "<evm-address>";
      if (/^0x[0-9a-fA-F]*$/.test(v) && v.length > 20) return "<hex " + (v.length - 2) / 2 + " bytes>";
      if (v.startsWith("data:")) return "<data-url>";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return "<uuid>";
      if (/^[1-9A-HJ-NP-Za-km-z]{32,60}$/.test(v)) return "<base58>";
      if (/^(https?:)\\/\\//.test(v)) return v.replace(/^(https?:\\/\\/[^/]+).*/, "$1");
      if (v.length > 48 && /^[A-Za-z0-9+/=_-]+$/.test(v)) return "<base64>";
      if (v.length > 120) return "<long string>";
      return v;
    }
    if (typeof v === "number") return v > 1e12 ? "<timestamp>" : v;
    if (typeof v !== "object") return typeof v;
    if (ArrayBuffer.isView(v)) return "<bytes " + v.byteLength + ">";
    if (v instanceof ArrayBuffer) return "<bytes " + v.byteLength + ">";
    if (Array.isArray(v)) {
      if (v.length > 8 && v.every((x) => typeof x === "number")) return "<bytes " + v.length + ">";
      return v.map((x) => shape(x, depth + 1));
    }
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = shape(v[k], depth + 1);
    return out;
  };
  const wire = { requests: [], events: [] };
  const byId = new Map();
  window.__wire = wire;
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || typeof d !== "object") return;
    if (d.source === SRC_IN && d.type === "request") {
      const entry = { family: d.family, method: d.method };
      byId.set(d.id, entry);
      wire.requests.push(entry);
    } else if (d.source === SRC_OUT && d.type === "response") {
      const entry = byId.get(d.id);
      if (!entry) return;
      if (d.error) entry.error = { code: d.error.code };
      else entry.result = shape(d.result);
    } else if (d.source === SRC_OUT && d.type === "event") {
      wire.events.push({ family: d.family, event: d.event, data: shape(d.data) });
    }
  });
})();`;

export interface WireTrace {
  requests: { family: string; method: string; result?: unknown; error?: { code: number } }[];
  events: { family: string; event: string; data: unknown }[];
}

/** Order-independent form: concurrent requests from a library may interleave differently from run to run. */
export function canonical(t: WireTrace): { requests: string[]; events: string[] } {
  const uniq = (xs: unknown[]) => [...new Set(xs.map((x) => JSON.stringify(x)))].sort();
  return { requests: uniq(t.requests), events: uniq(t.events) };
}
