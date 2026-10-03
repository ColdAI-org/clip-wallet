import type en from "../en/buy";
export default {
  "m.buy.title": "购买",
  "m.buy.off": "此版本未开启购买功能",
  "m.buy.offHint": "你仍然可以接收他人转来的加密资产。",
  "m.buy.what": "你想购买什么？",
  "m.buy.amountMissing": "请输入你想花费的 {currency} 金额。",
  "m.buy.buySymbol": "购买 {symbol}",
  "m.buy.howMuch": "金额（{currency}）",
  "m.buy.seeWays": "查看支付方式",
  "m.buy.continueWith": "继续使用 {provider}",
  "m.buy.finish": "你将在服务商的页面上完成购买。对方可能会要求验证你的身份。",
} satisfies Record<keyof typeof en, string>;
