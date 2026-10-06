// dist/bundle.js: a plain script. The sandbox gives it `module`, `exports` and a `clip` object, nothing else.
const BURN = "0x000000000000000000000000000000000000dead";

module.exports.onTransaction = async ({ request }) => {
  const texts = [request.title, ...request.lines.map((l) => l.value)].join(" ").toLowerCase();
  if (!texts.includes(BURN)) return { lines: [], warnings: [] };
  return {
    lines: [{ label: "Address", value: "Burn address" }],
    warnings: [{ level: "danger", message: "Funds sent to the burn address are gone for good." }],
  };
};
