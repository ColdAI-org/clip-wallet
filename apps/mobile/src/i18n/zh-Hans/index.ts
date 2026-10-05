/**
 * Simplified Chinese mobile catalog. Same glossary as the UI catalog (packages/ui/src/i18n/zh-Hans):
 *   wallet → 钱包, recovery phrase → 助记词, passkey → 通行密钥, password → 密码, account → 账户,
 *   address → 地址, network → 网络, asset → 资产, token → 代币, coin → 币, collectible → 收藏品,
 *   collection → 系列, send → 发送, receive → 接收, buy → 购买, swap → 兑换, stake → 质押,
 *   unstake → 解除质押, rewards → 奖励, trade (Secure Trade) → 交易, transaction → 交易,
 *   approve → 批准, reject → 拒绝, sign → 签署 (signature → 签名), request → 请求, connect → 连接,
 *   disconnect → 断开连接, connected apps → 已连接的应用, hardware wallet → 硬件钱包, backup → 备份,
 *   restore → 恢复, lock / unlock → 锁定 / 解锁, handle → 用户名 (Clip handle → Clip 用户名),
 *   contact → 联系人, notification → 通知, price alert → 价格提醒, fee → 手续费, bridged → 跨链桥接,
 *   liquidity → 流动性, pool → 资金池, look-alike address → 相似地址, suspicious token → 可疑代币,
 *   scammer → 诈骗者, Advanced mode → 高级模式, Activity → 活动, Explore → 探索, Discover → 发现,
 *   Home → 首页, Settings → 设置, pin → 置顶, QR code → 二维码, chain id → 链 ID, publish → 公开,
 *   "Checking…" by context → 正在核对… (against the written-down phrase) / 正在验证… (sign-in link) /
 *   正在检查… (lookups: handle, plugin, Bluetooth), "Address" of the in-app browser bar → 网址 (a URL, not a wallet address).
 * Kept verbatim (never translated): Clip Wallet, Clip, Secure Trade, WalletConnect, Ledger, Ledger Live, Keystone,
 *   Face ID, Touch ID, MetaMask, Phantom, Google, Apple, CoinGecko, DEX Screener, network names (Ethereum,
 *   Bitcoin, Solana, Hedera, Base, Arbitrum…; "Ethereum-style" → "Ethereum 类", never 以太坊), asset symbols
 *   (ETH, USDC, HBAR, SOL, BTC), PRF, EVM, and labels shown on a device's own screen (quoted, in English).
 * Style: "你"; full-width punctuation; a half-width space between Chinese and Latin words, numbers and
 * {variables} (e.g. "发送 {amount} {symbol}"), none next to full-width punctuation. Exception: no space around a
 * {variable} that always holds Chinese text (e.g. "你的{account}" in approval.connect.lede).
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
};
export default messages;
