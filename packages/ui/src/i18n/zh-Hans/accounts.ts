import type en from "../en/accounts";
export default {
  "accounts.title": "账户",
  "accounts.titleFor": "{host} 的账户",
  "accounts.chooseFor": "选择 {host} 可以看到哪个账户。其他应用保留各自的选择。",
  "accounts.nameFor": "{account} 的名称",
  "accounts.inUse": "使用中",
  "accounts.rename": "重命名",
  "accounts.renameAccount": "重命名 {account}",
  "accounts.use": "使用",
  "accounts.useAccount": "使用 {account}",
  "accounts.adding": "正在添加…",
  "accounts.add": "添加账户",
  "accounts.useDefault": "在此使用我的默认账户",
  "accounts.family.evm": "Ethereum 类（ETH、USDC、Base、Arbitrum…）",
} satisfies Record<keyof typeof en, string>;
