/**
 * Unsigned transactions captured from the Nile full node (POST /wallet/createtransaction, /wallet/triggersmartcontract,
 * /wallet/freezebalancev2, /wallet/unfreezebalancev2, /wallet/delegateresource, /wallet/votewitnessaccount,
 * /wallet/accountpermissionupdate) for the public "abandon … about" account TUEZ…GWYdH. Nothing here was signed or sent.
 */
export const NILE_TX = {
  "transfer": {
    "visible": true,
    "txID": "a758dc1787a24ecfca5f9622e7ce36c663ce7328f6aedf166bae5bdc181e0a6d",
    "raw_data": {
      "ref_block_bytes": "4f15",
      "ref_block_hash": "d5efcd3acb235c24",
      "expiration": 1791285828000,
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
              "to_address": "TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK",
              "amount": 1500000
            },
            "type_url": "type.googleapis.com/protocol.TransferContract"
          },
          "type": "TransferContract"
        }
      ],
      "timestamp": 1791285769056
    },
    "raw_data_hex": "0a024f152208d5efcd3acb235c2440a0b3d28791345a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541c8599111f29c1e1e061265b4af93ea1f274ad78a121541b6e708a39781c96bd399c7657780ff9fe9f052a818e0c65b70e0e6ce879134"
  },
  "trc20": {
    "visible": true,
    "txID": "3d0ae4ea180d71012c8b995c8af54d7db8f684df3fb6167d37765bb89eec532b",
    "raw_data": {
      "ref_block_bytes": "4f15",
      "ref_block_hash": "d5efcd3acb235c24",
      "expiration": 1791285828000,
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
              "contract_address": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
              "data": "a9059cbb000000000000000000000000b6e708a39781c96bd399c7657780ff9fe9f052a800000000000000000000000000000000000000000000000000000000000f4240"
            },
            "type_url": "type.googleapis.com/protocol.TriggerSmartContract"
          },
          "type": "TriggerSmartContract"
        }
      ],
      "timestamp": 1791285769893,
      "fee_limit": 30000000
    },
    "raw_data_hex": "0a024f152208d5efcd3acb235c2440a0b3d28791345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541c8599111f29c1e1e061265b4af93ea1f274ad78a121541eca9bc828a3005b9a3b909f2cc5c2a54794de05f2244a9059cbb000000000000000000000000b6e708a39781c96bd399c7657780ff9fe9f052a800000000000000000000000000000000000000000000000000000000000f424070a5edce87913490018087a70e"
  },
  "approve": {
    "visible": false,
    "txID": "1d559e7e2710a0dc78fc22dc7220332a7295b74ae4c794cf16a0f14c82f0162e",
    "raw_data": {
      "ref_block_bytes": "4f1a",
      "ref_block_hash": "e4f2a892a1e50164",
      "expiration": 1791285843000,
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "41c8599111f29c1e1e061265b4af93ea1f274ad78a",
              "contract_address": "41eca9bc828a3005b9a3b909f2cc5c2a54794de05f",
              "data": "095ea7b3000000000000000000000000b6e708a39781c96bd399c7657780ff9fe9f052a8ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            },
            "type_url": "type.googleapis.com/protocol.TriggerSmartContract"
          },
          "type": "TriggerSmartContract"
        }
      ],
      "timestamp": 1791285783222,
      "fee_limit": 30000000
    },
    "raw_data_hex": "0a024f1a2208e4f2a892a1e5016440b8a8d38791345aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541c8599111f29c1e1e061265b4af93ea1f274ad78a121541eca9bc828a3005b9a3b909f2cc5c2a54794de05f2244095ea7b3000000000000000000000000b6e708a39781c96bd399c7657780ff9fe9f052a8ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff70b6d5cf87913490018087a70e"
  },
  "freeze": {
    "visible": true,
    "txID": "8a2b433a55ce9ea5dae1893d42d1b5001887ab268d2a22ea23accafbbe05a5de",
    "raw_data": {
      "ref_block_bytes": "4f16",
      "ref_block_hash": "4f8a4770d0ae6bef",
      "expiration": 1791285831000,
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
              "frozen_balance": 10000000,
              "resource": "ENERGY"
            },
            "type_url": "type.googleapis.com/protocol.FreezeBalanceV2Contract"
          },
          "type": "FreezeBalanceV2Contract"
        }
      ],
      "timestamp": 1791285771645
    },
    "raw_data_hex": "0a024f1622084f8a4770d0ae6bef40d8cad28791345a5a083612560a34747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e467265657a6542616c616e63655632436f6e7472616374121e0a1541c8599111f29c1e1e061265b4af93ea1f274ad78a1080ade204180170fdface879134"
  },
  "unfreeze": {
    "visible": true,
    "txID": "ed52480ceebefe934cde1a1f4baec49fa10c15a808a97f6218d9b1a13c52281e",
    "raw_data": {
      "ref_block_bytes": "4f1e",
      "ref_block_hash": "fa755f2179e7e510",
      "expiration": 1791285855000,
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
              "unfreeze_balance": 1000000,
              "resource": "ENERGY"
            },
            "type_url": "type.googleapis.com/protocol.UnfreezeBalanceV2Contract"
          },
          "type": "UnfreezeBalanceV2Contract"
        }
      ],
      "timestamp": 1791285795990
    },
    "raw_data_hex": "0a024f1e2208fa755f2179e7e510409886d48791345a5b083712570a36747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e556e667265657a6542616c616e63655632436f6e7472616374121d0a1541c8599111f29c1e1e061265b4af93ea1f274ad78a10c0843d18017096b9d0879134"
  },
  "delegate": {
    "visible": true,
    "txID": "beb147f9e5d599be38715bc855f16ece543542ac3a13e5ef5a9ffe1c45d1103e",
    "raw_data": {
      "ref_block_bytes": "4f16",
      "ref_block_hash": "4f8a4770d0ae6bef",
      "expiration": 1791285831000,
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
              "resource": "ENERGY",
              "balance": 5000000,
              "receiver_address": "TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK",
              "lock": true,
              "lock_period": 28800
            },
            "type_url": "type.googleapis.com/protocol.DelegateResourceContract"
          },
          "type": "DelegateResourceContract"
        }
      ],
      "timestamp": 1791285772380
    },
    "raw_data_hex": "0a024f1622084f8a4770d0ae6bef40d8cad28791345a78083912740a35747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e44656c65676174655265736f75726365436f6e7472616374123b0a1541c8599111f29c1e1e061265b4af93ea1f274ad78a100118c096b102221541b6e708a39781c96bd399c7657780ff9fe9f052a828013080e10170dc80cf879134"
  },
  "vote": {
    "visible": false,
    "txID": "76b834c9f1b3c66d5ca39648dd0d823e0f8eb6df70bba1c7d469dd2dae5cf7c2",
    "raw_data": {
      "ref_block_bytes": "4f1a",
      "ref_block_hash": "e4f2a892a1e50164",
      "expiration": 1791285843000,
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "41c8599111f29c1e1e061265b4af93ea1f274ad78a",
              "votes": [
                {
                  "vote_address": "41608e7e1c6f6dcc1679ea512503e41ca0254e0948",
                  "vote_count": 3
                }
              ]
            },
            "type_url": "type.googleapis.com/protocol.VoteWitnessContract"
          },
          "type": "VoteWitnessContract"
        }
      ],
      "timestamp": 1791285784060
    },
    "raw_data_hex": "0a024f1a2208e4f2a892a1e5016440b8a8d38791345a6a080412660a30747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e566f74655769746e657373436f6e747261637412320a1541c8599111f29c1e1e061265b4af93ea1f274ad78a12190a1541608e7e1c6f6dcc1679ea512503e41ca0254e0948100370fcdbcf879134"
  },
  "perm": {
    "visible": true,
    "txID": "124b078aa8005371b7bca6f7969b2b97e43befd61adec8868edcb72b6fcb8333",
    "raw_data": {
      "ref_block_bytes": "4f1d",
      "ref_block_hash": "6702af6ca3cd69f3",
      "expiration": 1791285852000,
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
              "owner": {
                "permission_name": "owner",
                "threshold": 1,
                "keys": [
                  {
                    "address": "TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK",
                    "weight": 1
                  }
                ]
              },
              "actives": [
                {
                  "type": "Active",
                  "permission_name": "active0",
                  "threshold": 1,
                  "operations": "7fff1fc0033e0000000000000000000000000000000000000000000000000000",
                  "keys": [
                    {
                      "address": "TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK",
                      "weight": 1
                    }
                  ]
                }
              ]
            },
            "type_url": "type.googleapis.com/protocol.AccountPermissionUpdateContract"
          },
          "type": "AccountPermissionUpdateContract"
        }
      ],
      "timestamp": 1791285794250
    },
    "raw_data_hex": "0a024f1d22086702af6ca3cd69f340e0eed38791345acf01082e12ca010a3c747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e4163636f756e745065726d697373696f6e557064617465436f6e74726163741289010a1541c8599111f29c1e1e061265b4af93ea1f274ad78a12241a056f776e657220013a190a1541b6e708a39781c96bd399c7657780ff9fe9f052a81001224a08021a0761637469766530200132207fff1fc0033e00000000000000000000000000000000000000000000000000003a190a1541b6e708a39781c96bd399c7657780ff9fe9f052a8100170caabd0879134"
  },
  "memo": {
    "visible": true,
    "txID": "75eeed703e3e3c43213c4b2467b08236ff6786642a2f157401248eb514fcebf7",
    "raw_data": {
      "ref_block_bytes": "4f21",
      "ref_block_hash": "da8c3d0d97723337",
      "expiration": 1791285864000,
      "data": "68656c6c6f",
      "contract": [
        {
          "parameter": {
            "value": {
              "owner_address": "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
              "to_address": "TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK",
              "amount": 1
            },
            "type_url": "type.googleapis.com/protocol.TransferContract"
          },
          "type": "TransferContract"
        }
      ],
      "timestamp": 1791285805958
    },
    "raw_data_hex": "0a024f212208da8c3d0d9772333740c0ccd4879134520568656c6c6f5a65080112610a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412300a1541c8599111f29c1e1e061265b4af93ea1f274ad78a121541b6e708a39781c96bd399c7657780ff9fe9f052a81801708687d1879134"
  }
} as const;
