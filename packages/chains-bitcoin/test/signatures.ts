/**
 * Signatures over the fixture digests, made offline (outside this repository) from the BIP-39 test vector
 * "abandon … about": ECDSA with the BIP-84 key m/84'/0'/0'/0/0, Schnorr with the BIP-86 key m/86'/0'/0'/0/0
 * tweaked per BIP-341 with an empty merkle root, i.e. exactly what @clip-wallet/vault's sign() does for the
 * payloads prepare() returns (taprootTweak = merkle root). The P2WPKH signature is byte-identical to the one
 * @scure/btc-signer's own signer produced, so our BIP-143 digest equals the library's sighash code path.
 * No key material is in this repository.
 */
export const SEND_PSBT =
  "cHNidP8BAJoCAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAAAAAAD9////zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMwAAAAAAP3///8CwNQBAAAAAAAWABQ+NJhdym/dyfs2mUDkx9jihz9SnKRzAAAAAAAAFgAUwM681sPTyox13F7GLr5VMw75EOIAAAAAAAEBH6CGAQAAAAAAFgAUwM681sPTyox13F7GLr5VMw75EOIAAQErUMMAAAAAAAAiUSCmCGnw288dxlnJzsuvgFATXqnozcSHBT8dxogJSdxoTAEXIMyKS8ZNiXvdxfvC9nD3qLoLOGd5EGzxIjxvxdfNb8EVAAAA";

/** [0] ECDSA r||s for the P2WPKH input, [1] BIP-340 signature for the P2TR key-path input. */
export const SEND_SIGS = [
  "05d1075e60d0bc1f08f023158deeb6158436862adb0bf6608897f2e4d586fb43167557a0360a489ba04ce92dc343c6b7da88dbf478ef5fc2c9016fea5a200a4b",
  "fa0edf63a0d9572fc5ed1ab3aa269f5436a1b5f5b5001ade7ab7d7441074b875d828ad2e175e6b37c6162d3b2a4426a6f91004508171ddc15fb1906f9a6cc5b1",
] as const;

/** "Hello Clip". ECDSA ones are recovery byte || r || s. */
export const MSG_SIGS = {
  wpkh: "0136e70524a0ef818617768e33c89ef2166e6fe8171edb5678f0e58645ff3b6aa15089b5723b2b861eaf29820dab9c378f4a428ceb44e67d86730ebce8728690f0",
  tr: "04a5003c661458494b9586c23b7c658988bfa0f1dcfcd992b9c0c9fbae4d5a2312061ae5f33b37ce9061407c5d8c3338e614d2b818a26716989c2c73801f760b",
  ecdsa: "009e7cb4a9266a6a95da2b4fa03106fc73debd16cce49cc1c407b1c0077c8cedda53d9ae6f667129136962b7acca43c9f5aa79c0f72fa2effd9d6344db65ff16e6",
} as const;

/** ECDSA r||s over the change-input digest in change.test.ts, made offline with the change key m/84'/0'/0'/1/1. */
export const CHANGE_SPEND_SIG = "57488cd0a856c15d98c8145503ad6654a27599f2852e6c60f5ea83b9329144df5520629edff64cf0e5f43698be00446f0bd5a0a7eced0bc30c6e65bce7ade0d6";
