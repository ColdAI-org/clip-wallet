import type en from "../en/activity";
export default {
  "activity.title": "Activité",
  "activity.list": "Activité",
  "activity.inProgress": "En cours",
  "activity.failed": "Échec — rien n'a été prélevé",
  "activity.empty": "Aucune activité pour l'instant",
} satisfies Record<keyof typeof en, string>;
