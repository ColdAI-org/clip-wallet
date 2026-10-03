/**
 * Plugin manifest (`clip.plugin.json` at the root of the npm package).
 *
 *   {
 *     "manifestVersion": 1,
 *     "name": "Address labels",
 *     "version": "1.0.0",                       // must equal package.json "version"
 *     "author": "Clip Wallet examples",
 *     "description": "Names well-known addresses in approvals.",
 *     "permissions": {
 *       "transactionInsight": true,             // add notes/warnings to requests you approve
 *       "nameResolution": { "suffixes": [".label"] },
 *       "notifications": true,                  // rate-limited
 *       "network": ["https://api.example.com"]  // exact https origins; nothing else is reachable
 *     },
 *     "bundle": { "path": "dist/bundle.js", "sha256": "<64 hex>" }
 *   }
 *
 * There is no permission for signing, keys, the recovery phrase, storage or chrome.* APIs: they don't exist in
 * the plugin's world, so they can't be asked for.
 */
import { z } from "zod";

export const MANIFEST_FILE = "clip.plugin.json";
export const MAX_BUNDLE_BYTES = 1_000_000;
export const MAX_NETWORK_ORIGINS = 3;
export const MAX_SUFFIXES = 3;

/**
 * Suffixes a plugin may not claim: the built-in name services (packages/names: ENS .eth, SNS .sol, HNS .hbar)
 * and common web TLDs, so a plugin can't answer for "coinbase.com" or "alice.eth".
 */
export const RESERVED_SUFFIXES: ReadonlySet<string> = new Set([
  ".eth", ".sol", ".hbar", ".com", ".org", ".net", ".io", ".xyz", ".app", ".co", ".finance", ".exchange", ".wallet", ".crypto", ".dev", ".ai",
]);

/** Printable, no control or bidi-override characters (they can disguise text in the approval screen). */
const SAFE_TEXT = /^[^\p{Cc}\p{Cf}\u2028\u2029]*$/u;
const text = (max: number) => z.string().min(1).max(max).regex(SAFE_TEXT, "contains hidden characters");

const origin = z
  .string()
  .max(200)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === "https:" && u.origin === s && !u.username && !u.password && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(u.hostname);
    } catch {
      return false;
    }
  }, "must be an https origin like https://api.example.com");

const suffix = z
  .string()
  .regex(/^\.[a-z0-9-]{2,24}$/, "must look like .label")
  .refine((s) => !RESERVED_SUFFIXES.has(s), "is handled by the wallet itself");

export const PluginPermissionsSchema = z
  .object({
    transactionInsight: z.literal(true).optional(),
    nameResolution: z.object({ suffixes: z.array(suffix).min(1).max(MAX_SUFFIXES) }).strict().optional(),
    notifications: z.literal(true).optional(),
    network: z.array(origin).min(1).max(MAX_NETWORK_ORIGINS).optional(),
  })
  .strict()
  .refine((p) => p.transactionInsight || p.nameResolution || p.notifications, "asks for no capability");

export const PluginManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    name: text(40),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, "must be a semver version"),
    author: text(80),
    description: text(200),
    permissions: PluginPermissionsSchema,
    bundle: z
      .object({
        path: z
          .string()
          .max(200)
          .regex(/^[A-Za-z0-9._/-]+\.js$/, "must be a .js file inside the package")
          .refine((p) => !p.startsWith("/") && !p.split("/").some((s) => s === ".." || s === "." || s === ""), "must be a plain relative path"),
        sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters"),
      })
      .strict(),
  })
  .strict();

export type PluginPermissions = z.infer<typeof PluginPermissionsSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export class ManifestError extends Error {}

/** Parses and validates a manifest. Throws ManifestError with a short reason. */
export function parseManifest(raw: unknown): PluginManifest {
  const r = PluginManifestSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new ManifestError(`${first?.path.join(".") || "manifest"} ${first?.message ?? "is invalid"}`);
  }
  return r.data;
}

/** What a plugin may do, as data (the UI words it in the user's language; describePermissions is the English). */
export interface PluginCapabilities {
  transactionInsight: boolean;
  nameSuffixes?: string[];
  notifications: boolean;
  networkHosts?: string[];
}

export function capabilitiesOf(m: PluginManifest): PluginCapabilities {
  const p = m.permissions;
  return {
    transactionInsight: !!p.transactionInsight,
    ...(p.nameResolution ? { nameSuffixes: [...p.nameResolution.suffixes] } : {}),
    notifications: !!p.notifications,
    ...(p.network ? { networkHosts: p.network.map((o) => new URL(o).host) } : {}),
  };
}

/** Plain-words lines for the install prompt. The last line is always the "never" promise. */
export function describePermissions(m: PluginManifest): string[] {
  const p = m.permissions;
  const out: string[] = [];
  if (p.transactionInsight) out.push(`See the requests you're asked to approve and add notes to them. Notes are marked "from ${m.name}".`);
  if (p.nameResolution) out.push(`Look up names ending in ${p.nameResolution.suffixes.join(", ")} when you send. Results are marked "from ${m.name}".`);
  if (p.notifications) out.push("Show you notifications (a few an hour at most).");
  if (p.network) {
    const hosts = p.network.map((o) => new URL(o).host).join(", ");
    out.push(
      p.transactionInsight || p.nameResolution
        ? `Connect to ${hosts}. It could send what it sees there.`
        : `Connect to ${hosts}.`,
    );
  }
  out.push("It can never sign, move your funds, or see your recovery phrase or keys.");
  return out;
}
