---
"@clip-wallet/chains-evm": patch
"@clip-wallet/core": patch
---

`transfer`, `transferFrom` and `approve` on a contract that isn't curated no longer read as a token amount just
because `decimals()` answers. The contract is also asked ERC-165 `supportsInterface(0x80ac58cd)` and `ownerOf(value)`:
when it holds that NFT the request reads as NFT #value, and when it answers both ways the request carries a caution
(`bg.warn.tokenOrNft`, in every language) that it could be an amount or one NFT.
