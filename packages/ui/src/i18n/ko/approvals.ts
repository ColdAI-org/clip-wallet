import type en from "../en/approvals";
export default {
  "approvals.empty": "기다리는 요청이 없어요",
  "approvals.position": "{n, plural, other {요청 #개}} 중 1번째",
} satisfies Record<keyof typeof en, string>;
