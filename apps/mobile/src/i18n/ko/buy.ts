import type en from "../en/buy";
export default {
  "m.buy.title": "구매",
  "m.buy.off": "이 빌드에서는 구매 기능이 꺼져 있어요",
  "m.buy.offHint": "다른 사람에게서 암호화폐를 받는 것은 계속 가능해요.",
  "m.buy.what": "무엇을 구매할까요?",
  "m.buy.amountMissing": "사용할 금액을 {currency} 단위로 입력하세요.",
  "m.buy.buySymbol": "{symbol} 구매",
  "m.buy.howMuch": "금액({currency})",
  "m.buy.seeWays": "결제 방법 보기",
  "m.buy.continueWith": "{provider}에서 계속",
  "m.buy.finish": "구매는 제공업체 페이지에서 마무리해요. 제공업체에서 본인 확인을 요청할 수 있어요.",
} satisfies Record<keyof typeof en, string>;
