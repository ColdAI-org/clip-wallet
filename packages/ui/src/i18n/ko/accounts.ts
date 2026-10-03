import type en from "../en/accounts";
export default {
  "accounts.title": "계정",
  "accounts.titleFor": "{host}에서 사용하는 계정",
  "accounts.chooseFor": "{host}에 보여 줄 계정을 선택하세요. 다른 앱은 각자의 선택을 유지해요.",
  "accounts.nameFor": "{account} 이름",
  "accounts.inUse": "사용 중",
  "accounts.rename": "이름 변경",
  "accounts.renameAccount": "{account} 이름 변경",
  "accounts.use": "사용",
  "accounts.useAccount": "{account} 사용",
  "accounts.adding": "추가 중…",
  "accounts.add": "계정 추가",
  "accounts.useDefault": "여기서 기본 계정 사용",
  "accounts.family.evm": "Ethereum 계열(ETH, USDC, Base, Arbitrum…)",
} satisfies Record<keyof typeof en, string>;
