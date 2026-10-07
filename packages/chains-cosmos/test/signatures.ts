/**
 * Signatures computed once OFFLINE (a scratch script outside the repo) by the vault's own signing code
 * (packages/vault/src/sign.ts signEcdsa: RFC 6979, low-S) with account 0 of the public BIP-39 test vector
 * ("abandon" ×11 + "about"), over the prepare() digests of test/scenarios.ts allScenarios(). Only signatures are here.
 */
export const SIGS: Record<string, string> = {
  "cosmos:cosmos_signAndBroadcast:0": "81d0b3fc78f06485f2cf0acb380cb573d09cf84a2613edfb3925c6826fc7de0b08ac3582db3ea00cc742fefa5250423453319827b634ae09a3c8b5941945e3a6",
  "initia:cosmos_signAndBroadcast:1": "879a74bf03cc59de5c6f07987f820f58c4dc421e0b26c5ae04ed4c7188f4f3f15bd1349f0eee317ce84cf7c3406982c88f423afbeaaa8bf5f92622eed2cef655",
  "thorchain:cosmos_signAndBroadcast:2": "9454eca73f1d465424ee29e134735e38dcbbc7886893052f08633041442eb4122d63cac24b924e1f21bedad436204448e4c5588f0bae4d91c539dba194f6b28b",
  "provenance:cosmos_signAndBroadcast:3": "b729d7b22bc18247edf53dac6d74739d3c7ea6dc5ba711445cfa0b8746d9724e317ae4851c679fc27b744fb771e35f082082741c75e9148e3f5d31719d8f18fe",
  "cosmos:cosmos_signDirect:4": "5274bd61e149325b9dd2e3c31e7515edcce8f3ad69d9527e78fd5a9875e98fa44986446fd9ba87ac6cc57173cb40e64af0c7d03ec411329f38f233e2985e0ec3",
  "cosmos:cosmos_signAmino:5": "879a5410bfad7f15aef725ce276a79ebfc0a351f041fe64592c9b817ebdba21d3e90721948977ea98e9dbbeca2ce5d2947ed8665967914bd9d9c902bc643f8b0",
  "cosmos:cosmos_signArbitrary:6": "a4786f269c72793e501a6c38dba60e8d2fcf0329dcdeab8f41940f83357b51de3d1dbea596e2c4151eb2b6ab71cddb5c7bd5f29f3eb7e322ea19c0db40a76a0c",
  "initia:cosmos_signArbitrary:7": "9ff4a773c25f9d9be29fc33f6a249a41c4afd79655ea0b4914b68a0d73bb040e00ced84e5f56ad7ffab828871e2bc78c62757b4cd7dd06bd6cf82bd7ad47bc40"
};
