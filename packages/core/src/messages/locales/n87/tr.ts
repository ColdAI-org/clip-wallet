import type N87 from "../../en/n87.js";

/** Turkish: networks87 chain modules (same sections as ../../en/n87.ts). Follows ../tr.ts and its glossary. */
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
