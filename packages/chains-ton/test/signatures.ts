/**
 * Signature fixtures, computed once offline with a throwaway ed25519 key that was discarded afterwards
 * (AGENTS.md rule 1: no signing code outside packages/vault, tests included). Only the public key and
 * signatures live here; the requests are in scenarios.ts and the clock is pinned (helpers.ts NOW), so the
 * payloads are fixed. When they were made, the first-use external message finalize() built was byte-identical
 * to the one @ton/ton's own secret-key path (WalletContractV5R1.createTransfer) builds for the same transfer.
 */
export const FIX = {
  "publicKey": "4ab9e5d394a7d21e58523aa1c1175a8ae372747ca61112a0a1943f45ef74081d",
  "sigs": [
    "186ed76ce6a868c85e12d4973f5e030df3d8c3ace24b3011f074d42f7c66f7216b8d14db662d6347837adc863fdfa1bb54e97816596b431825cfc681e76c8f08",
    "4fac9a923c271f86be7e4a3cb58560a794b2035753a27191246d43bf25b665070c2cc3d65927ac6a2a676827c9e5f57f50a1ea0c2a7d48deed85d99cfd68f503",
    "2bbf919c3b0b2ba2b4592ddf126a1007d01225f4300645276b2291a9512f9721078a360c221dd15fd723df3ab9a4f741c67d6e45861bd30dc3a0083835d9fb02",
    "ae5020d5495ae6257f1cafc809eaeb8a10884462de169b2ffc3587aac9613cffb2f03924ba7aadc2c66fbee57789104f1a32f34553a3a622ab96533c37f93808",
    "71315ae53fd4e94ff9dda08c924e7839c71b34cf2e5139209be3734b85812187cc28ac5504805c9b55094cf535a5648913f58fa9c3869967c3f6326fb1bd950c",
    "a68706c210805cc9faeb24baae59079819a1733818fe0e23e4f6b3cefcebfb8270dbdcbd29cf6529e1fdffbf44309040d541444825c8229ff0854e40986d2607",
    "2ddc46af87bfd4d0bc6a48f6ffdb295a7ab96d49f89c71eb566c6651f7d0e4240969427a598d76170d95050e6ba669ac93f6fe7f49645cd09af5a9bfc956ce0e"
  ]
} as const;
