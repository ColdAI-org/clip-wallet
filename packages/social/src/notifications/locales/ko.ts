/** Notification text (Korean). */
import type { Translation } from "@clip-wallet/i18n";
import type en from "./en.js";

const messages: Translation<typeof en> = {
  "incoming.title": "자금을 받았어요",
  "incoming.body": "{amount} {symbol}을(를) 받았어요.",
  "incoming.many": "{count, plural, other {자산 #개}}를 받았어요. 지갑을 열어 확인하세요.",
  "nft.title": "새 수집품",
  "nft.body": "{name}이(가) 지갑에 도착했어요.",
  "nft.many": "{count, plural, other {새 수집품 #개}}가 지갑에 도착했어요.",
  "confirmed.title": "완료",
  "failed.title": "처리되지 않았어요",
  "failed.body": "{what}이(가) 처리되지 않았어요. 자세한 내용은 활동에서 확인하세요.",
  "approval.title": "{app}에서 승인을 기다리고 있어요",
  "price.above": "{symbol} 가격이 {price}을(를) 넘었어요",
  "price.below": "{symbol} 가격이 {price} 아래로 내려갔어요",
  "price.now": "현재 {symbol} 가격: {price}.",
  "test.title": "알림이 켜졌어요",
  "test.body": "지갑 알림은 이렇게 표시돼요.",
};
export default messages;
