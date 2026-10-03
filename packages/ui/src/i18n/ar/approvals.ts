import type en from "../en/approvals";
export default {
  "approvals.empty": "لا شيء بانتظارك",
  "approvals.position": "1 من {n, plural, zero {# طلب} one {طلب واحد} two {طلبين} few {# طلبات} many {# طلبًا} other {# طلب}}",
} satisfies Record<keyof typeof en, string>;
