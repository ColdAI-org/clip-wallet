import type en from "../en/activity";
export default {
  "activity.title": "Aktivität",
  "activity.list": "Aktivität",
  "activity.inProgress": "Läuft",
  "activity.failed": "Nicht durchgegangen – es wurde nichts abgebucht",
  "activity.empty": "Noch keine Aktivität",
} satisfies Record<keyof typeof en, string>;
