import type en from "../en/approvals";
export default {
  "approvals.empty": "Nichts wartet auf dich",
  "approvals.position": "1 von {n, plural, one {# Anfrage} other {# Anfragen}}",
} satisfies Record<keyof typeof en, string>;
