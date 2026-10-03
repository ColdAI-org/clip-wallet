import type en from "../en/approvals";
export default {
  "approvals.empty": "Nessuna richiesta in attesa",
  "approvals.position": "1 di {n, plural, one {# richiesta} other {# richieste}}",
} satisfies Record<keyof typeof en, string>;
