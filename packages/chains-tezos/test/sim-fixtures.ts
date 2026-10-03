/**
 * simulate_operation responses captured from shadownet (rpc.shadownet.teztnets.com, protocol PsUshuai, Oct 2026)
 * for the public test account tz1VQA4…h5GL. Operation fields are trimmed to kind + metadata (the mock echoes the
 * request's own contents back around them). `empty` is the HTTP 500 error list for a never-funded account.
 */
export const SIM = {
  "xtz": {
    "contents": [
      {
        "kind": "transaction",
        "metadata": {
          "operation_result": {
            "status": "applied",
            "balance_updates": [
              {
                "kind": "contract",
                "contract": "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
                "change": "-1000000",
                "origin": "block"
              },
              {
                "kind": "contract",
                "contract": "tz1cJ9Bi4ygAYUvL31fmMCgK2GmWiTQ6ioGP",
                "change": "1000000",
                "origin": "block"
              }
            ],
            "consumed_milligas": "2168854"
          }
        }
      }
    ]
  },
  "alloc": {
    "contents": [
      {
        "kind": "transaction",
        "metadata": {
          "operation_result": {
            "status": "applied",
            "balance_updates": [
              {
                "kind": "contract",
                "contract": "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
                "change": "-1000000",
                "origin": "block"
              },
              {
                "kind": "contract",
                "contract": "tz1LHBqjkR1QoJ1k2uukvSVaXGrpkBLZhG48",
                "change": "1000000",
                "origin": "block"
              },
              {
                "kind": "contract",
                "contract": "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
                "change": "-64250",
                "origin": "block"
              },
              {
                "kind": "burned",
                "category": "storage fees",
                "change": "64250",
                "origin": "block"
              }
            ],
            "consumed_milligas": "2168854",
            "allocated_destination_contract": true
          }
        }
      }
    ]
  },
  "delegate_stake": {
    "contents": [
      {
        "kind": "delegation",
        "metadata": {
          "operation_result": {
            "status": "applied",
            "consumed_milligas": "170868"
          }
        }
      },
      {
        "kind": "transaction",
        "metadata": {
          "operation_result": {
            "status": "applied",
            "balance_updates": [
              {
                "kind": "staking",
                "category": "delegator_numerator",
                "delegator": "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
                "change": "925077",
                "origin": "block"
              },
              {
                "kind": "staking",
                "category": "delegate_denominator",
                "delegate": "tz1N29q5T3jJ2i1JEWHax7q1NRkDMADj6fof",
                "change": "925077",
                "origin": "block"
              },
              {
                "kind": "contract",
                "contract": "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
                "change": "-1000000",
                "origin": "block"
              },
              {
                "kind": "freezer",
                "category": "deposits",
                "staker": {
                  "contract": "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
                  "delegate": "tz1N29q5T3jJ2i1JEWHax7q1NRkDMADj6fof"
                },
                "change": "1000000",
                "origin": "block"
              }
            ],
            "consumed_milligas": "3560040"
          }
        }
      }
    ]
  },
  "empty": [
    {
      "kind": "branch",
      "id": "proto.025-PsUshuai.implicit.empty_implicit_contract",
      "implicit": "tz1LHBqjkR1QoJ1k2uukvSVaXGrpkBLZhG48"
    }
  ],
  "fa2_fail": {
    "contents": [
      {
        "kind": "transaction",
        "metadata": {
          "operation_result": {
            "status": "failed",
            "errors": [
              {
                "kind": "temporary",
                "id": "proto.025-PsUshuai.michelson_v1.runtime_error",
                "contract_handle": "KT1Mi8MejYS9agBUnhuHGHSvLf6ZVuwMgsM3",
                "contract_code": "Deprecated"
              },
              {
                "kind": "temporary",
                "id": "proto.025-PsUshuai.michelson_v1.script_rejected",
                "location": 903,
                "with": {
                  "string": "FA2_INSUFFICIENT_BALANCE"
                }
              }
            ]
          }
        }
      }
    ]
  },
  "low": {
    "contents": [
      {
        "kind": "transaction",
        "metadata": {
          "operation_result": {
            "status": "failed",
            "errors": [
              {
                "kind": "temporary",
                "id": "proto.025-PsUshuai.contract.balance_too_low",
                "contract": "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL",
                "balance": "18151262",
                "amount": "999000000000"
              },
              {
                "kind": "temporary",
                "id": "proto.025-PsUshuai.tez.subtraction_underflow",
                "amounts": [
                  "18151262",
                  "999000000000"
                ]
              }
            ]
          }
        }
      }
    ]
  },
  "stake_nodelegate": {
    "contents": [
      {
        "kind": "transaction",
        "metadata": {
          "operation_result": {
            "status": "failed",
            "errors": [
              {
                "kind": "permanent",
                "id": "proto.025-PsUshuai.operations.stake_modification_with_no_delegate_set"
              }
            ]
          }
        }
      }
    ]
  }
} as const;
