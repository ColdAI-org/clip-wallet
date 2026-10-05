/** A dapp built on Clip Connect (@clip-wallet/connect): connect, read capabilities, pay 25 USDC on Base Sepolia. */
import { connect, type ClipConnection, type PayResult } from "@clip-wallet/connect";

const SHOP = "0x00000000000000000000000000000000c0ffee01";
let c: ClipConnection | undefined;
let paid: PayResult | undefined;

const steps: Record<string, () => Promise<unknown>> = {
  connect: async () => {
    c = await connect({ chains: [84532] });
    return { wallet: c.wallet.name, preferred: c.wallet.preferred, accounts: c.accounts.map((a) => a.split(":").slice(0, 2).join(":")) };
  },
  capabilities: async () => c!.capabilities([84532, 11155111]),
  pay: async () => {
    paid = await c!.pay({ asset: "usdc", amount: "25", to: SHOP, chain: 84532 });
    return { method: paid.method, auxiliaryFunds: paid.auxiliaryFunds, fallback: paid.fallback ?? null, id: /^0x[0-9a-f]{64}$/.test(paid.id) };
  },
  wait: async () => paid!.wait({ pollMs: 200, timeoutMs: 30_000 }).then((r) => ({ status: r.status, txs: r.transactionHashes.length })),
};

(window as unknown as { __dapp: unknown }).__dapp = { run: (s: string) => steps[s]!() };
