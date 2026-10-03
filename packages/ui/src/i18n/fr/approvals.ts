import type en from "../en/approvals";
export default {
  "approvals.empty": "Rien ne vous attend",
  "approvals.position": "1 sur {n, plural, one {# demande} other {# demandes}}",
} satisfies Record<keyof typeof en, string>;
