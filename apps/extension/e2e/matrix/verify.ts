/**
 * Signature checks that need Node (the ecosystem's own verifier depends on Node streams / buffers). The dapp page
 * returns the signature material; the test verifies it here with that ecosystem's library.
 */
import verifyDataSignature from "@cardano-foundation/cardano-verify-datasignature";

export type NodeVerify = { kind: "cip8"; signature: string; key: string; message: string; address: string };

export function verifyInNode(v: NodeVerify): { valid: boolean; how: string } {
  switch (v.kind) {
    case "cip8":
      return { valid: verifyDataSignature(v.signature, v.key, v.message, v.address), how: "@cardano-foundation/cardano-verify-datasignature (CIP-8 COSE_Sign1, message and address checked)" };
  }
}
