// Stand-in for react-native-fast-pbkdf2, which @ton/crypto-primitives' React Native build requires inside
// pbkdf2_sha512 (TON mnemonic → key). The wallet never derives keys there: the vault does, with its own
// BIP-39 code. If anything ever calls it, fail loudly instead of bundling a native module we don't use.
module.exports = {
  default: {
    derive() {
      throw new Error("pbkdf2 is not available here: key derivation happens in the vault.");
    },
  },
};
