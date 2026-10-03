/**
 * Response shapes captured from the public testnet endpoints (horizon-testnet.stellar.org,
 * soroban-testnet.stellar.org) on 2026-10-03 with curl, trimmed. `_links` dropped from Horizon records.
 *  - simulateTransfer: simulateTransaction of a native-XLM SAC transfer(me → bob, 1 XLM) (FIX.soroban).
 *  - submitFailed / sendError: the unsigned FIX.payment envelope (tx_bad_auth), harmless.
 */
export const meAccount = {
  "id": "GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX",
  "account_id": "GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX",
  "sequence": "8680382308286645",
  "subentry_count": 2,
  "thresholds": {
    "low_threshold": 0,
    "med_threshold": 0,
    "high_threshold": 0
  },
  "flags": {
    "auth_required": false,
    "auth_revocable": false,
    "auth_immutable": false,
    "auth_clawback_enabled": false
  },
  "balances": [
    {
      "balance": "0.0000000",
      "limit": "922337203685.4775807",
      "buying_liabilities": "0.0000000",
      "selling_liabilities": "0.0000000",
      "last_modified_ledger": 2244867,
      "is_authorized": true,
      "is_authorized_to_maintain_liabilities": true,
      "asset_type": "credit_alphanum4",
      "asset_code": "USDC",
      "asset_issuer": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    },
    {
      "balance": "0.0000000",
      "limit": "922337203685.4775807",
      "buying_liabilities": "0.0000000",
      "selling_liabilities": "0.0000000",
      "last_modified_ledger": 3479241,
      "is_authorized": true,
      "is_authorized_to_maintain_liabilities": true,
      "asset_type": "credit_alphanum4",
      "asset_code": "USDC",
      "asset_issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    },
    {
      "balance": "19931.6990286",
      "buying_liabilities": "0.0000000",
      "selling_liabilities": "0.0000000",
      "asset_type": "native"
    }
  ],
  "signers": [
    {
      "weight": 1,
      "key": "GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX",
      "type": "ed25519_public_key"
    }
  ],
  "data": {},
  "num_sponsoring": 0,
  "num_sponsored": 0
};

export const notFound = {
  "type": "https://stellar.org/horizon-errors/not_found",
  "title": "Resource Missing",
  "status": 404,
  "detail": "The resource at the url requested was not found.  This usually occurs for one of two reasons:  The url requested is not valid, or no data in our database could be found with the parameters provided."
};

export const feeStats = {
  "last_ledger": "4999230",
  "last_ledger_base_fee": "100",
  "ledger_capacity_usage": "0.09",
  "fee_charged": {
    "max": "609464",
    "min": "100",
    "mode": "100",
    "p10": "100",
    "p20": "100",
    "p30": "6885",
    "p40": "8698",
    "p50": "11582",
    "p60": "17217",
    "p70": "42788",
    "p80": "74439",
    "p90": "101117",
    "p95": "194279",
    "p99": "609464"
  },
  "max_fee": {
    "max": "10040404",
    "min": "100",
    "mode": "1121441",
    "p10": "600",
    "p20": "19462",
    "p30": "33910",
    "p40": "36520",
    "p50": "62262",
    "p60": "544744",
    "p70": "1000000",
    "p80": "1121441",
    "p90": "10026787",
    "p95": "10026853",
    "p99": "10040404"
  }
};

export const simulateTransfer = {
  "transactionData": "AAAAAAAAAAEAAAAGAAAAAdeSi3LCcDzP6vfrn/TvTVBKVai5efybRQ6iyEK00c5hAAAAFAAAAAEAAAACAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAAAAAAAAAAdpHYUEisxO0IXZBhzglIu9995qkreQqvJB0xt9yqQjgAAzHUAAABIAAAASAAAAAAAABbpA==",
  "events": [
    "AAAAAQAAAAAAAAAAAAAAAgAAAAAAAAADAAAADwAAAAdmbl9jYWxsAAAAAA0AAAAg15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAAPAAAACHRyYW5zZmVyAAAAEAAAAAEAAAADAAAAEgAAAAAAAAAAdpHYUEisxO0IXZBhzglIu9995qkreQqvJB0xt9yqQjgAAAASAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAAAAoAAAAAAAAAAAAAAAAAmJaA",
    "AAAAAQAAAAAAAAAB15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAABAAAAAAAAAAQAAAAPAAAACHRyYW5zZmVyAAAAEgAAAAAAAAAAdpHYUEisxO0IXZBhzglIu9995qkreQqvJB0xt9yqQjgAAAASAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAAAA4AAAAGbmF0aXZlAAAAAAAKAAAAAAAAAAAAAAAAAJiWgA==",
    "AAAAAQAAAAAAAAAB15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAACAAAAAAAAAAIAAAAPAAAACWZuX3JldHVybgAAAAAAAA8AAAAIdHJhbnNmZXIAAAAB"
  ],
  "minResourceFee": "23460",
  "results": [
    {
      "auth": [
        "AAAAAAAAAAAAAAAB15KLcsJwPM/q9+uf9O9NUEpVqLl5/JtFDqLIQrTRzmEAAAAIdHJhbnNmZXIAAAADAAAAEgAAAAAAAAAAdpHYUEisxO0IXZBhzglIu9995qkreQqvJB0xt9yqQjgAAAASAAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAAAAoAAAAAAAAAAAAAAAAAmJaAAAAAAA=="
      ],
      "xdr": "AAAAAQ=="
    }
  ],
  "stateChanges": [
    {
      "type": "updated",
      "key": "AAAAAAAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQ==",
      "before": "AEtoCQAAAAAAAAAAAZRyYo7njrknFNItA5CWPCTZJ+oAmZlIbokfrC2qnCEAAAAZHZQfEAAGn2QAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "after": "AAAAAAAAAAAAAAAAAZRyYo7njrknFNItA5CWPCTZJ+oAmZlIbokfrC2qnCEAAAAZHiy1kAAGn2QAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAA"
    },
    {
      "type": "updated",
      "key": "AAAAAAAAAAB2kdhQSKzE7QhdkGHOCUi7333mqSt5Cq8kHTG33KpCOA==",
      "before": "AErWaAAAAAAAAAAAdpHYUEisxO0IXZBhzglIu9995qkreQqvJB0xt9yqQjgAAAAuaDfpTgAe1sMAAAC1AAAAAgAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAwAAAAAAStZoAAAAAGq5kasAAAAA",
      "after": "AAAAAAAAAAAAAAAAdpHYUEisxO0IXZBhzglIu9995qkreQqvJB0xt9yqQjgAAAAuZ59SzgAe1sMAAAC1AAAAAgAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAwAAAAAAStZoAAAAAGq5kasAAAAA"
    }
  ],
  "latestLedger": 4999234
};

export const submitFailed = {
  "type": "https://stellar.org/horizon-errors/transaction_failed",
  "title": "Transaction Failed",
  "status": 400,
  "detail": "The transaction failed when submitted to the stellar network. The `extras.result_codes` field on this response contains further details.  Descriptions of each code can be found at: https://developers.stellar.org/api/errors/http-status-codes/horizon-specific/transaction-failed/",
  "extras": {
    "envelope_xdr": "AAAAAgAAAAB2kdhQSKzE7QhdkGHOCUi7333mqSt5Cq8kHTG33KpCOAAAAGQAHtbDAAAAtgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAABlHJijueOuScU0i0DkJY8JNkn6gCZmUhuiR+sLaqcIQAAAAAAAAAAAJiWgAAAAAAAAAAA",
    "result_codes": {
      "transaction": "tx_bad_auth"
    },
    "result_xdr": "AAAAAAAAAGT////6AAAAAA=="
  }
};

export const sendError = {
  "errorResultXdr": "AAAAAAAAAGT////6AAAAAA==",
  "status": "ERROR",
  "hash": "596790513a3992860fe8da4f3c4b8ce1fb2c58e261b785ed63d5bfa8a71bac50",
  "latestLedger": 4999236,
  "latestLedgerCloseTime": "1791019767"
};

export const getTxNotFound = {
  "latestLedger": 4999236,
  "latestLedgerCloseTime": "1791019767",
  "oldestLedger": 4878277,
  "oldestLedgerCloseTime": "1790414972",
  "status": "NOT_FOUND",
  "txHash": "0000000000000000000000000000000000000000000000000000000000000001",
  "applicationOrder": 0,
  "feeBump": false,
  "events": {},
  "ledger": 0,
  "createdAt": "0"
};

