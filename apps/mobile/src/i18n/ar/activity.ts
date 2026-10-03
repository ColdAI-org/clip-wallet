import type en from "../en/activity";
export default {
  "m.activity.title": "النشاط",
  "m.activity.pending": "قيد التنفيذ",
  "m.activity.failed": "لم تكتمل العملية — لم يُخصم شيء",
  "m.activity.empty": "لا نشاط بعد",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
