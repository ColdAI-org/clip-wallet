import type en from "../en/activity";
export default {
  "m.activity.title": "Atividade",
  "m.activity.pending": "Em andamento",
  "m.activity.failed": "Não foi concluída — nada foi debitado",
  "m.activity.empty": "Nenhuma atividade ainda",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
