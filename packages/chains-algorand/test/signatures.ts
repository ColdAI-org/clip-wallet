/**
 * Signature fixtures, computed once OFFLINE (outside the repo) from the public BIP-39 test vector
 * ("abandon" x11 + "about", empty passphrase) with ARC-52 BIP32-Ed25519 (Peikert, g = 9) at m/44'/283'/0'/0/0, this
 * module's default derivationPath(0), using the reference @algorandfoundation/xhd-wallet-api 1.0.3 (keyGen +
 * signAlgoTransaction). Before use, the same script reproduced the xHD-Wallet-API-ts spec vector ("salon zoo …",
 * m/44'/283'/0'/0/0 → 7bda7ac1…fab9) and the Pera Universal Wallet vector ("champion say …" → RP35URKA…OFX7A).
 * Every signature also verifies as plain Ed25519 against `publicKey`.
 *
 * AGENTS.md rule 1: no key or signing code outside packages/vault, tests included, so only the public key,
 * addresses, unsigned transaction bytes (base64 msgpack) and signatures live here.
 *
 * Testnet suggested params: firstValid 67902000, lastValid 67903000, fee = min fee 1000 µALGO.
 *  - pay: 1.5 ALGO me → bob                    - usdc: 2.5 USDC (ASA 10458941) me → bob
 *  - optIn: 0 USDC me → me (opt-in)              - groupPay + groupCall: one group, 1 ALGO to app 123456's address +
 *    app call arc200_transfer(bob, 5000) (fee 2000)
 *  - forOther: 0.1 ALGO from `other` (an account rekeyed to me, signed with authAddr = me) → bob
 * paySigned / forOtherSigned are the expected SignedTxn msgpack (algosdk SignedTransaction encoding).
 * bob / other are arbitrary addresses (sha512_256 of a label); nobody holds their keys.
 * slip10Me / slip10PublicKey: the same phrase under the `scheme: "slip10"` option (SLIP-10 m/44'/283'/0'/0'/0',
 * Trust Wallet), documented only.
 */
