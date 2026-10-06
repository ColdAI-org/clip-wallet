import type en from "../en/scan";
export default {
  "m.scan.title": "스캔해서 연결",
  "m.scan.allowCamera": "카메라 허용",
  "m.scan.cameraWhy": "카메라는 연결 코드를 읽는 데만 사용돼요. 대신 설정에서 코드를 붙여넣을 수도 있어요.",
  "m.scan.found": "찾았어요. 연결 중…",
  "m.scan.pairing": "페어링을 시작했어요. 앱에서 연결 요청이 표시될 거예요.",
  "m.scan.pointOrTrade": "카메라를 앱의 QR 코드나 거래 링크에 맞추세요.",
  "m.scan.notConnectOrTrade": "연결 코드나 거래 링크가 아닌 QR 코드예요.",
} satisfies Record<keyof typeof en, string>;
