import type en from "../en/activity";
export default {
  "m.activity.title": "النشاط",
  "m.activity.pending": "قيد التنفيذ",
  "m.activity.failed": "لم تكتمل العملية — لم يُخصم شيء",
  "m.activity.empty": "لا نشاط بعد",
  "m.activity.legDetail": "\u2068{network}\u2069 · \u2068{hash}\u2069",
} satisfies Record<keyof typeof en, string>;
