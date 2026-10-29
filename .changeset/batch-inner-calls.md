---
"@clip-wallet/chains-evm": patch
"@clip-wallet/chains-hedera": patch
---

EVM: multicall(bytes[]), multicall(uint256,bytes[]), aggregate3 and the Universal Router's execute are read step by
step (three levels deep, 32 calls at most). Each step is listed as "Action n" and its warnings carry up to the
request. One step that can't be read makes the whole request unreadable. Universal Router plans are read for commands
0x00–0x0e; any other command is unreadable. A simulated preview now lists the permissions a transaction gives: Approval
and ApprovalForAll from your account. An allowance that only goes down is not listed. Hedera: a ContractExecute
multicall is read the same way.
