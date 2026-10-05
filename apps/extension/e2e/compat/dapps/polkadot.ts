/** An unmodified Polkadot dapp: @polkadot/extension-dapp web3Enable + web3Accounts. */
import { web3Accounts, web3Enable } from "@polkadot/extension-dapp";

const steps: Record<string, () => Promise<unknown>> = {
  enable: async () => {
    const exts = await web3Enable("compat dapp");
    return { extensions: exts.map((e) => ({ name: e.name, version: typeof e.version, signer: typeof e.signer?.signPayload })) };
  },
  accounts: async () => {
    const list = await web3Accounts();
    return { accounts: list.map((a) => ({ source: a.meta.source, type: a.type ?? null, address: a.address.length > 40 ? "ss58" : "short" })) };
  },
};

(window as unknown as { __compat: unknown }).__compat = { run: (s: string) => steps[s]!() };
