import type en from "../en/activity";
export default {
  "m.activity.title": "Activité",
  "m.activity.pending": "En cours",
  "m.activity.failed": "Échec — rien n'a été prélevé",
  "m.activity.empty": "Aucune activité pour l'instant",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
