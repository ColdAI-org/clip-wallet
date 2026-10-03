import { createProxy, type Env } from "./proxy.js";

export { createProxy, upstreamUrl, type Env, type ProxyDeps } from "./proxy.js";

const proxy = createProxy();

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => proxy.fetch(req, env, ctx),
} satisfies ExportedHandler<Env>;
