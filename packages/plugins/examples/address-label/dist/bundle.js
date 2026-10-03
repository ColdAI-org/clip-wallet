// Address labels — example Clip Plugin (transaction insight only; no network, no notifications).
// Names a few well-known addresses when they show up in a request you're asked to approve.
const LABELS = {
  "0x0000000000000000000000000000000000000000": { name: "Zero address", warn: "Funds sent to the zero address are gone for good." },
  "0x000000000000000000000000000000000000dead": { name: "Burn address", warn: "Funds sent to the burn address are gone for good." },
  "1nc1nerator11111111111111111111111111111111": { name: "Solana incinerator", warn: "Tokens sent here are burned." },
};

function findAddresses(text) {
  const out = [];
  const evm = text.match(/0x[0-9a-fA-F]{40}/g) || [];
  for (const a of evm) out.push(a.toLowerCase());
  const words = text.split(/[^1-9A-HJ-NP-Za-km-z]+/);
  for (const w of words) if (w.length >= 32 && w.length <= 44) out.push(w);
  return out;
}

module.exports.onTransaction = async ({ request }) => {
  const seen = new Set();
  const lines = [];
  const warnings = [];
  const texts = [request.title, ...request.lines.map((l) => l.value), ...request.balanceChanges.map((b) => b.asset)];
  for (const t of texts) {
    for (const a of findAddresses(t)) {
      const hit = LABELS[a];
      if (!hit || seen.has(a)) continue;
      seen.add(a);
      lines.push({ label: "Address", value: hit.name });
      warnings.push({ level: "danger", message: hit.warn });
    }
  }
  return { lines: lines.slice(0, 5), warnings: warnings.slice(0, 3) };
};
