// With "network": ["https://api.example.com"] and "notifications": true in the manifest, the sandbox's `clip`
// object has fetch() and notify(). Nothing else exists: no window, no timers, no storage, no keys.
declare const clip: {
  fetch(url: string): Promise<{ ok: boolean; status: number; body: string }>; // GET only, no credentials, 256 KB
  notify(text: string): void; // at most 3 an hour and 10 a day, labelled "from <plugin>"
};

export async function onTransaction({ request }: { request: { networkId: string; account: string } }) {
  const res = await clip.fetch(`https://api.example.com/v1/labels?network=${encodeURIComponent(request.networkId)}`);
  if (!res.ok) return { lines: [], warnings: [] };
  const labels = JSON.parse(res.body) as Record<string, string>;
  const label = labels[request.account.toLowerCase()];
  if (label) clip.notify(`You're signing as ${label}.`);
  return { lines: label ? [{ label: "Your account", value: label }] : [], warnings: [] };
}
