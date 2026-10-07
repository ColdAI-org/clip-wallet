import type en from "../en/receive";
export default {
  "m.receive.pick": "何を受け取りますか？",
  "m.receive.titleAsset": "{symbol}を受け取る",
  "m.receive.unsupported": "このウォレットではまだ受け取れません。",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "あなたの{symbol}アドレスのQRコード",
  "m.receive.copyAddress": "アドレスをコピー",
  "m.receive.manyNetworks": "このアドレスは{networks}で{symbol}を受け取れます。送り手にこのいずれかを使うよう伝えてください。",
  "m.receive.oneNetwork": "送り手に{network}で送るよう伝えてください。",
} satisfies Record<keyof typeof en, string>;
