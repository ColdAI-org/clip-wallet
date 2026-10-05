/**
 * Spanish UI catalog. Glossary (keep these consistent everywhere, including the mobile catalog later):
 *   wallet → billetera, hardware wallet → billetera de hardware, recovery phrase → frase de recuperación,
 *   passkey → llave de acceso, password → contraseña, backup → copia de seguridad (short: copia),
 *   back up → hacer una copia, restore → restaurar, locked copy (passkey backup) → copia cifrada,
 *   lock / unlock → bloquear / desbloquear, account → cuenta, address → dirección, network → red,
 *   asset → activo, token → token, coin → moneda, collectible → coleccionable, balance → saldo,
 *   fee → comisión, send → enviar, receive → recibir, swap → intercambiar, buy → comprar,
 *   stake → staking / hacer staking, unstake → retirar del staking, rewards → recompensas,
 *   trade (Secure Trade) → operación, approve / reject → aprobar / rechazar, request → solicitud,
 *   sign / signature → firmar / firma, connect → conectar, connected apps → apps conectadas,
 *   pairing → vinculación, unreadable request → solicitud ilegible, raw request → solicitud sin procesar,
 *   Advanced mode → modo avanzado, settings → ajustes, activity → actividad, contacts → contactos,
 *   handle (Clip handle) → alias (alias de Clip), claim (a handle) → registrar, give up → renunciar a,
 *   publish → publicar, look-alike address → dirección parecida, scammers → estafadores,
 *   notifications → notificaciones, price alert → alerta de precio, bridged → puenteado,
 *   liquidity → liquidez, pool → pool, exchange (CEX) → exchange, Discover → Descubrir, Explore → Explorar,
 *   email → correo (electrónico), sign in → iniciar sesión, Ethereum-style → tipo Ethereum.
 *   Never translated: Clip Wallet, WalletConnect, Ledger, Ledger Live, Keystone, Face ID, Touch ID, Secure Trade,
 *   asset symbols, network names, CoinGecko, DEX Screener.
 *   Devices are masculine (el dispositivo): un Ledger, tu Keystone, desbloquéalo, en él. Example decimals use a comma (0,5).
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
import settle from "./settle";
import privacy from "./privacy";
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
  ...privacy,
  ...security,
  ...settle,
  ...link,
};
export default messages;
