import { connect } from "@clip-wallet/connect";

const wallet = await connect({ families: ["solana"] });
const solana = wallet.accounts.find((a) => a.startsWith("solana:"))!; // "solana:EtWT…:9xQe…" (devnet)
const [namespace, reference] = solana.split(":");

// Wallet Standard features by name. Params are the feature's own input objects.
const account = wallet.standard[0]!.accounts[0]!;
const [signed] = await wallet.request<{ signature: Uint8Array }[]>({
  chain: `${namespace}:${reference}`,
  method: "solana:signMessage",
  params: [{ account, message: new TextEncoder().encode("Sign in to example.app") }],
});
console.log(signed!.signature.length); // 64
