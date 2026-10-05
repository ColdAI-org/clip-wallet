/**
 * Korean mobile catalog. Glossary (shared with the UI catalog in packages/ui/src/i18n/ko):
 *   wallet → 지갑, recovery phrase → 복구 문구, password → 비밀번호, passkey → 패스키, account → 계정,
 *   address → 주소, asset → 자산, token → 토큰, coin → 코인, collectible → 수집품, collection → 컬렉션,
 *   balance → 잔액, network → 네트워크, fee → 수수료, network fee → 네트워크 수수료, amount (field) → 수량,
 *   send → 보내기, receive → 받기, swap → 스왑, buy → 구매, stake → 스테이킹, unstake → 스테이킹 해제,
 *   rewards → 보상, approve → 승인, reject → 거절, connect → 연결, disconnect → 연결 해제, sign → 서명,
 *   request → 요청, backup → 백업, restore → 복원, lock / unlock → 잠금 / 잠금 해제,
 *   hardware wallet → 하드웨어 지갑, contacts → 연락처, handle → 핸들 (Clip handle → Clip 핸들),
 *   publish → 공개, notifications → 알림, price alert → 가격 알림, activity → 활동, settings → 설정,
 *   explore → 탐색, discover → 둘러보기, trade → 거래 (feature name "Secure Trade" kept), liquidity → 유동성,
 *   pool → 풀, slippage → 허용 가격 변동폭, price impact → 가격 영향, bridged → 브리지됨,
 *   look-alike address → 비슷하게 생긴 주소, scammer → 사기범, Advanced mode → 고급 모드,
 *   connected apps → 연결된 앱, suspicious token → 의심스러운 토큰, didn't go through → 처리되지 않았어요,
 *   unreadable request → 읽을 수 없는 요청.
 * Style: 해요체 for sentences, short nouns for buttons; 을(를)/이(가)/은(는) after variables.
 */
import type { Translation } from "@clip-wallet/i18n";
import type { MobileMessages } from "../en";
import common from "./common";
import onboarding from "./onboarding";
import home from "./home";
import collectibles from "./collectibles";
import activity from "./activity";
import receive from "./receive";
import scan from "./scan";
import browser from "./browser";
import kit from "./kit";
import app from "./app";
import send from "./send";
import approval from "./approval";
import settings from "./settings";
import explore from "./explore";
import social from "./social";
import accounts from "./accounts";
import backup from "./backup";
import buy from "./buy";
import hardware from "./hardware";
import stake from "./stake";
import swap from "./swap";
import trade from "./trade";

const messages: Translation<MobileMessages> = {
  ...common,
  ...onboarding,
  ...home,
  ...collectibles,
  ...activity,
  ...receive,
  ...scan,
  ...browser,
  ...kit,
  ...app,
  ...send,
  ...approval,
  ...settings,
  ...explore,
  ...social,
  ...accounts,
  ...backup,
  ...buy,
  ...hardware,
  ...stake,
  ...swap,
  ...trade,
};
export default messages;
