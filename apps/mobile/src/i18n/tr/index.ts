/**
 * Turkish mobile catalog. Glossary (shared with the UI catalog in packages/ui/src/i18n/tr/index.ts):
 *   wallet → cüzdan, recovery phrase → kurtarma ifadesi, password → parola, passkey → geçiş anahtarı,
 *   account → hesap, address → adres, network → ağ, asset → varlık, token → token, coin → coin,
 *   collectible → koleksiyon öğesi (tab/title: Koleksiyon), balance → bakiye, fee / network fee → ücret / ağ ücreti,
 *   send → Gönder, receive → Al, buy → Satın al, swap → Dönüştür (dönüştürme), stake → stake et (Staking: Stake etme),
 *   trade (P2P, Secure Trade) → takas, transaction → işlem, request → istek,
 *   approve → Onayla, reject → Reddet, sign / signature → imzala / imza, connect → Bağlan / bağlantı,
 *   connected apps → bağlı uygulamalar, lock / unlock → kilitle / kilidi aç, backup → yedek / yedekleme,
 *   restore → geri yükle, hardware wallet → donanım cüzdanı, contact → kişi, handle → kullanıcı adı (Clip kullanıcı adı),
 *   notification → bildirim, price alert → fiyat uyarısı, look-alike address → benzer görünen adres,
 *   scammer → dolandırıcı, bridged → köprülenmiş, liquidity → likidite, exchange (CEX) → borsa,
 *   Advanced mode → Gelişmiş mod, Explore → Keşfet, Discover → Keşif, Browse (tab) → Göz at,
 *   Activity → Etkinlik, Settings → Ayarlar, biometrics → biyometrik veriler, publish → yayınla, pin → sabitle.
 * Voice: polite "siz" in sentences ("…deneyin"); buttons use short verb stems ("Kaydet", "Onayla").
 * Never attach suffixes to {variables}: use "{app} uygulaması", "{network} ağında", "{name} adlı kişiye", "{label} ile".
 */
import type { Translation } from "@clip-wallet/i18n";
import type { MobileMessages } from "../en";
import common from "./common";
import onboarding from "./onboarding";
import home from "./home";
import collectibles from "./collectibles";
import activity from "./activity";
import receive from "./receive";
import scan from "./scan";
import browser from "./browser";
import kit from "./kit";
import app from "./app";
import send from "./send";
import approval from "./approval";
import settings from "./settings";
import explore from "./explore";
import social from "./social";
import accounts from "./accounts";
import backup from "./backup";
import buy from "./buy";
import hardware from "./hardware";
import stake from "./stake";
import swap from "./swap";
import trade from "./trade";

const messages: Translation<MobileMessages> = {
  ...common,
  ...onboarding,
  ...home,
  ...collectibles,
  ...activity,
  ...receive,
  ...scan,
  ...browser,
  ...kit,
  ...app,
  ...send,
  ...approval,
  ...settings,
  ...explore,
  ...social,
  ...accounts,
  ...backup,
  ...buy,
  ...hardware,
  ...stake,
  ...swap,
  ...trade,
};
export default messages;
