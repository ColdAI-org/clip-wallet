/**
 * Italian mobile catalog. Glossary (same terms as the UI catalog in packages/ui/src/i18n/it):
 *   wallet → wallet (il), recovery phrase → frase di recupero, password → password, passkey → passkey (la),
 *   backup / back up → backup (il) / fai il backup, restore → ripristina, unlock / lock → sblocca / blocca,
 *   account → account (l'), address → indirizzo, network → rete, asset → asset (l'), token → token, coins → monete,
 *   collectible(s) → collezionabile/collezionabili, balance → saldo, amount → importo, fee → commissione
 *   (network fee → commissione di rete), send → invia, receive → ricevi, buy → compra,
 *   swap → scambia (verb) / swap (noun, lo swap), trade (Secure Trade) → scambio, stake → staking / metti in staking,
 *   unstake → togli dallo staking, rewards → ricompense, liquidity → liquidità, slippage → "il prezzo può variare di",
 *   approve / reject → approva / rifiuta, request → richiesta, sign / signature → firmare / firma,
 *   connect / disconnect → collega / scollega, connected apps → app collegate, hardware wallet → hardware wallet (l'),
 *   device → dispositivo, QR code → codice QR, contacts → contatti, handle → handle (l'; "handle Clip"),
 *   look-alike address → indirizzo somigliante, scammers → truffatori, notifications → notifiche,
 *   price alert → avviso di prezzo, activity → attività, settings → impostazioni, explore → esplora,
 *   discover → scopri, advanced mode → modalità avanzata, bridged → via bridge, exchange → exchange,
 *   unreadable request → richiesta illeggibile, verified → verificato.
 *   scam → truffa (scam list → elenco di truffe), suspicious → sospetto, permission → permesso.
 *   No article directly before {symbol} ("i"/"gli"/"l'" depends on the symbol): use "i tuoi {symbol}", "in {symbol}" or none.
 *   Mobile only: Browse (tab) → Naviga, in-app browser → browser in-app, biometrics → biometria.
 *   Informal "tu"; decimal examples use a comma (0,5).
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
