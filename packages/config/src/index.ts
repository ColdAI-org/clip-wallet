/**
 * @clip-wallet/config — the schema for `clip.config.ts`.
 *
 *   import { defineConfig } from "@clip-wallet/config";
 *   export default defineConfig({ name: "My Wallet", rdns: "com.example.wallet", theme: { accent: "#4F46E5" } });
 *
 * Everything but `name` and `rdns` has a default. Testnet by default: mainnet needs an explicit checklist object.
 * Validation errors are plain sentences, one per problem, prefixed with the setting they are about.
 */
import { z } from "zod";

/** The exact sentence `mainnet.acknowledged` must contain. */
export const MAINNET_ACKNOWLEDGEMENT =
  "I have completed the mainnet checklist: the vault and CLPRouter contracts are audited, pnpm harness passes, and real funds are at risk.";

export const WALLETCONNECT_ENV = "CLIP_WALLETCONNECT_PROJECT_ID";

export const NETWORK_FAMILIES = ["evm", "hedera", "solana", "bitcoin"] as const;
export const ROUTE_MODES = ["balanced", "cheapest", "fastest", "reliable", "greenest"] as const;
export const TRUST_TIERS = ["attested", "committee", "light-client", "validity-proof"] as const;
export const HARDWARE = ["ledger", "keystone"] as const;

/** "evm:*", "evm:8453", "evm:base-sepolia", "hedera", "solana", "bitcoin". */
const NETWORK_PATTERN = /^(?:evm:(?:\*|[1-9]\d*|[a-z][a-z0-9-]*)|hedera|solana|bitcoin)$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RDNS = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

function env(name: string): string | undefined {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return v === "" ? undefined : v;
}

/** Relative luminance (WCAG 2). */
function luminance(hex: string): number {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const theme = z
  .object({
    accent: z.string().regex(HEX_COLOR, "use a hex colour like #4F46E5").default("#4F46E5"),
    accentText: z.string().regex(HEX_COLOR, "use a hex colour like #FFFFFF").default("#FFFFFF"),
    font: z.string().min(1, "name a font, e.g. Inter").max(64, "keep the font name under 64 characters").default("Inter"),
    radius: z
      .number("use a number of pixels, e.g. 12")
      .min(0, "the corner radius can't be negative")
      .max(32, "keep the corner radius at 32 pixels or less")
      .default(12),
  })
  .strict()
  .refine((t) => !HEX_COLOR.test(t.accent) || !HEX_COLOR.test(t.accentText) || contrastRatio(t.accent, t.accentText) >= 3, {
    message: "the accent and its text colour are too close; pick colours with a contrast ratio of at least 3:1 so buttons stay readable",
  });

const routeFilters = z
  .object({
    iso20022: z.boolean().optional(),
    mica: z.boolean().optional(),
    energy: z.union([z.boolean(), z.object({ capKgPerTx: z.number().positive("the energy cap must be above zero").optional() }).strict()]).optional(),
    trustFloor: z.enum(TRUST_TIERS, `use one of: ${TRUST_TIERS.join(", ")}`).optional(),
    maxHops: z.number().int("use a whole number of hops").min(1, "allow at least one hop").max(6, "allow at most 6 hops").optional(),
    deadlineS: z.number().int().positive("the deadline must be a positive number of seconds").optional(),
    excludedJurisdictions: z.array(z.string().regex(/^[A-Z]{2}$/, "use two-letter country codes like DE")).optional(),
  })
  .strict();

const mainnetChecklist = z
  .object({
    enabled: z.literal(true, "set enabled: true (or use mainnet: false)"),
    acknowledged: z.literal(
      MAINNET_ACKNOWLEDGEMENT,
      "copy MAINNET_ACKNOWLEDGEMENT from @clip-wallet/config word for word after completing the checklist",
    ),
  })
  .strict();

export type MainnetSetting = false | z.output<typeof mainnetChecklist>;

/** `false` (default) or the checklist object. Checked by hand so the checklist's own errors reach the user. */
const mainnet = z.unknown().optional().transform((v, ctx): MainnetSetting => {
  if (v === undefined || v === false) return false;
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const r = mainnetChecklist.safeParse(v);
    if (r.success) return r.data;
    for (const i of r.error.issues) {
      ctx.addIssue({ code: "custom", message: describeIssue(i).replace(/^[^:]*: /, ""), path: i.path, input: v });
    }
    return z.NEVER;
  }
  ctx.addIssue({
    code: "custom",
    input: v,
    message:
      "Clip Wallet runs on test networks unless you opt in: use mainnet: false, or mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }",
  });
  return z.NEVER;
});

