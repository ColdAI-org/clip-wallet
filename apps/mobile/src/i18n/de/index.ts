/**
 * German mobile catalog (same glossary as packages/ui/src/i18n/de). Informal "du", short and calm. Glossary (keep these consistent everywhere, including the mobile catalog):
 *   wallet → Wallet (das), hardware wallet → Hardware-Wallet, recovery phrase → Wiederherstellungsphrase,
 *   password → Passwort, passkey → Passkey, backup / back up → Backup / sichern, restore → wiederherstellen,
 *   unlock / lock → entsperren / sperren, account → Konto, address → Adresse, network → Netzwerk,
 *   asset → Asset, token → Token, coin → Coin, collectible → Sammlerstück, collection → Sammlung,
 *   balance → Guthaben, fee / network fee → Gebühr / Netzwerkgebühr, amount → Betrag,
 *   send / receive / buy → senden / empfangen / kaufen, swap → tauschen (noun: Tausch),
 *   stake / unstake → staken / Staking beenden, rewards → Belohnungen, liquidity → Liquidität, pool → Pool,
 *   trade (Secure Trade, P2P) → Trade (pl. Trades), bridged → gebridgt, exchange (CEX) → Börse,
 *   approve / reject / approval → genehmigen / ablehnen / Genehmigung, sign / signature → signieren / Signatur,
 *   request → Anfrage, connect / disconnect → verbinden / trennen, pairing → Kopplung, app → App,
 *   contact → Kontakt, handle → Handle (der; „Clip-Handle“), publish → veröffentlichen, claim (handle) → sichern,
 *   notification → Benachrichtigung, price alert → Preisalarm, look-alike address → verwechselbare /
 *   ähnlich aussehende Adresse, scammer → Betrüger, unreadable request → nicht lesbare Anfrage,
 *   Advanced mode → erweiterter Modus, Home → Start, Explore → Erkunden, Discover → Entdecken,
 *   Activity → Aktivität, Settings → Einstellungen, pin / unpin → anheften / loslösen, QR code → QR-Code, device → Gerät,
 *   (this) build → (diese) Version. Apple Account stays verbatim (Apple's product name, der Account).
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
import security from "./security";
import link from "./link";
import plugins from "./plugins";

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
  ...security,
  ...link,
  ...plugins,
};
export default messages;
