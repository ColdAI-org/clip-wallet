/**
 * Japanese mobile catalog. Glossary (same as the UI catalog in packages/ui/src/i18n/ja):
 *   wallet → ウォレット, recovery phrase → リカバリーフレーズ, password → パスワード, passkey → パスキー,
 *   backup → バックアップ, restore → 復元, unlock → ロック解除, lock → ロック, device → 端末,
 *   account → アカウント, address → アドレス, asset → 資産, coin → コイン, token → トークン,
 *   collectible → コレクティブル, balance → 残高, amount → 数量 (money in fiat: 金額), fee → 手数料,
 *   network → ネットワーク, send → 送金, receive → 受け取る, swap → スワップ, buy → 購入,
 *   stake → ステーキング, unstake → ステーキング解除, rewards → 報酬, liquidity → 流動性,
 *   approve → 承認, reject → 拒否, accept (a trade) → 承諾, request → リクエスト, sign → 署名,
 *   connect → 接続, disconnect → 接続を解除, connected apps → 接続中のアプリ, contacts → 連絡先,
 *   handle → ハンドル, publish → 公開, notifications → 通知, price alert → 価格アラート,
 *   activity → アクティビティ, settings → 設定, explore → 探す, discover → ディスカバー,
 *   hardware wallet → ハードウェアウォレット, advanced mode → 詳細モード, bridged → ブリッジ済み,
 *   look-alike address → よく似たアドレス, trade → 取引, exchange → 取引所, QR code → QRコード,
 *   "Didn't go through" → 完了しませんでした, transaction → 取引 (same word as trade), scam → 詐欺,
 *   scammer → 詐欺師, suspicious (token) → 不審な, unreadable request → 読み取れないリクエスト,
 *   permission → 権限, spam → スパム, phone → スマートフォン.
 *   Kept verbatim: Clip Wallet, Clip (Clip ハンドル), Secure Trade, WalletConnect, Ledger, Ledger Live,
 *   Keystone, Face ID, Touch ID, MetaMask, Phantom, Google, Apple, asset symbols, network names,
 *   CoinGecko, DEX Screener, on-device menu labels (e.g. 「Connect Software Wallet」).
 *   Mobile extras: browse (tab) → ブラウズ, biometrics → 生体認証, in-app browser → アプリ内ブラウザ.
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
import settle from "./settle";

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
  ...settle,
};
export default messages;
