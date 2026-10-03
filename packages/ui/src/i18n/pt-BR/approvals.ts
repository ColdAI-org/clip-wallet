import type en from "../en/approvals";
export default {
  "approvals.empty": "Nada aguardando você",
  "approvals.position": "1 de {n, plural, one {# solicitação} other {# solicitações}}",
} satisfies Record<keyof typeof en, string>;
