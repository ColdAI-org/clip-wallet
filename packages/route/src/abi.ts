/**
 * Subset of the compiled ClprRouter ABI (clprouter out/ClprRouter.sol/ClprRouter.json, source at 564e29e:
 * src/ClprRouter.sol, src/interfaces/IClprRouter.sol). `send` selector: 0x8e0619f9.
 */
export const CLPR_ROUTER_ABI = [
  {
    "type": "function",
    "name": "routes",
    "inputs": [
      {
        "name": "",
        "type": "bytes16"
      }
    ],
    "outputs": [
      {
        "name": "sender",
        "type": "address"
      },
      {
        "name": "deadline",
        "type": "uint64"
      },
      {
        "name": "status",
        "type": "uint8"
      },
      {
        "name": "strict",
        "type": "bool"
      },
      {
        "name": "edges",
        "type": "uint8"
      },
      {
        "name": "held",
        "type": "uint8"
      },
      {
        "name": "payee",
        "type": "address"
      },
      {
        "name": "feeBudget",
        "type": "uint64"
      },
      {
        "name": "late",
        "type": "uint8"
      },
      {
        "name": "reclaimAt",
        "type": "uint64"
      },
      {
        "name": "escrow",
        "type": "uint256"
      },
      {
        "name": "hopsHash",
        "type": "bytes32"
      },
      {
        "name": "firstHop",
        "type": "bytes32"
      },
      {
        "name": "pathHash",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "send",
    "inputs": [
      {
        "name": "req",
        "type": "tuple",
        "components": [
          {
            "name": "destination",
            "type": "tuple",
            "components": [
              {
                "name": "ledgerId",
                "type": "string"
              },
              {
                "name": "application",
                "type": "bytes"
              }
            ]
          },
          {
            "name": "recipient",
            "type": "string"
          },
          {
            "name": "hops",
            "type": "tuple[]",
            "components": [
              {
                "name": "ledgerId",
                "type": "string"
              },
              {
                "name": "router",
                "type": "bytes"
              },
              {
                "name": "channelId",
                "type": "bytes32"
              },
              {
                "name": "connectorId",
                "type": "bytes32"
              },
              {
                "name": "fee",
                "type": "uint64"
              },
              {
                "name": "feePayee",
                "type": "bytes"
              }
            ]
          },
          {
            "name": "mode",
            "type": "uint8"
          },
          {
            "name": "constraints",
            "type": "tuple",
            "components": [
              {
                "name": "filters",
                "type": "uint32"
              },
              {
                "name": "deadline",
                "type": "uint64"
              },
              {
                "name": "maxFee",
                "type": "uint64"
              },
              {
                "name": "remainingFeeBudget",
                "type": "uint64"
              },
              {
                "name": "trustFloor",
                "type": "uint32"
              },
              {
                "name": "maxHops",
                "type": "uint32"
              },
              {
                "name": "loose",
                "type": "bool"
              },
              {
                "name": "energyCap",
                "type": "uint64"
              }
            ]
          },
          {
            "name": "payloadType",
            "type": "uint8"
          },
          {
            "name": "payload",
            "type": "bytes"
          },
          {
            "name": "receiptPath",
            "type": "tuple[]",
            "components": [
              {
                "name": "ledgerId",
                "type": "string"
              },
              {
                "name": "router",
                "type": "bytes"
              },
              {
                "name": "channelId",
                "type": "bytes32"
              },
              {
                "name": "connectorId",
                "type": "bytes32"
              },
              {
                "name": "fee",
                "type": "uint64"
              },
              {
                "name": "feePayee",
                "type": "bytes"
              }
            ]
          },
          {
            "name": "originSignature",
            "type": "bytes"
          },
          {
            "name": "isoUetr",
            "type": "bytes16"
          },
          {
            "name": "escrow",
            "type": "uint256"
          },
          {
            "name": "payee",
            "type": "address"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "routeId",
        "type": "bytes16"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "event",
    "name": "RouteDelivered",
    "inputs": [
      {
        "name": "routeId",
        "type": "bytes16",
        "indexed": true
      },
      {
        "name": "application",
        "type": "address",
        "indexed": true
      },
      {
        "name": "responseHash",
        "type": "bytes32",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RouteSent",
    "inputs": [
      {
        "name": "routeId",
        "type": "bytes16",
        "indexed": true
      },
      {
        "name": "sender",
        "type": "address",
        "indexed": true
      },
      {
        "name": "destinationLedger",
        "type": "string",
        "indexed": false
      },
      {
        "name": "escrow",
        "type": "uint256",
        "indexed": false
      },
      {
        "name": "feeBudget",
        "type": "uint64",
        "indexed": false
      },
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false
      },
      {
        "name": "messageId",
        "type": "uint64",
        "indexed": false
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "RouteSettled",
    "inputs": [
      {
        "name": "routeId",
        "type": "bytes16",
        "indexed": true
      },
      {
        "name": "status",
        "type": "uint8",
        "indexed": false
      },
      {
        "name": "reason",
        "type": "uint8",
        "indexed": false
      },
      {
        "name": "hopIndex",
        "type": "uint32",
        "indexed": false
      },
      {
        "name": "caseId",
        "type": "bytes32",
        "indexed": false
      },
      {
        "name": "contact",
        "type": "string",
        "indexed": false
      },
      {
        "name": "feesPaid",
        "type": "uint256",
        "indexed": false
      }
    ],
    "anonymous": false
  }
] as const;
