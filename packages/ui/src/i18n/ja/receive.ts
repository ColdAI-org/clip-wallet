import type en from "../en/receive";
export default {
  "receive.title": "受け取る",
  "receive.titleAsset": "{symbol}を受け取る",
  "receive.pick": "何を受け取りますか？",
  "receive.assetsList": "受け取れる資産",
  "receive.cantReceive": "このウォレットではまだ受け取れません。",
  "receive.senderNetwork": "送り手のネットワーク",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "あなたの{symbol}アドレスのQRコード",
  "receive.copyAddress": "アドレスをコピー",
  "receive.manyNetworks": "このアドレスは{networks}で{symbol}を受け取れます。送り手にこのいずれかを使うよう伝えてください。",
  "receive.oneNetwork": "送り手に{network}で送るよう伝えてください。",
} satisfies Record<keyof typeof en, string>;
