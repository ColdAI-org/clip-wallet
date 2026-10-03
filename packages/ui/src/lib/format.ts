/** Base units (decimal string) → human string, trimmed. */
export function formatUnits(amount: string | bigint, decimals: number, maxFraction = 6): string {
  let v = typeof amount === "bigint" ? amount : BigInt(amount || "0");
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, Math.min(decimals, maxFraction));
  frac = frac.replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${wholeStr}${frac ? `.${frac}` : ""}`;
}

/** Human string → base units. Returns null when the input is not a plain positive decimal. */
export function parseUnits(value: string, decimals: number): bigint | null {
  const v = value.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  const [w = "0", f = ""] = v.split(".");
  if (f.length > decimals) return null;
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatFiat(value: number | undefined, currency: string, opts?: { signed?: boolean }): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const fmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: abs > 0 && abs < 0.01 ? 4 : 2,
  });
  const s = fmt.format(abs);
  if (opts?.signed) return `${value < 0 ? "−" : "+"}${s}`;
  return value < 0 ? `−${s}` : s;
}

export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + (address.startsWith("0x") ? 2 : 0))}…${address.slice(-chars)}`;
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function readyIn(seconds: number): string {
  if (seconds <= 3) return "in a moment";
  if (seconds < 60) return `in about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  const m = Math.round(seconds / 60);
  return `in about ${m} minute${m === 1 ? "" : "s"}`;
}

/** Hostname of an origin, without "www.". */
export function domainOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin;
  }
}
