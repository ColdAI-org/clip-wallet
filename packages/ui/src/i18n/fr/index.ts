/**
 * French UI catalog. Glossary (keep these consistent everywhere, including the mobile catalog later):
 *   wallet → portefeuille, hardware wallet → portefeuille matériel, recovery phrase → phrase de récupération,
 *   passkey → clé d'accès, password → mot de passe, backup / back up → sauvegarde / sauvegarder,
 *   restore → restaurer, lock / unlock → verrouiller / déverrouiller, account → compte, address → adresse,
 *   network → réseau, asset → actif, token → jeton, coin / crypto → crypto, balance → solde, fee → frais,
 *   collectible → objet de collection (nav tab and screen title: « Collection »), collection → collection,
 *   send / receive → envoyer / recevoir, swap → échanger (noun: échange), buy → acheter,
 *   stake → staker (screen and noun: staking), unstake → retirer du staking, rewards → récompenses,
 *   trade → échange (product name « Secure Trade » stays in English), request → demande, approve / reject → approuver / refuser,
 *   approval → approbation, sign → signer, connect / disconnect → connecter / déconnecter,
 *   app → application, connected apps → applications connectées, settings → Paramètres,
 *   advanced mode → mode avancé, unreadable request → demande illisible, look-alike address → adresse sosie,
 *   scammer → arnaqueur, handle (Clip handle) → identifiant (identifiant Clip), contact → contact,
 *   publish → publier, notification → notification, price alert → alerte de prix, bridged → bridgé,
 *   liquidity → liquidité, slippage → « Le prix peut varier de », price impact → impact sur le prix,
 *   exchange (CEX) → plateforme d'échange, QR code → code QR, device → appareil, pin → épingler,
 *   Activity → Activité, Explore → Explorer, Discover → Découvrir, Home → Accueil.
 * Typography: U+202F before ? ! ; and U+00A0 before : and % and inside « », decimal comma in examples (0,5).
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
import plugins from "./plugins";
import security from "./security";
import link from "./link";

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
  ...plugins,
  ...security,
  ...link,
};
export default messages;
