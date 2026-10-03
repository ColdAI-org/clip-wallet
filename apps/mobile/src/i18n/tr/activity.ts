import type en from "../en/activity";
export default {
  "m.activity.title": "Etkinlik",
  "m.activity.pending": "İşleniyor",
  "m.activity.failed": "Gerçekleşmedi — hiçbir şey alınmadı",
  "m.activity.empty": "Henüz etkinlik yok",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
