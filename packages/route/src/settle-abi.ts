/**
 * Subsets of the compiled "settle on Hedera" ABIs, vendored from the CLPRouter repo, branch `feat/settle-on-hedera`
 * (commit a56cf60; sources src/settle/SettleOrderBook.sol, src/settle/SettleDeposit.sol,
 * src/settle/SettleTypes.sol; compiled with `forge build` into out/SettleOrderBook.sol/SettleOrderBook.json and
 * out/SettleDeposit.sol/SettleDeposit.json). Only what the wallet reads or asks the user to approve.
 * `SettleDeposit.deposit` selector: 0x1257b39b. Re-vendor with jq from those files; never edit by hand.
 */
export const SETTLE_ORDER_BOOK_ABI = [
  {
    "type": "function",
    "name": "PENALTY_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PROOF_GRACE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bonds",
    "inputs": [
      {
        "name": "connector",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "total",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reserved",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "pendingWithdraw",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "withdrawReadyAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "channelOfLedger",
    "inputs": [
      {
        "name": "ledger",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "channelId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimDefault",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "connectors",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "prevSigner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "rotatedAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "registeredAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "shortfalls",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "coverAssets",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "freeCapacity",
    "inputs": [
      {
        "name": "connector",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isCoverAsset",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isValidSigner",
    "inputs": [
      {
        "name": "connector",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "signer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "issuedAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "expiry",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "orderIdOf",
    "inputs": [
      {
        "name": "q",
        "type": "tuple",
        "internalType": "struct SettleTypes.Quote",
        "components": [
          {
            "name": "connector",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "srcLedger",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "depositApp",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "user",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "payTo",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "assetIn",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "dstLedger",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "assetOut",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recipient",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "coverAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "coverAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refundTo",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "issuedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "orders",
    "inputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "connector",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum SettleOrderBook.Status"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "coverAsset",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "openedAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "refundTo",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "dstLedger",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "assetOut",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "recipient",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "owedOnDefault",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reserved",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owed",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owedFor",
    "inputs": [
      {
        "name": "coverAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sources",
    "inputs": [
      {
        "name": "channelId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "ledger",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "depositSender",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "deliverySender",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "activeAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdrawOwed",
    "inputs": [
      {
        "name": "asset",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "OrderCancelled",
    "inputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "refundTo",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "paid",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderDefaulted",
    "inputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "refundTo",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "asset",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "paid",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderDelivered",
    "inputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "deliveryHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "deliveredAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderOpened",
    "inputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "connector",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "refundTo",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "srcLedger",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "dstLedger",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "coverAsset",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "owedOnDefault",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "reserved",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OrderRejected",
    "inputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "connector",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "reason",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum SettleOrderBook.Reject"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "DeadlineNotPassed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingPending",
    "inputs": []
  }
] as const;

export const SETTLE_DEPOSIT_ABI = [
  {
    "type": "function",
    "name": "LEDGER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ORDER_BOOK",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deposit",
    "inputs": [
      {
        "name": "q",
        "type": "tuple",
        "internalType": "struct SettleTypes.Quote",
        "components": [
          {
            "name": "connector",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "srcLedger",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "depositApp",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "user",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "payTo",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "assetIn",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "dstLedger",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "assetOut",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recipient",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "coverAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "coverAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refundTo",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "issuedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "sig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "messageId",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "orderIdOf",
    "inputs": [
      {
        "name": "q",
        "type": "tuple",
        "internalType": "struct SettleTypes.Quote",
        "components": [
          {
            "name": "connector",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "srcLedger",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "depositApp",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "user",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "payTo",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "assetIn",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "dstLedger",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "assetOut",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "recipient",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "coverAsset",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "coverAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "refundTo",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "issuedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiry",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "used",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Deposited",
    "inputs": [
      {
        "name": "orderId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "connector",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "signer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "assetIn",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "amountIn",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "payTo",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "messageId",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AmountMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadTimes",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAnAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotQuoteUser",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PaymentFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "QuoteExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "QuoteUsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "WrongDepositApp",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongLedger",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongValue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;

export const SETTLE_DEPOSIT_SELECTOR = "0x1257b39b";
