import type en from "../en/activity";
export default {
  "m.activity.title": "Aktivität",
  "m.activity.pending": "Läuft",
  "m.activity.failed": "Nicht durchgegangen – es wurde nichts abgebucht",
  "m.activity.empty": "Noch keine Aktivität",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
