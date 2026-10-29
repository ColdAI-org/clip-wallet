---
"@clip-wallet/security": patch
"@clip-wallet/chains-evm": patch
"@clip-wallet/ui": patch
"@clip-wallet/mobile-kit": patch
---

App permissions now list single-NFT ERC-721 approvals (`approve(spender, tokenId)`) while `getApproved` still names
the app and you still own the NFT, and remove them with `approve(0x0, tokenId)`. The permissions screens say these in
the user's language, and the approval for `approve(0x0, tokenId)` reads as removing a permission.
