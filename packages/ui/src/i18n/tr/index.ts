/**
 * Turkish UI catalog. Glossary (keep these consistent everywhere, including the mobile catalog later):
 *   wallet → cüzdan, recovery phrase → kurtarma ifadesi, password → parola, passkey → geçiş anahtarı,
 *   account → hesap, address → adres, network → ağ, asset → varlık, token → token, coin → coin,
 *   collectible → koleksiyon öğesi (nav/title: Koleksiyon), balance → bakiye, fee / network fee → ücret / ağ ücreti,
 *   send → Gönder, receive → Al, buy → Satın al, swap → Dönüştür (dönüştürme), stake → stake et (title: Stake),
 *   unstake → Stake'ten çıkar, trade (P2P, Secure Trade) → takas, transaction → işlem, request → istek,
 *   approve → Onayla, reject → Reddet, sign / signature → imzala / imza, connect → Bağlan / bağlantı,
 *   connected apps → bağlı uygulamalar, lock / unlock → kilitle / kilidi aç, backup → yedek / yedekleme,
 *   restore → geri yükle, hardware wallet → donanım cüzdanı, contact → kişi, handle → kullanıcı adı (Clip kullanıcı adı),
 *   notification → bildirim, price alert → fiyat uyarısı, look-alike address → benzer görünen adres,
 *   scammer → dolandırıcı, bridged → köprülenmiş, liquidity → likidite, exchange (CEX) → borsa,
 *   slippage → fiyatın değişebileceği oran, price impact → fiyat etkisi, Advanced mode → Gelişmiş mod,
 *   Explore → Keşfet, Discover → Keşif, Activity → Etkinlik, Settings → Ayarlar, publish → yayınla,
 *   pin → sabitle, rewards → ödüller, unreadable request → okunamayan istek.
 * Voice: polite "siz" in sentences ("…deneyin"); buttons use short verb stems ("Kaydet", "Onayla").
 * Never attach suffixes to {variables}: use "{app} uygulaması", "{network} ağında", "{name} adlı kişiye", "@{handle} kullanıcı adı".
 */
import type { Translation } from "@clip-wallet/i18n";
import type { UiMessages } from "../en";
import common from "./common";
import settings from "./settings";
import onboarding from "./onboarding";
import backup from "./backup";
import home from "./home";
import collectibles from "./collectibles";
import activity from "./activity";
import receive from "./receive";
import accounts from "./accounts";
import approvals from "./approvals";
import components from "./components";
import stake from "./stake";
import swap from "./swap";
import buy from "./buy";
import trade from "./trade";
import hardware from "./hardware";
import send from "./send";
import approval from "./approval";
import explore from "./explore";
import social from "./social";

const messages: Translation<UiMessages> = {
  ...common,
  ...settings,
  ...onboarding,
  ...backup,
  ...home,
  ...collectibles,
  ...activity,
  ...receive,
  ...accounts,
  ...approvals,
  ...components,
  ...stake,
  ...swap,
  ...buy,
  ...trade,
  ...hardware,
  ...send,
  ...approval,
  ...explore,
  ...social,
};
export default messages;
