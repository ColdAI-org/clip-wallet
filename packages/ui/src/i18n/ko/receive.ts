import type en from "../en/receive";
export default {
  "receive.title": "받기",
  "receive.titleAsset": "{symbol} 받기",
  "receive.pick": "무엇을 받을까요?",
  "receive.assetsList": "받을 수 있는 자산",
  "receive.cantReceive": "이 지갑은 아직 그 자산을 받을 수 없어요.",
  "receive.senderNetwork": "보내는 사람의 네트워크",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "내 {symbol} 주소 QR 코드",
  "receive.copyAddress": "주소 복사",
  "receive.manyNetworks": "이 주소는 {networks}에서 {symbol}을(를) 받을 수 있어요. 보내는 사람에게 이 중 하나를 사용해 달라고 요청하세요.",
  "receive.oneNetwork": "보내는 사람에게 {network} 네트워크로 보내 달라고 요청하세요.",
} satisfies Record<keyof typeof en, string>;
