/**
 * Local test dapps for the e2e suite: two different origins (127.0.0.1 and localhost on two ports), plain HTML,
 * no wallet libraries: they use only the standards (EIP-6963 events, EIP-1193 request). Site A embeds site B in
 * an iframe so the suite can check that subframes get no providers and can't borrow the top frame's.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const page = (title: string, body = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:32px 40px;background:#f7f7f5;color:#141414}
h1{font-size:26px;margin:0 0 6px}p{color:#5e5c59;margin:0 0 20px}.card{background:#fff;border:1px solid #e7e5e2;border-radius:14px;padding:18px 20px;max-width:560px}
button{font:inherit;border:0;border-radius:10px;padding:10px 16px;background:#1f4fb3;color:#fff;font-weight:600;margin-right:8px}
code{font-size:13px;background:#f3f3f1;padding:2px 6px;border-radius:6px}iframe{width:100%;height:120px;border:1px dashed #ccc;border-radius:10px;margin-top:16px}</style>
</head><body><h1>${title}</h1><p>A test dapp served from this computer. It talks to wallets through EIP-6963.</p>
<div class="card"><button id="connect">Connect wallet</button><button id="sign">Sign a message</button>
<p id="status" style="margin:14px 0 0">Not connected.</p></div>${body}</body></html>`;

export interface Dapps {
  a: string;
  b: string;
  close(): Promise<void>;
}

function serve(handler: (path: string) => string): Promise<Server> {
  const s = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(handler(req.url ?? "/"));
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}

export async function startDapps(): Promise<Dapps> {
  let bUrl = "";
  const a = await serve((path) => (path.startsWith("/framed") ? page("Site A (with frame)", `<iframe id="frame" src="${bUrl}/frame"></iframe>`) : page("Test Dapp")));
  const b = await serve((path) => (path.startsWith("/frame") ? "<!doctype html><title>frame</title><body>frame</body>" : page("Site B")));
  const portA = (a.address() as AddressInfo).port;
  const portB = (b.address() as AddressInfo).port;
  // Two origins: 127.0.0.1:A and localhost:B (both plain http, allowed only for this computer).
  bUrl = `http://localhost:${portB}`;
  return {
    a: `http://127.0.0.1:${portA}`,
    b: bUrl,
    close: async () => {
      await Promise.all([a, b].map((s) => new Promise((r) => s.close(() => r(undefined)))));
    },
  };
}
