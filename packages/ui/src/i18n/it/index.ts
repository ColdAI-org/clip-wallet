/**
 * Italian UI catalog. Glossary (keep these consistent everywhere, including the mobile catalog later):
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
 *   Informal "tu"; decimal examples use a comma (0,5).
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
