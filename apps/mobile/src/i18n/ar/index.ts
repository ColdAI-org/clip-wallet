/**
 * Arabic mobile catalog (right-to-left), same glossary as the UI catalog (packages/ui/src/i18n/ar). Glossary (keep these consistent everywhere, including the UI catalog):
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
import security from "./security";
import plugins from "./plugins";

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
  ...security,
  ...plugins,
};
export default messages;
