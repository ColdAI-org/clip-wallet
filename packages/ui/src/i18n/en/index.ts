/**
 * The English UI catalog: one file per namespace (a screen or area), merged here. English is the source of
 * truth: every other locale must translate exactly these ids (typecheck + test/i18n.test.ts enforce it).
 */
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
import security from "./security";
import plugins from "./plugins";
import settle from "./settle";

export const en = {
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
  ...security,
  ...plugins,
  ...settle,
};

/** Namespaces in the order above; each locale folder has one file per namespace. */
export const UI_NAMESPACES = ['common', 'settings', 'onboarding', 'backup', 'home', 'collectibles', 'activity', 'receive', 'accounts', 'approvals', 'components', 'stake', 'swap', 'buy', 'trade', 'hardware', 'send', 'approval', 'explore', 'social', 'security', 'plugins', 'settle'] as const;

export type UiMessages = typeof en;
export type UiMessageId = keyof UiMessages;
