import { keccak_256 } from "@noble/hashes/sha3.js";
import { concat, utf8 } from "./util.js";

/**
 * TronWeb `trx.signMessageV2` / `Trx.verifyMessageV2` (TIP-104 "Data Signing", TIP-191-compatible 0x19 prefix):
 * keccak256("\x19TRON Signed Message:\n" ‖ decimal byte length ‖ message), signature r ‖ s ‖ v with v = 27 + recovery.
 * Source: tronweb src/utils/message.ts (`TRON_MESSAGE_PREFIX`, `hashMessage`, `signMessage` via ethers SigningKey +
 * joinSignature): https://github.com/tronprotocol/tronweb/blob/master/src/utils/message.ts and
 * https://github.com/tronprotocol/tips/blob/master/tip-104.md. The legacy `signMessage` (v1, fixed "32" length,
 * hex-only input) isn't offered: its length field is wrong for anything but 32-byte messages.
 */
export const TRON_MESSAGE_PREFIX = "\x19TRON Signed Message:\n";

export function messageHash(message: Uint8Array): Uint8Array {
  return keccak_256(concat(utf8(TRON_MESSAGE_PREFIX), utf8(String(message.length)), message));
}
