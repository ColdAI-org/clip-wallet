import { connect } from "@clip-wallet/connect";

const wallet = await connect({ chains: [84532, 11155111] });

// Before you show a "Pay" button: can this person pay at all, and how?
const check = await wallet.canPay({ asset: "usdc", amount: "25" });
if (!check.ok) console.log("Not enough USDC anywhere we can reach.");
else if (check.how === "balance") console.log("They hold enough on", check.chain);
else console.log("The wallet can bring the money in on", check.chain); // check.how === "auxiliaryFunds"

// Balances by asset key, summed over your chains. Assets with nothing anywhere are left out.
const balances = await wallet.balances();
const usdc = balances.usdc;
if (usdc) console.log(`${usdc.formatted} ${usdc.symbol}`, usdc.byChain); // "25.5 USDC", { "eip155:84532": 25500000n }
