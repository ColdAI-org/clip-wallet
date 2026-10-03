import type en from "../en/approvals";
export default {
  "approvals.empty": "No hay nada pendiente",
  "approvals.position": "1 de {n, plural, one {# solicitud} other {# solicitudes}}",
} satisfies Record<keyof typeof en, string>;
