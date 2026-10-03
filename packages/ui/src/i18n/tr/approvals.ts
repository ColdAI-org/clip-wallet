import type en from "../en/approvals";
export default {
  "approvals.empty": "Sizi bekleyen bir şey yok",
  "approvals.position": "{n, plural, one {İstek 1/#} other {İstek 1/#}}",
} satisfies Record<keyof typeof en, string>;