export const clipConfigSchema = z
  .object({
    name: z.string("give your wallet a name").trim().min(1, "give your wallet a name").max(40, "keep the name to 40 characters or fewer"),
    icon: z
      .string()
      .regex(/^(?:\.{0,2}\/[\w./-]+\.(?:png|svg)|https:\/\/\S+|data:image\/(?:png|svg\+xml);base64,\S+)$/, "use a .png or .svg path (like ./icon.svg), an https URL or a data:image URL")
      .default("./icon.svg"),
    rdns: z.string("set rdns to a reverse domain you own, like com.example.wallet").regex(RDNS, "use a reverse domain you own, like com.example.wallet (lowercase)"),
    theme: theme.default({ accent: "#4F46E5", accentText: "#FFFFFF", font: "Inter", radius: 12 }),
    networks: z
      .array(z.string().regex(NETWORK_PATTERN, 'use "evm:*", "evm:<chain id>", "hedera", "solana" or "bitcoin"'))
      .min(1, "turn on at least one network")
      .refine((n) => new Set(n).size === n.length, "each network is listed once")
      .default(["evm:*", "hedera", "solana", "bitcoin"]),
    route: z
      .object({
        mode: z.enum(ROUTE_MODES, `use one of: ${ROUTE_MODES.join(", ")}`).default("balanced"),
        filters: routeFilters.default({}),
      })
      .strict()
      .default({ mode: "balanced", filters: {} }),
    compatibilityMode: z.boolean("use true or false").default(false),
    hardware: z
      .array(z.enum(HARDWARE, `use "ledger" or "keystone"`))
      .refine((h) => new Set(h).size === h.length, "each device is listed once")
      .default(["ledger", "keystone"]),
    walletConnect: z
      .object({
        projectId: z
          .string()
          .regex(/^[0-9a-f]{32}$/, `use the 32-character project id from WalletConnect Cloud, set through the ${WALLETCONNECT_ENV} environment variable`)
          .optional(),
      })
      .strict()
      .default({}),
    passkeys: z
      .object({
        enabled: z.boolean("use true or false").default(true),
        rpOrigin: z
          .string()
          .regex(/^(?:https:\/\/[a-z0-9.-]+(?::\d+)?|chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f-]{36})$/, "use the origin passkeys are bound to, like https://wallet.example.com or chrome-extension://<extension id>")
          .optional(),
      })
      .strict()
      .default({ enabled: true }),
    mainnet,
  })
  .strict();

export type ClipConfigInput = Omit<z.input<typeof clipConfigSchema>, "mainnet"> & {
  /** false (default), or the checklist object: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }. */
  mainnet?: false | { enabled: true; acknowledged: string };
};
export type ClipConfig = z.output<typeof clipConfigSchema>;
export type NetworkPattern = string;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`clip.config.ts has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join(".");
  let msg = issue.message;
  if (issue.code === "unrecognized_keys") {
    msg = `${issue.keys.join(", ")} ${issue.keys.length === 1 ? "isn't a setting" : "aren't settings"} Clip Wallet knows; check the spelling`;
  } else if (issue.code === "invalid_type" && /^Invalid input/.test(msg)) {
    msg = issue.input === undefined ? "this setting is required" : `expected ${issue.expected}`;
  }
  return path ? `${path}: ${msg}` : msg;
}

/** Validate without throwing. */
export function validateConfig(input: unknown): { ok: true; config: ClipConfig } | { ok: false; problems: string[] } {
  const r = clipConfigSchema.safeParse(input);
  if (r.success) return { ok: true, config: r.data };
  return { ok: false, problems: r.error.issues.map(describeIssue) };
}

/**
 * Validate a clip.config.ts object and fill in defaults. Throws ConfigError listing every problem in plain words.
 * `walletConnect.projectId` falls back to the CLIP_WALLETCONNECT_PROJECT_ID environment variable.
 */
export function defineConfig(input: ClipConfigInput): ClipConfig {
  const withEnv =
    input && typeof input === "object" && !(input.walletConnect && "projectId" in input.walletConnect)
      ? { ...input, walletConnect: { ...input.walletConnect, ...(env(WALLETCONNECT_ENV) ? { projectId: env(WALLETCONNECT_ENV) } : {}) } }
      : input;
  const r = validateConfig(withEnv);
  if (!r.ok) throw new ConfigError(r.problems);
  return r.config;
}

export const defaults: Omit<ClipConfig, "name" | "rdns"> = (() => {
  const r = clipConfigSchema.parse({ name: "x", rdns: "x.x" });
  const { name: _n, rdns: _r, ...rest } = r;
  return rest;
})();

/** Families the config turns on, in a stable order. */
export function enabledFamilies(config: Pick<ClipConfig, "networks">): (typeof NETWORK_FAMILIES)[number][] {
  return NETWORK_FAMILIES.filter((f) => config.networks.some((n) => n === f || n.startsWith(`${f}:`)));
}

/** Does a network pattern list include this EVM chain id? */
export function includesEvmChain(config: Pick<ClipConfig, "networks">, chainId: number): boolean {
  return config.networks.some((n) => n === "evm:*" || n === `evm:${chainId}`);
}

export function isMainnetEnabled(config: Pick<ClipConfig, "mainnet">): boolean {
  return config.mainnet !== false && config.mainnet.enabled === true;
}
