import { connect } from "@clip-wallet/connect";

const wallet = await connect({ chains: [84532] });

// Any EVM JSON-RPC method, on any chain the wallet has. Clip Connect switches the chain first if it must.
const blockNumber = await wallet.request<string>({ chain: 84532, method: "eth_blockNumber" });

const [, , address] = wallet.accounts[0]!.split(":");
const signature = await wallet.request<string>({
  chain: "eip155:84532",
  method: "personal_sign",
  params: ["0x48656c6c6f2066726f6d206578616d706c652e617070", address], // "Hello from example.app"
});
console.log(blockNumber, signature);
