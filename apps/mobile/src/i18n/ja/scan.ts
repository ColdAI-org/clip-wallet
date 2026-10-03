import type en from "../en/scan";
export default {
  "m.scan.title": "読み取って接続",
  "m.scan.allowCamera": "カメラを許可",
  "m.scan.cameraWhy": "カメラは接続コードの読み取りにのみ使用します。代わりに設定でコードを貼り付けることもできます。",
  "m.scan.point": "アプリのQRコードにカメラを向けてください。",
  "m.scan.notWalletConnect": "そのQRコードは{wc}のコードではありません。",
  "m.scan.found": "見つかりました。接続しています…",
  "m.scan.pairing": "ペアリングを開始しました。アプリから接続の確認が求められます。",
} satisfies Record<keyof typeof en, string>;
