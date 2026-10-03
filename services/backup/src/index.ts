import { createApp, type Env } from "./app.js";

export { createApp, type AppDeps, type Env } from "./app.js";
export { MemoryEmailSender, UnconfiguredEmailSender, signInEmail, type EmailMessage, type EmailSender } from "./email.js";

/**
 * Deployed entry point. No email provider is wired, so /v1/auth/start answers 503 until an operator
 * replaces `createApp()` with `createApp({ email: <their sender> })`.
 */
const app = createApp();

export default {
  fetch: (req: Request, env: Env) => app.fetch(req, env),
  scheduled: async (_c: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(app.cleanup(env));
  },
} satisfies ExportedHandler<Env>;
