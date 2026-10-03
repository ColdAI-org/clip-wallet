import { createApp, type Env } from "./app.js";
import { ResendEmailSender } from "./email.js";

export { createApp, type AppDeps, type Env } from "./app.js";
export { MemoryEmailSender, ResendEmailSender, UnconfiguredEmailSender, signInEmail, type EmailMessage, type EmailSender } from "./email.js";

/**
 * Deployed entry point. Without RESEND_API_KEY (secret) and EMAIL_FROM (var) no email provider is wired, so
 * /v1/auth/start answers 503 and stores nothing. With both set, sign-in links go out through Resend.
 */
const unconfigured = createApp();
let live: { key: string; from: string; app: ReturnType<typeof createApp> } | undefined;

function appFor(env: Env): ReturnType<typeof createApp> {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM?.trim();
  if (!key || !from) return unconfigured;
  if (!live || live.key !== key || live.from !== from) live = { key, from, app: createApp({ email: new ResendEmailSender(key, from) }) };
  return live.app;
}

export default {
  fetch: (req: Request, env: Env) => appFor(env).fetch(req, env),
  scheduled: async (_c: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(unconfigured.cleanup(env));
  },
} satisfies ExportedHandler<Env>;
