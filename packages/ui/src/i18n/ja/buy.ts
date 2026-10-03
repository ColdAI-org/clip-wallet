import type en from "../en/buy";
export default {
  "buy.title": "購入",
  "buy.titleAsset": "{symbol}を購入",
  "buy.off.title": "このビルドでは購入機能が有効になっていません",
  "buy.off.body": "ほかの人から暗号資産を受け取ることはできます。",
  "buy.what": "何を購入しますか？",
  "buy.whatLabel": "購入できる資産",
  "buy.howMuch": "金額（{currency}）",
  "buy.amountBad": "使いたい金額を{currency}で入力してください。",
  "buy.seeWays": "支払い方法を見る",
  "buy.continueWith": "{provider}で続ける",
  "buy.finishOnProvider": "購入は事業者のサイトで完了します。本人確認を求められる場合があります。",
} satisfies Record<keyof typeof en, string>;