export const FIX = {
  "me": "ACJDJWM7GWMKJFROZP2VSWZBP5FLSSMMMFXL5MPLZQRPQFARUKKRLAZ53E",
  "publicKey": "009234d99f3598a4962ecbf5595b217f4ab9498c616ebeb1ebcc22f81411a295",
  "bob": "HTMZXUPSU5ZA7QKAEZXDMPQFO3VFABDIDIEVQRN7PWRM4R5ZQFBQGQMDGU",
  "other": "CR6DMQ7RT6VNVDFCYE67HYQ7V66VNZRHJXZKD7MAZTHCXMQ7AYLCZVTK6I",
  "appAddress": "NT4CBDVACSANU27N7PHDQQVOL4AKTVGGMIWUXBV676LGNDEB66PQ3GYD4I",
  "pay": "iaNhbXTOABbjYKNmZWXNA+iiZnbOBAwaMKNnZW6sdGVzdG5ldC12MS4womdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqJsds4EDB4Yo3JjdsQgPNmb0fKncg/BQCZuNj4FdupQBGgaCVhFv32izke5gUOjc25kxCAAkjTZnzWYpJYuy/VZWyF/SrlJjGFuvrHrzCL4FBGilaR0eXBlo3BheQ==",
  "paySig": "b5b8497349c22774c5c1362f6c3760107746f9e2c63d5a7503afab040551a06f80d7ebd0a13d12b309eeedaddc0bb51670579cfbe2c440601122cae5d3d94903",
  "usdc": "iqRhYW10zgAmJaCkYXJjdsQgPNmb0fKncg/BQCZuNj4FdupQBGgaCVhFv32izke5gUOjZmVlzQPoomZ2zgQMGjCjZ2VurHRlc3RuZXQtdjEuMKJnaMQgSGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiKibHbOBAweGKNzbmTEIACSNNmfNZikli7L9VlbIX9KuUmMYW6+sevMIvgUEaKVpHR5cGWlYXhmZXKkeGFpZM4An5c9",
  "usdcSig": "a0e693ab71d86562f6a7113775d09da239a6c27fda38c8ec10cdd510afa28088cefd797bde8e814654ddf1ebd64e6c8ce0e95fcfea48fdd17836d7b25c9dc408",
  "optIn": "iaRhcmN2xCAAkjTZnzWYpJYuy/VZWyF/SrlJjGFuvrHrzCL4FBGilaNmZWXNA+iiZnbOBAwaMKNnZW6sdGVzdG5ldC12MS4womdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqJsds4EDB4Yo3NuZMQgAJI02Z81mKSWLsv1WVshf0q5SYxhbr6x68wi+BQRopWkdHlwZaVheGZlcqR4YWlkzgCflz0=",
  "optInSig": "a2bacfe93f6cc28a7ff5b45275f38004c1cae5705977e3deadd08d7e7f5612acf344a473cccfeb480774f5ea766a2dd3d8ee833bdd83b25389623fa7fe9a3506",
  "groupPay": "iqNhbXTOAA9CQKNmZWXNA+iiZnbOBAwaMKNnZW6sdGVzdG5ldC12MS4womdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqNncnDEIFK3hTj0f+hZa1WTAJS5I4iTBirGPafzVO+DajWgLKJxomx2zgQMHhijcmN2xCBs+CCOoBSA2mvt+844Qq5fAKnUxmItS4a+/5ZmjIH3n6NzbmTEIACSNNmfNZikli7L9VlbIX9KuUmMYW6+sevMIvgUEaKVpHR5cGWjcGF5",
  "groupPaySig": "1a832db3d4e2fe7dfb2b4a5b8cd117d810150bcc7782c203b91a9ea828e773490a0da8a53197cc46c61bfe70851722c10d66e977706db88cabc589fc755e1901",
  "groupCall": "iqRhcGFhk8QE2nAlucQgPNmb0fKncg/BQCZuNj4FdupQBGgaCVhFv32izke5gUPEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOIpGFwaWTOAAHiQKNmZWXNB9CiZnbOBAwaMKNnZW6sdGVzdG5ldC12MS4womdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqNncnDEIFK3hTj0f+hZa1WTAJS5I4iTBirGPafzVO+DajWgLKJxomx2zgQMHhijc25kxCAAkjTZnzWYpJYuy/VZWyF/SrlJjGFuvrHrzCL4FBGilaR0eXBlpGFwcGw=",
  "groupCallSig": "fc97fb0b2e4c525e79b8711a224f05069f64099183db9053126c020f61fd229524cca066ef383f401e88d5f2f2146cc6bd83e70632336792ba456584b8a8e30e",
  "forOther": "iaNhbXTOAAGGoKNmZWXNA+iiZnbOBAwaMKNnZW6sdGVzdG5ldC12MS4womdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqJsds4EDB4Yo3JjdsQgPNmb0fKncg/BQCZuNj4FdupQBGgaCVhFv32izke5gUOjc25kxCAUfDZD8Z+q2oyiwT3z4h+vvVbmJ03yof2AzM4rsh8GFqR0eXBlo3BheQ==",
  "forOtherSig": "3ee8c9c9f0746b16c845c0e9651b2b8e3ad7b1344bf50d59e8d92f063b8edcdd989e0bdafae8ee3b1facc0c72541ee3658ac0109669f4d3a2768ed788de14d09",
  "payBytesToSign": "545889a3616d74ce0016e360a3666565cd03e8a26676ce040c1a30a367656eac746573746e65742d76312e30a26768c4204863b518a4b3c84ec810f22d4f1081cb0f71f059a7ac20dec62f7f70e5093a22a26c76ce040c1e18a3726376c4203cd99bd1f2a7720fc140266e363e0576ea5004681a095845bf7da2ce47b98143a3736e64c420009234d99f3598a4962ecbf5595b217f4ab9498c616ebeb1ebcc22f81411a295a474797065a3706179",
  "payTxId": "TLAFJTSTCLYNKT6JGN4LAK3R6SSRAM2BXME2PDCFUMK3GLUL762A",
  "optInTxId": "3G5Q77MJHXKMFX2NUHO6SKQEYAUHY3IOSLJDTC7ZF2Z74MIR3LXQ",
  "groupPayTxId": "NMAVJR4HNGX4YDDO6U3ZO7N6545DQV2E2I7OBYMLN7FYBOKN2S5Q",
  "paySigned": "gqNzaWfEQLW4SXNJwid0xcE2L2w3YBB3Rvnixj1adQOvqwQFUaBvgNfr0KE9ErMJ7u2t3Au1FnBXnPvixEBgESLK5dPZSQOjdHhuiaNhbXTOABbjYKNmZWXNA+iiZnbOBAwaMKNnZW6sdGVzdG5ldC12MS4womdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqJsds4EDB4Yo3JjdsQgPNmb0fKncg/BQCZuNj4FdupQBGgaCVhFv32izke5gUOjc25kxCAAkjTZnzWYpJYuy/VZWyF/SrlJjGFuvrHrzCL4FBGilaR0eXBlo3BheQ==",
  "forOtherSigned": "g6RzZ25yxCAAkjTZnzWYpJYuy/VZWyF/SrlJjGFuvrHrzCL4FBGilaNzaWfEQD7oycnwdGsWyEXA6WUbK44617E0S/UNWejZLwY7jtzdmJ4L2vro7jsfrMDHJUHuNlisAQlmn006J2jteI3hTQmjdHhuiaNhbXTOAAGGoKNmZWXNA+iiZnbOBAwaMKNnZW6sdGVzdG5ldC12MS4womdoxCBIY7UYpLPITsgQ8i1PEIHLD3HwWaesIN7GL39w5Qk6IqJsds4EDB4Yo3JjdsQgPNmb0fKncg/BQCZuNj4FdupQBGgaCVhFv32izke5gUOjc25kxCAUfDZD8Z+q2oyiwT3z4h+vvVbmJ03yof2AzM4rsh8GFqR0eXBlo3BheQ==",
  "slip10Me": "EP2D7TV7IAFANZHK3B6QLKB53N5UTD7RARVXZTWCPCRQQBKYVGM2XIMT2Q",
  "slip10PublicKey": "23f43fcebf400a06e4ead87d05a83ddb7b498ff1046b7ccec278a3080558a999"
} as const;
