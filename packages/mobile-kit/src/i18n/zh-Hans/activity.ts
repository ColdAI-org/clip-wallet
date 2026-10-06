import type en from "../en/activity";
export default {
  "m.activity.title": "活动",
  "m.activity.pending": "进行中",
  "m.activity.failed": "未成功，未扣除任何资产",
  "m.activity.empty": "还没有活动",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
