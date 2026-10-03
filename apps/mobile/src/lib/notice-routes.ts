/** Where a tapped notification goes. Pure (vitest: test/notice-routes.vitest.ts). */
export type NoticeTarget = { kind: "approval"; id: string } | { kind: "asset"; key: string } | { kind: "activity" } | { kind: "collectibles" } | { kind: "home" };

/** A notice's route ("/approval/<id>", "/asset/<key>", "/activity", "/collectibles") → where to go. Unknown → home. */
export function noticeTarget(route: string): NoticeTarget {
  const [, head, rest] = /^\/([^/?#]+)(?:\/([^?#]+))?/.exec(route) ?? [];
  const arg = rest ? safeDecode(rest) : "";
  if (head === "approval" && arg) return { kind: "approval", id: arg };
  if (head === "asset" && arg) return { kind: "asset", key: arg };
  if (head === "activity") return { kind: "activity" };
  if (head === "collectibles" || head === "collectible") return { kind: "collectibles" };
  return { kind: "home" };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
