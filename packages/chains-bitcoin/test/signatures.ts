/**
 * Signatures over the fixture digests, made offline by the BIP-39 test-vector key ("abandon … about",
 * m/84'/0'/0'/0/0). The PSBT input signatures were produced by @scure/btc-signer's own signer, so the
 * tests also check that our per-input digests equal the library's independent sighash code path.
 * No key material is in this repository.
 */
export const SEND_PSBT =
  "cHNidP8BAJoCAAAAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqAAAAAAD9////zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMwAAAAAAP3///8CwNQBAAAAAAAWABQ+NJhdym/dyfs2mUDkx9jihz9SnKRzAAAAAAAAFgAUwM681sPTyox13F7GLr5VMw75EOIAAAAAAAEBH6CGAQAAAAAAFgAUwM681sPTyox13F7GLr5VMw75EOIAAQErUMMAAAAAAAAiUSA9p3fmaWV8jYeJ1qijibWS7IkCsGUdT6kAcix8m4ok5wEXIDDVT9DdQgpuX402JPXzSCyuNQ951fB1O/W+75wtka88AAAA";

/** [0] ECDSA r||s for the P2WPKH input, [1] BIP-340 signature for the P2TR key-path input. */
export const SEND_SIGS = [
  "05d1075e60d0bc1f08f023158deeb6158436862adb0bf6608897f2e4d586fb43167557a0360a489ba04ce92dc343c6b7da88dbf478ef5fc2c9016fea5a200a4b",
  "1049803874a8d54be414d1aa49d290e851c5d05487f3cba498cc8f8c8d09d43475b6e9ffd844a8cbda548a53353b943c463187c23235fe12b071e579b6238003",
] as const;

/** "Hello Clip". ECDSA ones are recovery byte || r || s. */
export const MSG_SIGS = {
  wpkh: "0136e70524a0ef818617768e33c89ef2166e6fe8171edb5678f0e58645ff3b6aa15089b5723b2b861eaf29820dab9c378f4a428ceb44e67d86730ebce8728690f0",
  tr: "6a19d3145d0d0819a4cededc4b5ae4d0d19277a91178df61f41c7e4c67b80547999ad1137e8ca05092b47aca5fdeaff1db8b3efa23f1ba927b874441a51297c4",
  ecdsa: "009e7cb4a9266a6a95da2b4fa03106fc73debd16cce49cc1c407b1c0077c8cedda53d9ae6f667129136962b7acca43c9f5aa79c0f72fa2effd9d6344db65ff16e6",
} as const;
