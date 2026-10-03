import type en from "../en/buy";
export default {
  "buy.title": "购买",
  "buy.titleAsset": "购买 {symbol}",
  "buy.off.title": "此版本未开启购买功能",
  "buy.off.body": "你仍然可以接收他人转来的加密资产。",
  "buy.what": "你想购买什么？",
  "buy.whatLabel": "可购买的资产",
  "buy.howMuch": "金额（{currency}）",
  "buy.amountBad": "请输入你想花费的 {currency} 金额。",
  "buy.seeWays": "查看支付方式",
  "buy.continueWith": "继续使用 {provider}",
  "buy.finishOnProvider": "你需要在服务商的网站上完成购买。对方可能会要求验证你的身份。",
} satisfies Record<keyof typeof en, string>;
