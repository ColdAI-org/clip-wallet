import type en from "../en/receive";
export default {
  "m.receive.pick": "무엇을 받을까요?",
  "m.receive.titleAsset": "{symbol} 받기",
  "m.receive.unsupported": "이 지갑은 아직 그 자산을 받을 수 없어요.",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "내 {symbol} 주소 QR 코드",
  "m.receive.copyAddress": "주소 복사",
  "m.receive.manyNetworks": "이 주소는 {networks}에서 {symbol}을(를) 받을 수 있어요. 보내는 사람에게 이 중 하나를 사용해 달라고 요청하세요.",
  "m.receive.oneNetwork": "보내는 사람에게 {network} 네트워크로 보내 달라고 요청하세요.",
} satisfies Record<keyof typeof en, string>;
