import type en from "../en/activity";
export default {
  "m.activity.title": "アクティビティ",
  "m.activity.pending": "処理中",
  "m.activity.failed": "完了しませんでした — 何も引き落とされていません",
  "m.activity.empty": "アクティビティはまだありません",
  "m.activity.legDetail": "{network} · {hash}",
} satisfies Record<keyof typeof en, string>;
