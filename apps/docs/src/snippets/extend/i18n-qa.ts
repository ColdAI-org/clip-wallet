// The checks every catalog passes in CI, run on a new language (Polish here). Test-only: @clip-wallet/i18n/qa.
import { checkTranslation, formatMessage } from "@clip-wallet/i18n";
import { checkGlossary, lintCatalog, type GlossaryEntry } from "@clip-wallet/i18n/qa";

const en = {
  "send.title": "Send {symbol}",
  "approvals.count": "{n, plural, one {# request is waiting} other {# requests are waiting}}",
  "backup.phrase": "Write down your recovery phrase. {name} can't show it again without your password.",
};

const pl = {
  "send.title": "Wyślij {symbol}",
  "approvals.count": "{n, plural, one {# prośba czeka} few {# prośby czekają} many {# próśb czeka} other {# prośby czeka}}",
  "backup.phrase": "Zapisz frazę odzyskiwania. {name} nie pokaże jej ponownie bez Twojego hasła.",
};

const glossary: readonly GlossaryEntry[] = [{ en: "recovery phrase", tr: "fraz(a|ę|y) odzyskiwania" }];

const problems = [
  ...checkTranslation(en, pl, "pl", ["Clip Wallet"]), // same ids, arguments and tags; protected terms kept
  ...lintCatalog(en, pl, "pl"), // plural categories exist in Polish; renders for 0, 1, 2, 5, 22, 1.5 …
  ...checkGlossary(en, pl, "pl", glossary), // the same term → the same translation everywhere
];
console.log(problems); // []

console.log(formatMessage(pl["approvals.count"], { n: 5 }, "pl")); // "5 próśb czeka"
