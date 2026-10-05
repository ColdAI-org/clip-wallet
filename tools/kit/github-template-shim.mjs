// Preloaded into create-scaffold-hbar by scaffold-hbar-e2e.mjs (NODE_OPTIONS=--import). The CLI reads a community
// template's capabilities from GitHub (api.github.com/repos/<owner>/<repo>/contents/template.json) before copying it.
// ColdAI-org/scaffold-hbar-clip-wallet isn't published yet, so this answers that one request with the local
// template.json, exactly as the GitHub contents API would (base64 content). Every other request goes to the network.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR;
const repo = process.env.CLIP_TEMPLATE_REPO ?? "ColdAI-org/scaffold-hbar-clip-wallet";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (dir && url.startsWith(`https://api.github.com/repos/${repo.split("/").map(encodeURIComponent).join("/")}/contents/template.json`)) {
    const content = readFileSync(join(dir, "template.json")).toString("base64");
    return new Response(JSON.stringify({ name: "template.json", encoding: "base64", content }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};
