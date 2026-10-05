/**
 * Must-match glossary for pt-BR: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/pt-BR/index.ts.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  {
    en: "wallet",
    tr: "carteira",
    // why: “Connect Software Wallet” is the Keystone's own (English) menu label, kept verbatim.
    except: ["hardware.keystone.step1"],
  },
  { en: "wallets", tr: "carteiras" },
  { en: "hardware wallet", tr: "carteira de hardware" },
  { en: "hardware wallets", tr: "carteiras de hardware" },
  { en: "recovery phrase", tr: "frase de recuperação" },
  { en: "passkey", tr: "chave de acesso" },
  { en: "passkeys", tr: "chaves de acesso" },
  { en: "account", tr: "conta" },
  { en: "accounts", tr: "contas?" }, // "No accounts" reads "Nenhuma conta"
  {
    en: "address",
    tr: "endereço",
    // why: "address book" is the contact list ("agenda de contatos"), not a blockchain address.
    except: ["social.err.full", "m.social.err.full"],
  },
  { en: "addresses", tr: "endereços" },
  { en: "network fee", tr: "taxa de rede" },
  { en: "fee", tr: "taxa" },
  { en: "collectible", tr: "colecionável" },
  { en: "collectibles", tr: "colecionáve(l|is)" }, // "No collectibles yet" → "Nenhum colecionável ainda"
  {
    en: "stake",
    tr: "staking",
    // why: Polymarket's "your whole stake" is the money bet, not crypto staking ("tudo o que apostou").
    except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"],
  },
  { en: "unstake", tr: "retirar .*staking" },
  { en: "unreadable request", tr: "solicitação ilegível" },
  { en: "unreadable requests", tr: "solicitações ilegíveis" },
  { en: "look-alike address", tr: "endereço parecido" },
  { en: "look-alike addresses", tr: "endereços parecidos" },
  { en: "scammers", tr: "golpistas" },
  { en: "approve", tr: "aprov" },
  { en: "reject", tr: "recusar" },
  { en: "connected apps", tr: "apps conectados" },
  { en: "notification", tr: "notificação" },
  { en: "notifications", tr: "notificações" },
  { en: "price alert", tr: "alerta de preço" },
  { en: "price alerts", tr: "alertas? de preço" }, // "No price alerts" → "Nenhum alerta de preço"
  { en: "Secure Trade", tr: "Secure Trade" },
  { en: "settings", tr: "Ajustes|configurações" },
  { en: "exchange", tr: "corretora" },
];
export default glossary;
