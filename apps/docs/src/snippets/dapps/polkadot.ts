// Polkadot SDK chains: @polkadot/extension-dapp reads window.injectedWeb3, where Clip Wallet is "clip-wallet".
import { web3Accounts, web3Enable, web3FromSource } from "@polkadot/extension-dapp";
import { stringToHex } from "@polkadot/util";

export async function connectPolkadot() {
  const extensions = await web3Enable("Example app"); // asks each extension once
  if (!extensions.some((e) => e.name === "clip-wallet")) throw new Error("Clip Wallet isn't installed in this browser.");
  const [account] = await web3Accounts({ extensions: ["clip-wallet"], ss58Format: 42 });
  if (!account) throw new Error("No account shared with this site.");

  const injector = await web3FromSource(account.meta.source);
  const { signature } = await injector.signer.signRaw!({ address: account.address, data: stringToHex("Sign in to example.app"), type: "bytes" });
  return { address: account.address, signature };
}

// Transactions: pass injector.signer to @polkadot/api, e.g.
//   api.tx.balances.transferKeepAlive(dest, amount).signAndSend(account.address, { signer: injector.signer })
