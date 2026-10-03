import type en from "../en/receive";
export default {
  "m.receive.pick": "你想接收什么？",
  "m.receive.titleAsset": "接收 {symbol}",
  "m.receive.unsupported": "此钱包暂时无法接收该资产。",
  "m.receive.networksMore": "{network} +{n, number}",
  "m.receive.qr": "你的 {symbol} 地址二维码",
  "m.receive.copyAddress": "复制地址",
  "m.receive.manyNetworks": "此地址可在 {networks} 上接收 {symbol}。请让付款方使用其中之一。",
  "m.receive.oneNetwork": "请让付款方通过 {network} 发送。",
} satisfies Record<keyof typeof en, string>;
