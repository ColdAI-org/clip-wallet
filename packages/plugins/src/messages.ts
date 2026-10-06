/**
 * The only channel between the wallet and a plugin: structured-clone messages over postMessage to the
 * sandboxed iframe. Both sides validate every message with these schemas (strict: unknown keys are rejected),
 * and anything that fails is dropped. Nothing else crosses: no functions, no ports, no chrome.* handles.
 */
import { z } from "zod";
import { MAX_BUNDLE_BYTES } from "./manifest.js";

export const LIMITS = {
  maxMessageBytes: 256_000,
  maxInsightLines: 5,
  maxInsightWarnings: 3,
  maxLabel: 40,
  maxValue: 200,
  maxNotification: 140,
  maxAddress: 128,
  maxFetchBody: 256_000,
  /**
   * Audit PLG-02: a "load" carries the whole bundle (up to MAX_BUNDLE_BYTES) and a "fetch-result" a whole body (up to
   * maxFetchBody); their schemas bound those strings, and JSON escaping can make a string up to 6× longer
   * (\u00XX), so these two messages get room for that instead of maxMessageBytes.
   */
  maxLoadMessageBytes: 6 * MAX_BUNDLE_BYTES + 16_384,
  maxFetchResultMessageBytes: 6 * 256_000 + 16_384,
} as const;

const SAFE_TEXT = /^[^\p{Cc}\p{Cf}\u2028\u2029]*$/u;
const safe = (max: number) => z.string().min(1).max(max).regex(SAFE_TEXT);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/* ------------------------------------------------------------------ plugin outputs */

export const InsightOutputSchema = z
  .object({
    lines: z.array(z.object({ label: safe(LIMITS.maxLabel), value: safe(LIMITS.maxValue) }).strict()).max(LIMITS.maxInsightLines).optional(),
    warnings: z
      .array(z.object({ level: z.enum(["info", "caution", "danger"]), message: safe(LIMITS.maxValue) }).strict())
      .max(LIMITS.maxInsightWarnings)
      .optional(),
  })
  .strict();
export type InsightOutput = z.infer<typeof InsightOutputSchema>;

export const NameOutputSchema = z
  .object({
    address: z.string().min(1).max(LIMITS.maxAddress).regex(/^[A-Za-z0-9.:_-]+$/),
    family: z.string().regex(/^[a-z0-9]{2,16}$/),
  })
  .strict()
  .nullable();
export type NameOutput = z.infer<typeof NameOutputSchema>;

/* ------------------------------------------------------------------ plugin inputs */

/** What a transaction-insight plugin is shown: the decoded request, never the raw payload or any secret. */
export const InsightInputSchema = z
  .object({
    origin: z.string().max(300),
    title: z.string().max(300),
    lines: z.array(z.object({ label: z.string().max(200), value: z.string().max(2000) }).strict()).max(50),
    balanceChanges: z.array(z.object({ asset: z.string().max(200), delta: z.string().max(80) }).strict()).max(50),
    networkId: z.string().max(100),
    account: z.string().max(LIMITS.maxAddress),
  })
  .strict();
export type InsightInput = z.infer<typeof InsightInputSchema>;

export const NameInputSchema = z.object({ name: z.string().min(3).max(253) }).strict();
export type NameInput = z.infer<typeof NameInputSchema>;

export const GrantSchema = z
  .object({
    transactionInsight: z.boolean(),
    nameResolution: z.boolean(),
    notifications: z.boolean(),
    network: z.boolean(),
  })
  .strict();
export type Grant = z.infer<typeof GrantSchema>;

/* ------------------------------------------------------------------ host → sandbox */

export const HostToSandboxSchema = z.union([
  z.object({ type: z.literal("load"), pluginId: id, source: z.string().max(MAX_BUNDLE_BYTES), grant: GrantSchema }).strict(),
  z.object({ type: z.literal("invoke"), id, handler: z.literal("onTransaction"), params: InsightInputSchema }).strict(),
  z.object({ type: z.literal("invoke"), id, handler: z.literal("onNameLookup"), params: NameInputSchema }).strict(),
  z
    .object({
      type: z.literal("fetch-result"),
      id,
      ok: z.boolean(),
      status: z.number().int().min(0).max(599),
      body: z.string().max(LIMITS.maxFetchBody),
    })
    .strict(),
]);
export type HostToSandbox = z.infer<typeof HostToSandboxSchema>;

/* ------------------------------------------------------------------ sandbox → host */

export const HandlerName = z.enum(["onTransaction", "onNameLookup"]);

export const SandboxToHostSchema = z.union([
  z.object({ type: z.literal("booted") }).strict(),
  z.object({ type: z.literal("ready"), handlers: z.array(HandlerName).max(2) }).strict(),
  z.object({ type: z.literal("load-failed"), reason: z.string().max(200) }).strict(),
  z.object({ type: z.literal("result"), id, ok: z.literal(true), value: z.unknown() }).strict(),
  z.object({ type: z.literal("result"), id, ok: z.literal(false), error: z.string().max(200) }).strict(),
  z.object({ type: z.literal("notify"), text: safe(LIMITS.maxNotification) }).strict(),
  z.object({ type: z.literal("fetch"), id, url: z.string().max(2000) }).strict(),
]);
export type SandboxToHost = z.infer<typeof SandboxToHostSchema>;

function sizeOk(raw: unknown): boolean {
  const type = raw && typeof raw === "object" ? (raw as { type?: unknown }).type : undefined;
  const max = type === "load" ? LIMITS.maxLoadMessageBytes : type === "fetch-result" ? LIMITS.maxFetchResultMessageBytes : LIMITS.maxMessageBytes;
  try {
    return JSON.stringify(raw).length <= max;
  } catch {
    return false;
  }
}

/** Validates a message from the sandbox. Returns null for anything malformed, oversized or unknown. */
export function parseFromSandbox(raw: unknown): SandboxToHost | null {
  if (!sizeOk(raw)) return null;
  const r = SandboxToHostSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Validates a message from the host (used inside the sandbox). */
export function parseFromHost(raw: unknown): HostToSandbox | null {
  if (!sizeOk(raw)) return null;
  const r = HostToSandboxSchema.safeParse(raw);
  return r.success ? r.data : null;
}
