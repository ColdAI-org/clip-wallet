/**
 * Spanish mobile catalog. Glossary (same as packages/ui/src/i18n/es; keep consistent everywhere):
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
