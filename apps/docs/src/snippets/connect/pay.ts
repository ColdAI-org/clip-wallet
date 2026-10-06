import { connect, type PayResult } from "@clip-wallet/connect";

const wallet = await connect({ chains: [84532, 11155111] });

// Say what, how much and to whom. Clip Connect picks the chain: where the user holds enough, else where the
// wallet says it can bring the money in (ERC-7682 auxiliary funds).
const result: PayResult = await wallet.pay({ asset: "usdc", amount: "25", to: "0x000000000000000000000000000000000000dEaD" });

switch (result.fallback) {
  case undefined:
    console.log("Sent as wallet_sendCalls with auxiliary funds on", result.chain);
    break;
  case "no-auxiliary-funds":
    console.log("The wallet speaks EIP-5792 but can't bring money in on", result.chain);
    break;
  case "no-eip5792":
    console.log("A plain eth_sendTransaction: the balance on", result.chain, "must cover it");
    break;
}

// Polls wallet_getCallsStatus (or the receipt) until the payment is final. Default timeout: 10 minutes.
const { status } = await result.wait({ timeoutMs: 5 * 60_000, pollMs: 3_000 });
console.log(status);
