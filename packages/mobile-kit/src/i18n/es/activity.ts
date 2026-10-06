import type en from "../en/activity";
export default {
  "m.activity.title": "Actividad",
  "m.activity.pending": "En curso",
  "m.activity.failed": "No se completó: no se descontó nada",
  "m.activity.empty": "Aún no hay actividad",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
