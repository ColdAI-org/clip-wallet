// Serves scripts/test-dapp on http://localhost:8787 (the iOS Simulator reaches the Mac's localhost).
// Open it in the app's Browse tab. Plain http is allowed only for local hosts (bridge.ts, ATS NSAllowsLocalNetworking).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(fileURLToPath(new URL("./test-dapp/index.html", import.meta.url)));
const port = Number(process.env.PORT ?? 8787);
createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(page);
}).listen(port, "127.0.0.1", () => console.log(`test dapp: http://localhost:${port}`));
