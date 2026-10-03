/**
 * Signature fixtures, computed once OFFLINE (outside the repo) from the public BIP-39 test vector
 * "abandon abandon … about" (empty passphrase), SLIP-10 ed25519 at m/44'/148'/0' (SEP-0005). The derived
 * address matches SEP-0005 "Test 5" (GB3J…QBYX). Only the address, payload bytes and signatures live here;
 * no key material (AGENTS.md rule 1).
 *
 *  - payment: testnet, 10 XLM me → bob, seq 8680382308286645 (+1), fee 100, timebounds 0..1790000300
 *    (exactly what buildTransfer produces with the meAccount fixture and now = 1_790_000_000_000).
 *  - soroban: native-XLM SAC transfer(me → bob, 1 XLM), unprepared (as sent to simulateTransaction).
 *  - authEntry: SEP-43 HashIdPreimage (ENVELOPE_TYPE_SOROBAN_AUTHORIZATION), testnet, nonce 42,
 *    expires at ledger 5,000,000, native SAC transfer(me → bob, 1 XLM); signature over sha256(preimage XDR).
 *  - message: SEP-53, signature over sha256("Stellar Signed Message:\n" + message).
 */
export const FIX = {
  "me": "GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX",
  "bob": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7",
  "sequence": "8680382308286645",
  "maxTime": 1790000300,
  "payment": "AAAAAgAAAAB2kdhQSKzE7QhdkGHOCUi7333mqSt5Cq8kHTG33KpCOAAAAGQAHtbDAAAAtgAAAAEAAAAAAAAAAAAAAABqsTysAAAAAAAAAAEAAAAAAAAAAQAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAAAAAAAAAABfXhAAAAAAAAAAAA",
  "paymentSig": "6d8f5cdb879135a9b15d36704ae479f2a389ba9d6f38a555772685205d11d85985e3c1fd9b08b1f6fffd121c4358a7ae3ecf6480da388835c2404f13ea434902",
  "soroban": "AAAAAgAAAAB2kdhQSKzE7QhdkGHOCUi7333mqSt5Cq8kHTG33KpCOAAAAGQAHtbDAAAAtgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAAB15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAAIdHJhbnNmZXIAAAADAAAAEgAAAAAAAAAAdpHYUEisxO0IXZBhzglIu9995qkreQqvJB0xt9yqQjgAAAASAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAAAAoAAAAAAAAAAAAAAAAAmJaAAAAAAAAAAAAAAAAA",
  "sorobanSig": "367973818dbb4067357afe33f8ca9679af20355950e86e6bfa95873b34093e0cc75938497e69d217bc3910c17e173505b74c70408b8f2b64c81e1d436acdda0e",
  "authEntry": "AAAACc7gMC1ZhE0yvcqRXIID3USzP7t+3BkFHqN6vt8o7NRyAAAAAAAAACoATEtAAAAAAAAAAAHXkotywnA8z+r365/0701QSlWouXn8m0UOoshCtNHOYQAAAAh0cmFuc2ZlcgAAAAMAAAASAAAAAAAAAAB2kdhQSKzE7QhdkGHOCUi7333mqSt5Cq8kHTG33KpCOAAAABIAAAAAAAAAAAGUcmKO5465JxTSLQOQljwk2SfqAJmZSG6JH6wtqpwhAAAACgAAAAAAAAAAAAAAAACYloAAAAAA",
  "authEntrySig": "d1af456105fdeddd69b9bf627605131b53c3c72a03a804a7e864b7d0603ed7c1ca8ee903880226421d8f9dc3ebe980d3b1fa467646c6d08ea52a45729c659e06",
  "message": "Sign in to app.example",
  "messageSig": "939701f50983d24fd6151c40f6b8ede7cda871c7aa6b0a7498e64feec72b9fb886cfe3d5dc1785c0d7ed94c0e4ff958febf6be10662b052f51f59832ea52950e"
} as const;
