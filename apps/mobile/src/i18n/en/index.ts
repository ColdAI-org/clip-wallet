/**
 * The mobile app's English catalog (ids "m.<namespace>.<name>"). Shared wording with the extension lives in
 * @clip-wallet/ui's catalog; the phone has its own screens, so its own strings.
 */
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
import stake from "./stake";
import swap from "./swap";
import buy from "./buy";
import trade from "./trade";
import backup from "./backup";
import accounts from "./accounts";
import hardware from "./hardware";

export const en = {
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
  ...stake,
  ...swap,
  ...buy,
  ...trade,
  ...backup,
  ...accounts,
  ...hardware,
};

export const MOBILE_NAMESPACES = ['common', 'onboarding', 'home', 'collectibles', 'activity', 'receive', 'scan', 'browser', 'kit', 'app', 'send', 'approval', 'settings', 'explore', 'social', 'stake', 'swap', 'buy', 'trade', 'backup', 'accounts', 'hardware'] as const;

export type MobileMessages = typeof en;
export type MobileMessageId = keyof MobileMessages;
