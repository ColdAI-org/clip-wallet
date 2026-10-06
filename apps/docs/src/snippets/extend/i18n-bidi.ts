// Arabic (and any right-to-left language): wrap every interpolated value in U+2068 FSI … U+2069 PDI, so an address
// or an amount can't reorder the sentence around it.
import { FSI, PDI, unisolatedArguments } from "@clip-wallet/i18n/qa";

const wrong = "أرسل {amount} {symbol} إلى {to}";
const right = `أرسل ${FSI}{amount}${PDI} ${FSI}{symbol}${PDI} إلى ${FSI}{to}${PDI}`;

console.log(unisolatedArguments(wrong)); // ["amount", "symbol", "to"]
console.log(unisolatedArguments(right)); // []
// In source files, write the marks as escapes ("⁨{amount}⁩") so they stay visible in review.
