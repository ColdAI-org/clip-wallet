/**
 * Signature fixtures, computed once offline (outside this repository) by the public BIP-39 test-vector account
 * ("abandon … about") at Sui's default path m/44'/784'/0'/0'/0'. AGENTS.md rule 1: no signing code outside
 * packages/vault, tests included, so only the address, public key, transaction bytes and serialized signatures
 * (flag 0x00 || ed25519 signature || public key, base64) live here. The tests only verify them.
 *
 *  - transfer: SplitCoins(gas, 1.5 SUI) + TransferObjects → bob; gas price 1000, budget 0.003 SUI, fixed gas object
 *  - swap: SplitCoins(gas, 0.1 SUI) + MoveCall 0xabab…::pool::swap_exact_a_for_b (decode only)
 *  - stake: SplitCoins(gas, 2 SUI) + 0x3::sui_system::request_add_stake (decode only)
 *  - messageSig: sui:signPersonalMessage over "Hello Sui"
 */
export const FIX = {
  "me": "0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1",
  "publicKey": "900b4d81eecea3df2f74b14200c4f4cf3f49afaca7a634ffd2cf6ff82bdaecf2",
  "bob": "0xb0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0",
  "transfer": "AAACAAgAL2hZAAAAAAAgsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLACAgABAQAAAQEDAAAAAAEBAF6TpzbQT7slc3qkC+5AFx73n2X66DN0njwIn+fMIWHxATMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzBwAAAAAAAAAgAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQFek6c20E+7JXN6pAvuQBce959l+ugzdJ48CJ/nzCFh8egDAAAAAAAAwMYtAAAAAAAA",
  "transferSig": "AAIpYyueAkNPPd8OPziLTwwgGNL5Z+mwKjyq0rOgE26wxakEmJtHxaKHn9e6ihm5d54Gy6EdH+4H0GeasWrkSQaQC02B7s6j3y90sUIAxPTPP0mvrKemNP/Sz2/4K9rs8g==",
  "swap": "AAACAAgA4fUFAAAAAAAIAQAAAAAAAAACAgABAQAAAKurq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urBHBvb2wSc3dhcF9leGFjdF9hX2Zvcl9iAQcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgNzdWkDU1VJAAIDAAAAAAEBAF6TpzbQT7slc3qkC+5AFx73n2X66DN0njwIn+fMIWHxATMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzBwAAAAAAAAAgAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQFek6c20E+7JXN6pAvuQBce959l+ugzdJ48CJ/nzCFh8egDAAAAAAAAwMYtAAAAAAAA",
  "swapSig": "APQJbK7QsDDwv0EG2qu7f0X3WmZ4yGU13aeJmKNR3VotAgOR7HkoFuqWnVI6B8SmTy9sJ4VCHc8vfhELUkQj2Q6QC02B7s6j3y90sUIAxPTPP0mvrKemNP/Sz2/4K9rs8g==",
  "stake": "AAADAAgAlDV3AAAAAAEBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUBAAAAAAAAAAEAIFpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaAgIAAQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwpzdWlfc3lzdGVtEXJlcXVlc3RfYWRkX3N0YWtlAAMBAQADAAAAAAECAF6TpzbQT7slc3qkC+5AFx73n2X66DN0njwIn+fMIWHxATMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzBwAAAAAAAAAgAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQFek6c20E+7JXN6pAvuQBce959l+ugzdJ48CJ/nzCFh8egDAAAAAAAAwMYtAAAAAAAA",
  "messageSig": "AAgr+crKu8zEwcckBBcLaPZwpwcK5nlTU2B5KmmymTqyf4IWeV/ZnHlogrVNgrbz/FSsId+bFFXTwlAWo2WnbgaQC02B7s6j3y90sUIAxPTPP0mvrKemNP/Sz2/4K9rs8g=="
} as const;
