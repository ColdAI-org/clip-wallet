/**
 * Must-match glossary for ar: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/ar/index.ts.
 * Arabic attaches pronoun suffixes and the article ال, so most patterns are stems (محفظ matches محفظتك/المحفظة).
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  { en: "wallet", tr: "محفظ|محافظ", except: ["hardware.keystone.step1"] }, // why: Keystone's own menu label “Connect Software Wallet” stays English
  { en: "recovery phrase", tr: "عبارة (ال)?استرداد" },
  { en: "passkey", tr: "مفتاح (ال)?مرور" },
  { en: "passkeys", tr: "مفاتيح (ال)?مرور" },
  { en: "accounts", tr: "حساب" },
  { en: "addresses", tr: "عنوان|عناوين" },
  { en: "network fee", tr: "رسوم (ال)?شبكة" },
  { en: "fee", tr: "رسوم" },
  { en: "hardware wallet", tr: "محفظة عتادية|المحفظة العتادية|محافظ عتادية|المحافظ العتادية" },
  { en: "hardware wallets", tr: "محافظ عتادية|المحافظ العتادية" },
  { en: "collectible", tr: "مقتن" },
  { en: "collectibles", tr: "مقتن" },
  { en: "stake", tr: "تخزين|خزّن", except: ["explore.trade.polymarket.note", "m.explore.trade.polymarket.note"] }, // why: "your whole stake" = the money bet, not staking
  { en: "unstake", tr: "إلغاء (ال)?تخزين" },
  { en: "unreadable request", tr: "طلب\\S* غير (ال)?مقروء" },
  { en: "unreadable requests", tr: "طلبات غير مقروءة|الطلبات غير المقروءة" },
  { en: "look-alike address", tr: "عنوان (ال)?مشابه|العنوان المشابه" },
  { en: "look-alike addresses", tr: "عناوين (ال)?مشابهة|العناوين المشابهة" },
  { en: "scammers", tr: "محتال" },
  { en: "approve", tr: "موافق|واف|توافق|يوافق" },
  { en: "reject", tr: "رفض" },
  { en: "connected apps", tr: "التطبيقات المتصلة" },
  { en: "notifications", tr: "إشعار" },
  { en: "notification", tr: "إشعار" },
  { en: "price alerts", tr: "تنبيه\\S* (ال)?(سعر|أسعار)" },
  { en: "Secure Trade", tr: "Secure Trade" },
  { en: "Advanced mode", tr: "(ال)?وضع (ال)?متقد[ّ]?م" },
  { en: "contacts", tr: "جه(ة|ات) (ال)?اتصال" },
];
export default glossary;
