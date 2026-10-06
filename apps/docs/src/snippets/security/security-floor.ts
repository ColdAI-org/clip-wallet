// The security floor has no switch. A mainnet configuration that tries to lower it is refused.
import { securityFloorProblems } from "@clip-wallet/security";

console.log(securityFloorProblems({ testnet: false, threat: { openLists: false, newContractDays: 0 } }));
// [
//   "threat.openLists: the open phishing lists can't be switched off on mainnet",
//   "threat.newContractDays: new-contract cautions can't be switched off on mainnet"
// ]
