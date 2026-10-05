/**
 * Arabic UI catalog (right-to-left). Glossary (keep these consistent everywhere, including the mobile catalog later):
 *   wallet → محفظة, recovery phrase → عبارة الاسترداد, password → كلمة المرور, passkey → مفتاح المرور,
 *   backup → نسخة احتياطية / النسخ الاحتياطي, restore → استعادة, lock / unlock → قفل / فتح القفل,
 *   account → حساب, address → عنوان, network → شبكة, asset → أصل (أصول), coin → عملة, token → رمز (رموز),
 *   collectible → مقتنى (مقتنيات), send → إرسال, receive → استلام, swap → مبادلة, buy → شراء,
 *   stake / unstake → تخزين / إلغاء التخزين, rewards → مكافآت, fee → رسوم, network fee → رسوم الشبكة,
 *   balance → رصيد, amount → المبلغ, approve / reject → موافقة / رفض, sign → توقيع, request → طلب,
 *   unreadable request → طلب غير مقروء, connected apps → التطبيقات المتصلة, connect / disconnect → اتصال / قطع الاتصال,
 *   hardware wallet → محفظة عتادية, Advanced mode → الوضع المتقدّم, activity → النشاط, settings → الإعدادات,
 *   contact → جهة اتصال, handle (Clip handle) → معرّف (معرّف Clip), claim a handle → حجز, publish → نشر,
 *   look-alike address → عنوان مشابه, scammer → محتال, notification → إشعار, price alert → تنبيه سعر,
 *   liquidity → سيولة, pool → مجمّع, trending → رائج, bridged → عبر جسر, slippage → الحد الأقصى لتغيّر السعر,
 *   price impact → تأثير السعر, trade (Secure Trade) → صفقة / تداول, exchange (platform) → منصة تداول,
 *   QR code → رمز QR, Explore → استكشاف, Discover → اكتشاف,
 *   plugin → مكوّن إضافي (المكوّنات الإضافية), permission → إذن (أذونات), spam → مزعج, suspicious → مشبوه.
 *   Brand, product, device and network names and asset symbols (Secure Trade, WalletConnect, Ledger, Keystone,
 *   Face ID, ETH…) stay in Latin script, verbatim.
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
  ...security,
  ...settle,
};
export default messages;
