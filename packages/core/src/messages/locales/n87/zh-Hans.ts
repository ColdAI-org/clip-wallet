import type N87 from "../../en/n87.js";

/** Simplified Chinese: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../zh-Hans.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  // ---- end chains-icp
  // ---- chains-stacks (stacks)
  "bg.stacks.postCondition": "后置条件",
  "bg.stacks.pcYouSendExactly": "你恰好发送 {amount}",
  "bg.stacks.pcYouSendAtMost": "你最多发送 {amount}",
  "bg.stacks.pcYouSendAtLeast": "你至少发送 {amount}",
  "bg.stacks.pcYouSendMoreThan": "你发送超过 {amount}",
  "bg.stacks.pcYouSendLessThan": "你发送少于 {amount}",
  "bg.stacks.pcSendsExactly": "{who} 恰好发送 {amount}",
  "bg.stacks.pcSendsAtMost": "{who} 最多发送 {amount}",
  "bg.stacks.pcSendsAtLeast": "{who} 至少发送 {amount}",
  "bg.stacks.pcSendsMoreThan": "{who} 发送超过 {amount}",
  "bg.stacks.pcSendsLessThan": "{who} 发送少于 {amount}",
  "bg.stacks.pcYouSendNft": "你发送 {item}",
  "bg.stacks.pcYouKeepNft": "你保留 {item}",
  "bg.stacks.pcYouMaySendNft": "你可能发送 {item}",
  "bg.stacks.pcSendsNft": "{who} 发送 {item}",
  "bg.stacks.pcKeepsNft": "{who} 保留 {item}",
  "bg.stacks.pcMaySendNft": "{who} 可能发送 {item}",
  "bg.stacks.pcStakingRule": "{who} 的质押规则",
  "bg.stacks.allowMode": "这会让合约可以转移你的任何资产，而不仅是列出的资产。只有在你完全信任 {host} 时才批准。",
  "bg.stacks.originatorMode": "只有列出的转账可以离开你的账户。合约仍可能转移其他账户的资产。",
  "bg.stacks.nothingLeaves": "在此交易中，除网络手续费外，你的任何资产都不会离开你的账户。",
  "bg.stacks.highFee": "网络手续费为 {fee}，异常高。",
  "bg.stacks.sponsorPays": "由 {host} 选择的赞助方",
  "bg.stacks.deployNamed": "创建智能合约 {name}",
  "bg.stacks.notYourTx": "此交易由另一个 Stacks 账户签名，因此 Clip Wallet 无法签名。",
  "bg.stacks.multisig": "Clip Wallet 暂不支持为共享（多重签名）Stacks 账户签名。",
  "bg.stacks.memoTooLong": "备忘过长。Stacks 备忘最多可容纳 34 字节。",
  "bg.stacks.feeTooLow": "网络手续费过低，因此网络未接受此交易。没有发送任何内容。请重试。",
  "bg.stacks.nonceBusy": "此账户的另一笔交易仍在等待中。请等它完成后重试。",
  "bg.stacks.otherNetworkTx": "此交易属于另一个 Stacks 网络，因此未发送。",
  "bg.stacks.badContractCall": "应用的合约调用与网络上的合约不匹配。没有发送任何内容。",
  "bg.stacks.tooManyPending": "此账户有太多交易在等待中。请等其中一些完成后重试。",
  "bg.stacks.signatureRefused": "网络未接受该签名。没有发送任何内容。",
  "bg.stacks.testAddressOnMainnet": "这是 Stacks 测试网络地址（ST…）。请使用主网地址（SP…）。",
  "bg.stacks.mainAddressOnTestnet": "这是 Stacks 主网地址（SP…）。请使用测试网络地址（ST…）。",
  "bg.stacks.notAnAddress": "这看起来不像 Stacks 地址。",
  "bg.stacks.needStxForFee": "你需要少量 STX 来支付网络手续费。",
  // ---- end chains-stacks
  // ---- chains-fuel (fuel)
  "bg.fuel.changeToOther": "此后你剩余的所有 {symbol} 都会转给 {to}，而不会退回给你。",
  "bg.fuel.leftoverLost": "{amount} 在此交易中没有发送到任何地方，将会丢失。",
  "bg.fuel.coinsSpent": "此交易使用的部分币已经被花掉。请让应用重试。",
  "bg.fuel.feeRose": "准备之后网络手续费上涨了。没有发送任何内容。请重试。",
  "bg.fuel.failedOnChain": "此交易在 Fuel 网络上失败。只花费了网络手续费。",
  "bg.fuel.tooManyCoins": "这需要一次使用太多小额币。请先发送较小的金额。",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "网络定额收费",
  "bg.evm.flatFee": "每笔交易 {amount}，失败也收取",
  // ---- end chains-evm
};
export default messages;
