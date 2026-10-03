import type en from "../en/receive";
export default {
  "receive.title": "接收",
  "receive.titleAsset": "接收 {symbol}",
  "receive.pick": "你想接收什么？",
  "receive.assetsList": "可接收的资产",
  "receive.cantReceive": "此钱包暂时无法接收该资产。",
  "receive.senderNetwork": "付款方所在网络",
  "receive.networkMore": "{network} +{n, number}",
  "receive.qr": "你的 {symbol} 地址二维码",
  "receive.copyAddress": "复制地址",
  "receive.manyNetworks": "此地址可在 {networks} 上接收 {symbol}。请让付款方使用其中之一。",
  "receive.oneNetwork": "请让付款方通过 {network} 发送。",
} satisfies Record<keyof typeof en, string>;
