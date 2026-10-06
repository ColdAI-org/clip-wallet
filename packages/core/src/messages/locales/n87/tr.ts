import type N87 from "../../en/n87.js";

/** Turkish: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../tr.ts and its glossary. */
const messages: { readonly [K in keyof typeof N87]: string } = {
  // ---- chains-cosmos (cosmos, provenance, thorchain, initia)
  // ---- end chains-cosmos
  // ---- chains-tron (tron)
  "bg.tron.notControlled": "Bu TRON hesabı başka bir anahtar tarafından kontrol ediliyor, bu yüzden Clip Wallet onun için imzalayamıyor.",
  "bg.tron.notOpen": "TRON hesabınız henüz açılmadı. Önce biraz TRX alın.",
  "bg.tron.contractRecipient": "TRX doğrudan bir akıllı sözleşmeye gönderilemez.",
  "bg.tron.newAccountFee": "Bu adres TRON'da henüz açılmadı. Buraya göndermenin, adresi açmak için ayrıca {amount} maliyeti var.",
  "bg.tron.getsSigned": "{host} (imzalı işlemi alır)",
  "bg.tron.energy": "enerji",
  "bg.tron.bandwidth": "bant genişliği",
  "bg.tron.tronPower": "oy gücü",
  "bg.tron.stakeFor": "{resource} için {amount} stake et",
  "bg.tron.days": "{count} gün",
  "bg.tron.cancelUnstaking": "Bekleyen stake'ten çıkarma işlemlerinizi iptal edin ve bu TRX'i yeniden stake edin",
  "bg.tron.lend": "Stake ettiğiniz {amount} tutarının {resource} kaynağını {to} adresine ödünç ver",
  "bg.tron.stopLending": "{to} adresine ödünç verdiğiniz {amount} tutarının {resource} kaynağını geri al",
  "bg.tron.lockedHours": "Yaklaşık {hours} saat. Bundan önce geri alamazsınız.",
  "bg.tron.vote": "{count} Super Representative'e oy ver",
  "bg.tron.votesReplace": "Bu, önceki tüm oylarınızın yerini alır.",
  "bg.tron.claimVoteRewards": "Oylama ödüllerinizi alın",
  "bg.tron.changePermissions": "TRON hesabınızı kimin kontrol ettiğini değiştirin",
  "bg.tron.keysThreshold": "{keys} ({threshold} gerekli)",
  // ---- end chains-tron
  // ---- chains-xrpl (xrpl)
  // ---- end chains-xrpl
  // ---- chains-antelope (antelope)
  // ---- end chains-antelope
  // ---- chains-multiversx (multiversx)
  "bg.multiversx.claimRewardsFrom": "{validator} doğrulayıcısındaki stake ödüllerini al",
  "bg.multiversx.withdrawFrom": "{validator} doğrulayıcısından stake'ten çıkarılmış EGLD'ni çek",
  "bg.multiversx.restakeRewardsWith": "Ödüllerini {validator} ile yeniden stake et",
  "bg.multiversx.labelGuardian": "Koruyucu",
  "bg.multiversx.setGuardianTitle": "{guardian} adresini hesabının koruyucusu yap",
  "bg.multiversx.setGuardianWarn": "Bir koruyucu etkinleştiğinde bu hesaptan yapılan her işlem onun ortak imzasını gerektirir. {guardian} adresini sen seçmediysen biri seni kendi hesabından kilitleyebilir.",
  "bg.multiversx.guardAccountTitle": "Hesabının koruyucusunu aç",
  "bg.multiversx.guardAccountWarn": "Bundan sonra bu hesaptan yapılan her işlem koruyucunun ortak imzasını gerektirir. Clip Wallet bunu sağlayamaz, bu yüzden artık Clip Wallet'tan gönderim yapamazsın.",
  "bg.multiversx.unguardAccountTitle": "Hesabının koruyucusunu kapat",
  "bg.multiversx.changeOwnerTitle": "{contract} sözleşmesini {owner} adresine devret",
  "bg.multiversx.changeOwnerWarn": "Bu, {owner} adresini {contract} sözleşmesinin sahibi yapar. Yeni sahip kodunu değiştirebilir ve içindekileri alabilir. Bunu yalnızca gerçekten devretmek istiyorsan yap.",
  "bg.multiversx.guardedAccount": "Bu hesabın bir koruyucusu var ve Clip Wallet koruyucunun ortak imzasını alamıyor. Hiçbir şey gönderilmedi.",
  // ---- end chains-multiversx
  // ---- chains-icp (icp)
  // ---- end chains-icp
  // ---- chains-stacks (stacks)
  "bg.stacks.postCondition": "Son koşul",
  "bg.stacks.pcYouSendExactly": "Tam olarak {amount} gönderiyorsunuz",
  "bg.stacks.pcYouSendAtMost": "En fazla {amount} gönderiyorsunuz",
  "bg.stacks.pcYouSendAtLeast": "En az {amount} gönderiyorsunuz",
  "bg.stacks.pcYouSendMoreThan": "{amount} miktarından fazlasını gönderiyorsunuz",
  "bg.stacks.pcYouSendLessThan": "{amount} miktarından azını gönderiyorsunuz",
  "bg.stacks.pcSendsExactly": "{who} tam olarak {amount} gönderiyor",
  "bg.stacks.pcSendsAtMost": "{who} en fazla {amount} gönderiyor",
  "bg.stacks.pcSendsAtLeast": "{who} en az {amount} gönderiyor",
  "bg.stacks.pcSendsMoreThan": "{who}, {amount} miktarından fazlasını gönderiyor",
  "bg.stacks.pcSendsLessThan": "{who}, {amount} miktarından azını gönderiyor",
  "bg.stacks.pcYouSendNft": "{item} gönderiyorsunuz",
  "bg.stacks.pcYouKeepNft": "{item} sizde kalıyor",
  "bg.stacks.pcYouMaySendNft": "{item} gönderebilirsiniz",
  "bg.stacks.pcSendsNft": "{who}, {item} gönderiyor",
  "bg.stacks.pcKeepsNft": "{item}, {who} üzerinde kalıyor",
  "bg.stacks.pcMaySendNft": "{who}, {item} gönderebilir",
  "bg.stacks.pcStakingRule": "{who} için bir stake kuralı",
  "bg.stacks.allowMode": "Bu, sözleşmenin yalnızca listelenenleri değil, varlıklarınızdan herhangi birini taşımasına izin verir. Yalnızca şu siteye tamamen güveniyorsanız onaylayın: {host}.",
  "bg.stacks.originatorMode": "Hesabınızdan yalnızca listelenen transferler çıkabilir. Sözleşme yine de diğer hesapların varlıklarını taşıyabilir.",
  "bg.stacks.nothingLeaves": "Bu işlemde ağ ücreti dışında hiçbir varlığınız hesabınızdan çıkamaz.",
  "bg.stacks.highFee": "Ağ ücreti {fee}; bu alışılmadık derecede yüksek.",
  "bg.stacks.sponsorPays": "{host} tarafından seçilen bir sponsor",
  "bg.stacks.deployNamed": "{name} akıllı sözleşmesini oluştur",
  "bg.stacks.notYourTx": "Bu işlem farklı bir Stacks hesabı tarafından imzalanıyor, bu yüzden Clip Wallet onu imzalayamaz.",
  "bg.stacks.multisig": "Clip Wallet henüz ortak (çoklu imzalı) Stacks hesapları için imza atamıyor.",
  "bg.stacks.memoTooLong": "Memo çok uzun. Bir Stacks memo'su en fazla 34 bayt alabilir.",
  "bg.stacks.feeTooLow": "Ağ ücreti çok düşüktü, bu yüzden ağ işlemi kabul etmedi. Hiçbir şey gönderilmedi. Tekrar deneyin.",
  "bg.stacks.nonceBusy": "Bu hesaptan başka bir işlem hâlâ bekliyor. Tamamlanmasını bekleyip tekrar deneyin.",
  "bg.stacks.otherNetworkTx": "Bu işlem farklı bir Stacks ağı için, bu yüzden gönderilmedi.",
  "bg.stacks.badContractCall": "Uygulamanın sözleşme çağrısı ağdaki sözleşmeyle eşleşmiyor. Hiçbir şey gönderilmedi.",
  "bg.stacks.tooManyPending": "Bu hesapta bekleyen çok fazla işlem var. Bazılarının tamamlanmasını bekleyip tekrar deneyin.",
  "bg.stacks.signatureRefused": "Ağ imzayı kabul etmedi. Hiçbir şey gönderilmedi.",
  "bg.stacks.testAddressOnMainnet": "Bu bir Stacks test ağı adresi (ST…). Ana ağ adresi (SP…) kullanın.",
  "bg.stacks.mainAddressOnTestnet": "Bu bir Stacks ana ağ adresi (SP…). Test ağı adresi (ST…) kullanın.",
  "bg.stacks.notAnAddress": "Bu bir Stacks adresine benzemiyor.",
  "bg.stacks.needStxForFee": "Ağ ücretini ödemek için biraz STX'e ihtiyacınız var.",
  // ---- end chains-stacks
  // ---- chains-fuel (fuel)
  "bg.fuel.changeToOther": "Bundan sonra {symbol} bakiyenizden kalan her şey size değil, {to} adresine gider.",
  "bg.fuel.leftoverLost": "{amount} bu işlemle hiçbir yere gönderilmiyor ve kaybolur.",
  "bg.fuel.coinsSpent": "Bu işlemin kullandığı coinlerin bazıları zaten harcanmış. Uygulamadan tekrar denemesini isteyin.",
  "bg.fuel.feeRose": "Bu hazırlandığından beri ağ ücreti yükseldi. Hiçbir şey gönderilmedi. Tekrar deneyin.",
  "bg.fuel.failedOnChain": "Bu işlem Fuel ağında başarısız oldu. Yalnızca ağ ücreti ödendi.",
  "bg.fuel.tooManyCoins": "Bunun için aynı anda çok fazla küçük coin gerekiyor. Önce daha küçük bir tutar gönderin.",
  // ---- end chains-fuel
  // ---- chains-bitcoincash (bitcoincash)
  // ---- end chains-bitcoincash
  // ---- 1mask (networks87 providers) (1mask)
  // ---- end 1mask (networks87 providers)
  // ---- chains-evm
  "bg.label.networkCharge": "Ağ kesintisi",
  "bg.evm.flatFee": "İşlem başına {amount}, başarısız olsa bile",
  // ---- end chains-evm
};
export default messages;
