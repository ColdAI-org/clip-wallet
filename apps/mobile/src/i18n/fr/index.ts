/**
 * French mobile catalog. Same glossary as the web UI catalog (packages/ui/src/i18n/fr/index.ts):
 *   wallet → portefeuille, recovery phrase → phrase de récupération, passkey → clé d'accès,
 *   password → mot de passe, backup → sauvegarde, lock / unlock → verrouiller / déverrouiller,
 *   account → compte, address → adresse, network → réseau, asset → actif, token → jeton, coin → crypto,
 *   balance → solde, fee → frais, collectible → objet de collection (tab: « Collection »),
 *   send / receive → envoyer / recevoir, swap → échanger, stake → staker (noun: staking),
 *   request → demande, approve / reject → approuver / refuser, approval → approbation, sign → signer,
 *   connect → connecter, app → application, connected apps → applications connectées,
 *   settings → Paramètres, Browse tab → Naviguer, in-app browser → navigateur intégré,
 *   advanced mode → mode avancé, unreadable request → demande illisible, look-alike address → adresse sosie,
 *   handle (Clip handle) → identifiant (identifiant Clip), price alert → alerte de prix, bridged → bridgé,
 *   exchange (CEX) → plateforme d'échange, QR code → code QR, device → appareil, biometrics → biométrie,
 *   scammer → arnaqueur, notification → notification, trade → échange (« Secure Trade » stays in English).
 * Typography: U+202F before ? ! ; and U+00A0 before : and % and inside « », decimal comma in examples (0,5).
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
import plugins from "./plugins";
import settle from "./settle";

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
  ...plugins,
  ...settle,
};
export default messages;
