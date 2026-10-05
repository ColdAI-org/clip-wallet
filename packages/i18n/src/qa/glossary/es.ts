/**
 * Must-match glossary for es: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/es/index.ts.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  {
    en: "wallet",
    tr: "billetera",
    // Keystone's own menu label, kept in English verbatim to match the device screen
    except: ["hardware.keystone.step1"],
  },
  { en: "hardware wallet", tr: "billeteras? de hardware" },
  { en: "recovery phrase", tr: "frase de recuperación" },
  { en: "passkey", tr: "llaves? de acceso" },
  {
    en: "account",
    tr: "cuentas?",
    // only the {account} placeholder matches here (its value is already the translated account label/word)
    except: ["accounts.nameFor", "accounts.renameAccount", "accounts.useAccount", "approval.connect.lede", "m.approval.connect.lede", "m.accounts.nameFor", "m.accounts.renameAccount", "m.accounts.useAccount"],
  },
  { en: "accounts", tr: "cuentas" },
  {
    en: "address",
    tr: "direcci(ó|o)n",
    // only the {address} placeholder matches here
    except: ["social.pick.saveRecipient", "social.recipient.saved", "social.recipient.this", "m.social.recipient.saved", "m.social.recipient.this"],
  },
  { en: "addresses", tr: "direcciones" },
  { en: "network fee", tr: "comisión de red" },
  { en: "fee", tr: "comisi(ó|o)n" },
  { en: "collectible", tr: "coleccionable" },
  { en: "collectibles", tr: "coleccionables" },
  { en: "unstake", tr: "retirar.*del staking|retirar del staking" },
  { en: "unreadable request", tr: "solicitud(es)? ilegibles?" },
  { en: "look-alike address", tr: "direcci(ó|o)n parecida" },
  { en: "look-alike addresses", tr: "direcciones parecidas" },
  { en: "scammers", tr: "estafadores" },
  { en: "approve", tr: "aprob|apru[eé]b" },
  { en: "reject", tr: "rechaz" },
  { en: "connected apps", tr: "apps conectadas" },
  { en: "notifications", tr: "notificaciones" },
  { en: "price alerts", tr: "alertas de precio" },
  { en: "Secure Trade", tr: "Secure Trade" },
  { en: "trade link", tr: "enlace de (la )?operación" },
  { en: "Advanced mode", tr: "modo avanzado" },
];
export default glossary;
