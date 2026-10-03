import type en from "../en/approvals";
export default {
  "approvals.empty": "没有等你处理的请求",
  "approvals.position": "第 1 个，共 {n, plural, other {# 个请求}}",
} satisfies Record<keyof typeof en, string>;
