/**
 * XRP Ledger (testnet, xrpl:1): XLS-72d Browser Wallet Standard discovery exactly as @xrpl-wallet-standard/app's
 * getRegisterdXRPLWallets does it (getWallets() filtered by REQUIRED_FEATURES: standard:connect, standard:events,
 * xrpl:signTransaction, xrpl:signAndSubmitTransaction), then xrpl:signAndSubmitTransaction with options.autofill.
 *
 * L2 (sign a message) doesn't exist: XLS-72d has no message-signing feature, so there's no `sign` step.
 * L3 is a no-op AccountSet carrying a memo, not "1 drop to yourself": rippled refuses an XRP Payment to the sending
 * account (temREDUNDANT), so it never reaches a ledger. The AccountSet costs only the fee and changes nothing.
 */
import { getWallets } from "@wallet-standard/app";
import { NeedsFunds, expose, waitFor } from "../dapp-kit";

const RPC = "https://s.altnet.rippletest.net:51234/";
/** @xrpl-wallet-standard/core REQUIRED_FEATURES (packages/core/src/utils.ts). */
const REQUIRED_FEATURES = ["standard:connect", "standard:events", "xrpl:signTransaction", "xrpl:signAndSubmitTransaction"] as const;
type F = Record<string, any>;

let wallet: ReturnType<ReturnType<typeof getWallets>["get"]>[number];
let account: (typeof wallet)["accounts"][number];

async function rpc(method: string, params: Record<string, unknown>) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method, params: [params] }) });
  return ((await res.json()) as { result: Record<string, any> }).result;
}

expose({
  info: {
    dapp: "XLS-72d Wallet Standard discovery (@wallet-standard/app + the @xrpl-wallet-standard/app filter) in a local page, testnet",
    why: "@xrpl-wallet-standard/app only wraps getWallets() with that filter but pulls in xrpl.js and an alpha Xahau fork; the page runs the same filter",
  },
  steps: {
    connect: async () => {
      const xrpl = () => getWallets().get().filter((w) => REQUIRED_FEATURES.every((f) => f in w.features));
      wallet = await waitFor(() => xrpl().find((w) => w.name === "Clip Wallet"), "Clip Wallet (XRPL)");
      const r = await (wallet.features as F)["standard:connect"].connect();
      account = r.accounts[0]!;
      return { address: account.address, chains: wallet.chains };
    },
    send: async () => {
      const info = await rpc("account_info", { account: account.address, ledger_index: "current" });
      if (info.status === "error") throw new NeedsFunds(`the account isn't activated on testnet yet (${String(info.error)})`);
      const tx_json = { TransactionType: "AccountSet", Account: account.address, Memos: [{ Memo: { MemoData: Array.from(new TextEncoder().encode("clip dapp matrix"), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase() } }] };
      const r = await (wallet.features as F)["xrpl:signAndSubmitTransaction"].signAndSubmitTransaction({ tx_json, account, network: "xrpl:1", options: { autofill: true } });
      const result = r.tx_json?.meta?.TransactionResult;
      if (r.tx_json?.validated && result !== "tesSUCCESS") throw new Error(`the ledger answered ${result}`);
      return { id: r.tx_hash, validated: !!r.tx_json?.validated };
    },
  },
});
