import type en from "../en/kit";
export default {
  "m.kit.loading": "読み込み中",
  "m.kit.ur.wrong": "別のQRコードです。この手順で Keystone に表示されているコードを読み取ってください。",
  "m.kit.ur.allowCamera": "カメラを許可",
  "m.kit.ur.preview": "カメラのプレビュー",
  "m.kit.ur.hold": "コードをカメラの前で動かさないでください。",
  "m.kit.ur.cameraWhy": "カメラは Keystone のQRコードを読み取るためだけに使います。",
  "m.kit.ur.reading": "読み取り中… {percent}",
} satisfies Record<keyof typeof en, string>;
