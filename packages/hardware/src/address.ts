/**
 * The address a hardware account receives at, derived here from its public key (audit HW-01). Account records can
 * come from a page that ran the device or from a Keystone QR, so the keyring never takes their `address` on trust:
 * a wrong one would send the user's incoming funds elsewhere. Public data only, and light (no device SDKs).
 */
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, bech32 } from "@scure/base";
import { decodeXpub, derivePublic } from "./bip32pub.js";
import { equal, fromHex } from "./bytes.js";
import { evmAddress } from "./evm.js";
import type { HardwareAccount } from "./types.js";

const BIP84 = /^m\/84'\/([01])'\/(\d+)'\/([01])\/(\d+)$/;

/**
 * The account's address from its public key and path, or undefined if the record can't have one.
 *  - evm: EIP-55 address of the secp256k1 key.
 *  - solana: base58 of the Ed25519 key.
 *  - bitcoin: P2WPKH (BIP-84) of the compressed key; mainnet for coin type 0, testnet/signet ("tb") for 1. When the
 *    record carries the account xpub, the key must be the xpub's child at the path's change/index.
 *  - hedera: "" (an Ed25519 Hedera key has no address of its own; the account id is looked up, never taken from
 *    the record).
 */
export function hardwareAddress(a: Pick<HardwareAccount, "family" | "publicKey" | "hardware">): string | undefined {
  const pub = fromHex(a.publicKey);
  switch (a.family) {
    case "evm":
      return evmAddress(pub);
    case "solana":
      return pub.length === 32 ? base58.encode(pub) : undefined;
    case "bitcoin": {
      const m = BIP84.exec(a.hardware.path);
      if (!m || pub.length !== 33) return undefined;
      const [, coin, account, change, index] = m;
      const hw = a.hardware;
      if (hw.accountPath !== undefined && hw.accountPath !== `m/84'/${coin}'/${account}'`) return undefined;
      if (hw.change !== undefined && hw.change !== Number(change)) return undefined;
      if (hw.addressIndex !== undefined && hw.addressIndex !== Number(index)) return undefined;
      if (hw.accountXpub !== undefined) {
        let child: Uint8Array;
        try {
          child = derivePublic(decodeXpub(hw.accountXpub), [Number(change), Number(index)]).publicKey;
        } catch {
          return undefined;
        }
        if (!equal(child, pub)) return undefined;
      }
      return bech32.encode(coin === "0" ? "bc" : "tb", [0, ...bech32.toWords(ripemd160(sha256(pub)))]);
    }
    case "hedera":
      return "";
    default:
      return undefined;
  }
}

/** `claimed` is the derived address (EVM: compared without case; the stored form is EIP-55). */
export function sameAddress(family: HardwareAccount["family"], claimed: string, derived: string): boolean {
  return family === "evm" ? claimed.toLowerCase() === derived.toLowerCase() : claimed === derived;
}
