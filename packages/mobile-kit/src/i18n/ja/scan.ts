import type en from "../en/scan";
export default {
  "m.scan.title": "読み取って接続",
  "m.scan.allowCamera": "カメラを許可",
  "m.scan.cameraWhy": "カメラは接続コードの読み取りにのみ使用します。代わりに設定でコードを貼り付けることもできます。",
  "m.scan.found": "見つかりました。接続しています…",
  "m.scan.pairing": "ペアリングを開始しました。アプリから接続の確認が求められます。",
  "m.scan.pointOrTrade": "アプリのQRコードまたは取引リンクにカメラを向けてください。",
  "m.scan.notConnectOrTrade": "このQRコードは接続用のコードでも取引リンクでもありません。",
} satisfies Record<keyof typeof en, string>;
