import type N87 from "../../en/n87.js";

/** Simplified Chinese: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../zh-Hans.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "此 TRON 账户由另一个密钥控制，因此 Clip Wallet 无法为其签名。",
  "bg.tron.notOpen": "你的 TRON 账户尚未开通。请先接收一些 TRX。",
  "bg.tron.contractRecipient": "TRX 不能直接发送到智能合约。",
  "bg.tron.newAccountFee": "该地址尚未在 TRON 上开通。向其发送还需额外支付 {amount} 来开通它。",
  "bg.tron.getsSigned": "{host}（会收到已签名的交易）",
  "bg.tron.energy": "能量",
  "bg.tron.bandwidth": "带宽",
  "bg.tron.tronPower": "投票权",
  "bg.tron.stakeFor": "质押 {amount} 以获取{resource}",
  "bg.tron.days": "{count} 天",
  "bg.tron.cancelUnstaking": "取消待处理的解除质押，并重新质押这些 TRX",
  "bg.tron.lend": "将你质押的 {amount} 所产生的{resource}借给 {to}",
  "bg.tron.stopLending": "收回借给 {to} 的 {amount} 所产生的{resource}",
  "bg.tron.lockedHours": "约 {hours} 小时。在此之前无法收回。",
  "bg.tron.vote": "投票给 {count} 个 Super Representative",
  "bg.tron.votesReplace": "这会替换你之前的所有投票。",
  "bg.tron.claimVoteRewards": "领取你的投票奖励",
  "bg.tron.changePermissions": "更改谁能控制你的 TRON 账户",
  "bg.tron.keysThreshold": "{keys}（需要 {threshold}）",
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  "bg.multiversx.claimRewardsFrom": "从 {validator} 领取你的质押奖励",
  "bg.multiversx.withdrawFrom": "从 {validator} 提取你已解除质押的 EGLD",
  "bg.multiversx.restakeRewardsWith": "将你的奖励重新质押给 {validator}",
  "bg.multiversx.labelGuardian": "守护者",
  "bg.multiversx.setGuardianTitle": "将 {guardian} 设为你账户的守护者",
  "bg.multiversx.setGuardianWarn": "守护者生效后，此账户的每笔交易都需要它的联合签名。如果 {guardian} 不是你自己选的，别人可能会把你锁在自己的账户之外。",
  "bg.multiversx.guardAccountTitle": "开启你账户的守护者",
  "bg.multiversx.guardAccountWarn": "从现在起，此账户的每笔交易都需要守护者的联合签名。Clip Wallet 无法提供，因此你将无法再从 Clip Wallet 发送。",
  "bg.multiversx.unguardAccountTitle": "关闭你账户的守护者",
  "bg.multiversx.changeOwnerTitle": "将合约 {contract} 交给 {owner}",
  "bg.multiversx.changeOwnerWarn": "这会让 {owner} 成为合约 {contract} 的所有者。新所有者可以修改它的代码并拿走其中的资产。只有在你确实想转让它时才这样做。",
  "bg.multiversx.guardedAccount": "此账户设有守护者，Clip Wallet 无法获得守护者的联合签名。没有发送任何内容。",
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
