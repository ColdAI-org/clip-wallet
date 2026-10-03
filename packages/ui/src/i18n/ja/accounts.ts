import type en from "../en/accounts";
export default {
  "accounts.title": "アカウント",
  "accounts.titleFor": "{host}のアカウント",
  "accounts.chooseFor": "{host}に見せるアカウントを選んでください。ほかのアプリはそれぞれの選択を保持します。",
  "accounts.nameFor": "{account}の名前",
  "accounts.inUse": "使用中",
  "accounts.rename": "名前を変更",
  "accounts.renameAccount": "{account}の名前を変更",
  "accounts.use": "使用",
  "accounts.useAccount": "{account}を使用",
  "accounts.adding": "追加中…",
  "accounts.add": "アカウントを追加",
  "accounts.useDefault": "ここではデフォルトのアカウントを使う",
  "accounts.family.evm": "Ethereum系（ETH、USDC、Base、Arbitrum…）",
} satisfies Record<keyof typeof en, string>;
