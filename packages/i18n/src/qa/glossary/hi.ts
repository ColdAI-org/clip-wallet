/**
 * Must-match glossary for hi: every message whose English uses `en` must contain `tr` (a case-insensitive
 * regex, so inflected forms can match a stem). Mirrors the glossary comment in packages/ui/src/i18n/hi/index.ts.
 */
import type { GlossaryEntry } from "../lint.js";

const glossary: readonly GlossaryEntry[] = [
  // “Connect Software Wallet” is the Keystone's own menu label, kept verbatim in English.
  { en: "wallet", tr: "वॉलेट", except: ["hardware.keystone.step1"] },
  { en: "recovery phrase", tr: "रिकवरी फ़्रेज़" },
  { en: "passkey", tr: "पासकी" },
  { en: "account", tr: "अकाउंट" },
  { en: "accounts", tr: "अकाउंट" },
  { en: "address", tr: "एड्रेस" },
  { en: "network fee", tr: "नेटवर्क शुल्क" },
  { en: "hardware wallet", tr: "हार्डवेयर वॉलेट" },
  { en: "hardware wallets", tr: "हार्डवेयर वॉलेट" },
  { en: "collectible", tr: "कलेक्टिबल" },
  { en: "collectibles", tr: "कलेक्टिबल" },
  { en: "unstake", tr: "अनस्टेक" },
  { en: "unreadable request", tr: "न पढ़ी जा सकने वाली रिक्वेस्ट" },
  { en: "look-alike", tr: "मिलत[ाे]-जुलत[ाे]" },
  { en: "scammers", tr: "धोखेबाज़" },
  { en: "suspicious", tr: "संदिग्ध" },
  { en: "approve", tr: "मंज़ूर" },
  { en: "reject", tr: "अस्वीकार" },
  { en: "connected apps", tr: "कनेक्टेड ऐप्स" },
  { en: "notifications", tr: "नोटिफ़िकेशन" },
  { en: "price alerts", tr: "प्राइस अलर्ट" },
  { en: "Secure Trade", tr: "Secure Trade" },
  { en: "Advanced mode", tr: "एडवांस्ड मोड" },
];
export default glossary;
