import type en from "../en/activity";
export default {
  "m.activity.title": "활동",
  "m.activity.pending": "진행 중",
  "m.activity.failed": "처리되지 않았어요 — 빠져나간 자산은 없어요",
  "m.activity.empty": "아직 활동이 없어요",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
