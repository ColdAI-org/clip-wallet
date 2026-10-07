import type en from "../en/activity";
export default {
  "m.activity.title": "Attività",
  "m.activity.pending": "In corso",
  "m.activity.failed": "Non è andata a buon fine: non è stato prelevato nulla",
  "m.activity.empty": "Ancora nessuna attività",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
