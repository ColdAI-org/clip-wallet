/**
 * No Solidity workspace in this template: the dapp talks to Hedera's system contracts (externalContracts.ts).
 * If you add packages/foundry or packages/hardhat later, its deploy script fills this file.
 */
import { GenericContractsDeclaration } from "~~/utils/scaffold-hbar/contract";

const deployedContracts = {} as const;

export default deployedContracts satisfies GenericContractsDeclaration;
