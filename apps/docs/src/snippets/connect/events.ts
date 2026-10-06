import { connect } from "@clip-wallet/connect";

const wallet = await connect();

const stopAccounts = wallet.on("accountsChanged", (accounts) => console.log("now", accounts)); // CAIP-10 ids
const stopChain = wallet.on("chainChanged", (chain) => console.log("chain", chain)); // "eip155:84532"
wallet.on("disconnect", () => console.log("disconnected"));

// Later: stop listening, then end the session (revokes the site's permission where the wallet supports it).
stopAccounts();
stopChain();
await wallet.disconnect();
