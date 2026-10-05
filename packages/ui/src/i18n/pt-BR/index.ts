/**
 * Brazilian Portuguese UI catalog. Glossary (keep these consistent everywhere, including the mobile catalog later):
 *   wallet → carteira, recovery phrase → frase de recuperação, password → senha, passkey → chave de acesso,
 *   backup → backup (verb: fazer backup), restore → restaurar, account → conta, address → endereço,
 *   network → rede, asset → ativo, token → token, coin → moeda, collectible → colecionável,
 *   balance → saldo, fee / network fee → taxa / taxa de rede, amount → valor,
 *   send → enviar, receive → receber, buy → comprar, swap → trocar (noun: troca),
 *   stake → staking / fazer staking, unstake → retirar do staking, rewards → recompensas,
 *   trade (Secure Trade) → negociação / negociar (feature name "Secure Trade" kept), liquidity → liquidez,
 *   request → solicitação, approve → aprovar, reject → recusar, sign → assinar, signature → assinatura,
 *   connect / disconnect → conectar / desconectar, connected apps → apps conectados, app → app,
 *   lock / unlock → bloquear / desbloquear (a passkey-locked backup copy: trancar / destrancar), hardware wallet → carteira de hardware, device → dispositivo,
 *   scan → escanear, QR code → código QR, contact → contato, handle (Clip handle) → usuário (usuário Clip),
 *   claim a handle → registrar, give up a handle → abrir mão de, publish → publicar,
 *   look-alike address → endereço parecido, scammer → golpista, exchange → corretora,
 *   bridged → via ponte, pin / unpin → fixar / desafixar, price alert → alerta de preço,
 *   notifications → notificações, activity → atividade,
 *   Settings (the app's own screen/tab, and "in Settings") → Ajustes (iOS pt-BR term; "Configurações" overflows the
 *   6-tab mobile bar), but system/browser/notification/RPC settings → configurações, Advanced mode → Modo avançado,
 *   Discover → Descobrir, Explore → Explorar, Home → Início, unreadable request → solicitação ilegível,
 *   Try again → Tentar de novo (in sentences: "tente de novo"). Decimal examples use a comma (0,5).
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
};
export default messages;
