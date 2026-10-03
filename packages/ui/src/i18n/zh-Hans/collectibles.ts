import type en from "../en/collectibles";
export default {
  "collectibles.title": "收藏品",
  "collectibles.filter.show": "显示",
  "collectibles.filter.everything": "全部",
  "collectibles.filter.only": "仅 {network}",
  "collectibles.emptyTitle": "还没有收藏品",
  "collectibles.emptyBody": "你在应用中收集的物品会显示在这里。",
  "collectibles.tokenNumber": "#{tokenId}",
  "collectibles.detail.title": "收藏品",
  "collectibles.detail.gone": "此物品已不在你的钱包中",
  "collectibles.detail.copyLink": "复制链接",
  "collectibles.detail.network": "网络",
  "collectibles.detail.standard": "标准",
  "collectibles.detail.tokenId": "代币 ID",
  "collectibles.detail.collection": "系列",
} satisfies Record<keyof typeof en, string>;
