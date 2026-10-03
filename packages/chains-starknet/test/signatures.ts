/**
 * Signature fixtures, computed once offline with a throwaway Stark key that was discarded afterwards
 * (AGENTS.md rule 1: no signing code outside packages/vault, tests included). Only the public key (x), the
 * account addresses and [r || s] signatures live here, keyed by the payload (hex) they sign. Payloads are
 * fixed because the mocked RPC returns a fixed fee estimate and nonce (see helpers.ts):
 *
 *  - OpenZeppelin, first use: DEPLOY_ACCOUNT v3 + INVOKE v3 (nonce 1) sending 2.5 USDC to BOB
 *  - OpenZeppelin, deployed at nonce 7: INVOKE v3 sending 1 STRK to BOB
 *  - SNIP-12 revision 1 TYPED_DATA (helpers.ts)
 *  - Argent 0.4.0, first use: DEPLOY_ACCOUNT v3 + INVOKE v3 sending 2.5 USDC to BOB
 *
 * When they were made, both first-use pairs (exact bodies finalize() sent) were simulated on Starknet Sepolia
 * with validation on (starknet_simulateTransactions, SKIP_FEE_CHARGE only) and accepted, so the transaction
 * hashes match the network's; a corrupted signature is refused there ("invalid signature").
 */
export const FIX = {
  "publicKey": "05ea3f21cf86313f91a6ac6cd00dafaefc8e1caac76ddf7cbf113a71354ab04b",
  "address": "0x048401b784bec323163553a02802c5b58dd579c9296207f9b26d6bcd75af4f37",
  "argentAddress": "0x02340f6513dd00ca3b604b3e8fff6a425a9cd3d966d974fc9e8c0bc396fefa1b",
  "sigs": {
    "01e81a6701f15c9d13a992a9654a308be4976583aef06cac02188b2aa3090825": "076eb3befa0e3a2b400d70307651c1c905c20ac61b7943526468920cc6f86a1b04fb9fe5e9027722583d8836dc94011f04e779018ff036643c08060cf9390425",
    "07a2f5c6f0b0c36ba67c2f508fffa3dc81a3f4d9a58b7a4b51e20269b3c06d69": "00b3611f4f8c46f3304bf7aa15c7ec2d80c8b6f27585a55bfd9d592b4a267c6305e813934894288328feba219f4189cd8148a67cf1c591b68f601bc844a6064e",
    "079ba03f4ce9929bf8c76c3a9bd40000cac83299e05c8c72d4c46c03f4046987": "07c34ea2beadb0215c45f0f67ba60b7c857928f8825d58453ffb8b6d2ce1b14e06963e341a437d209c9bc74b02b7f08697b0603db6ba2b61daf491b893f37dbe",
    "059ec845f9572cbcb8494eaed11b44ef833b022563c9dee3e89346e1ddae6b0c": "03df9d3aec3a7e177c590476800278fe3231b3ac83d04707da5bf02b7178ec3300ceb68a7810e76872922728aa3247737c04826818782d407250ca5960ac9b00",
    "07bfb751c1ec702da8e67f0e6b059286a75aa8da2153ec60622e0095ac8905b6": "0418d52f5da191747661335f0e6eb4cf2019cb074734249a040508f7ecb8e35502a9a408d4a488b6c605b246d01e077c1a9c570036b45b5f9eb4d685b43a0f34",
    "0607c2379f1bc53a62f18865ab579b30fca4b0bc30d22dbdd7e753bb73e45939": "01e547a16cac595a6fd7e41cedb640875136c61614bb32ec05eda92fd0abe51801ceb26a2bbc48f6d89a17d199d6fe03ef7c463376b756660981ba06d57237ef"
  }
} as const;
