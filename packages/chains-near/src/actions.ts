/**
 * NearActionJson → borsh Action. Everything arrives as JSON (bytes as base64, number[], a Node Buffer JSON or a
 * JSON-serialised Uint8Array; integers as decimal strings or safe numbers). Two shapes are accepted:
 *
 *  (a) wallet-selector "InternalAction" (@near-wallet-selector/core transactions.types):
 *      { type: "Transfer", params: { deposit } }
 *      { type: "FunctionCall", params: { methodName, args: object | bytes, argsBase64?, gas, deposit } }
 *      { type: "AddKey", params: { publicKey: "ed25519:..", accessKey: { nonce?, permission: "FullAccess" |
 *        { receiverId, allowance?, methodNames? } } } }
 *      { type: "DeleteKey", params: { publicKey } }, { type: "DeleteAccount", params: { beneficiaryId } },
 *      { type: "Stake", params: { stake, publicKey } }, { type: "CreateAccount" },
 *      { type: "DeployContract", params: { code | codeBase64 } }
 *  (b) near-api-js / @near-js/transactions `Action` objects as JSON (enum style, what wallet-selector v10 passes):
 *      { enum: "transfer", transfer: { deposit } }, { functionCall: { methodName, args, gas, deposit } },
 *      { addKey: { publicKey: { ed25519Key: { keyType: 0, data } } | "ed25519:..", accessKey: { nonce,
 *        permission: { fullAccess: {} } | { functionCall: { allowance, receiverId, methodNames } } } } },
 *      { deleteKey }, { deleteAccount }, { stake }, { createAccount: {} }, { deployContract: { code } },
 *      { deployGlobalContract: { code, deployMode: { CodeHash: {} } | { AccountId: {} } } },
 *      { useGlobalContract: { contractIdentifier: { CodeHash: bytes } | { AccountId: string } } }
 *
 * `signedDelegate` (a meta transaction being relayed) and anything else become `Unknown`: decode() shows it as
 * blind and prepare() refuses it, because the wallet can't encode what it can't read.
 */
import { type AccessKeyPermission, type Action, type PublicKey, parsePublicKey } from "./borsh.js";
import { toBigInt, toBytes } from "./util.js";

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);

export class BadAction extends Error {}

function publicKeyOf(x: unknown): PublicKey {
  if (typeof x === "string") return parsePublicKey(x);
  if (isObj(x)) {
    const inner = isObj(x.ed25519Key) ? x.ed25519Key : isObj(x.secp256k1Key) ? x.secp256k1Key : x;
    if (inner.keyType !== undefined && inner.data !== undefined) {
      const keyType = Number(inner.keyType);
      const data = toBytes(inner.data, "public key");
      if ((keyType === 0 && data.length === 32) || (keyType === 1 && data.length === 64)) return { keyType, data };
    }
  }
  throw new BadAction("bad public key");
}

function argsOf(p: Obj): Uint8Array {
  if (typeof p.argsBase64 === "string") return toBytes(p.argsBase64, "args");
  const a = p.args;
  if (a === undefined || a === null) return new TextEncoder().encode("{}");
  if (typeof a === "string") return toBytes(a, "args");
  try {
    return toBytes(a, "args");
  } catch {
    // A plain JSON object: wallet-selector encodes it as JSON text.
    if (isObj(a) || Array.isArray(a)) return new TextEncoder().encode(JSON.stringify(a));
    throw new BadAction("bad args");
  }
}

function permissionOf(p: unknown): AccessKeyPermission {
  if (p === "FullAccess" || (isObj(p) && (isObj(p.fullAccess) || p.enum === "fullAccess"))) return "FullAccess";
  const fc = isObj(p) && isObj(p.functionCall) ? p.functionCall : p;
  if (isObj(fc) && typeof fc.receiverId === "string") {
    const methodNames = fc.methodNames ?? [];
    if (!Array.isArray(methodNames) || !methodNames.every((m) => typeof m === "string")) throw new BadAction("bad method names");
    return {
      allowance: fc.allowance === undefined || fc.allowance === null ? null : toBigInt(fc.allowance, "allowance"),
      receiverId: fc.receiverId,
      methodNames: methodNames as string[],
    };
  }
  throw new BadAction("bad permission");
}

const str = (x: unknown, what: string): string => {
  if (typeof x !== "string" || !x) throw new BadAction(`bad ${what}`);
  return x;
};

function fromInternal(type: string, p: Obj): Action {
  switch (type) {
    case "CreateAccount":
      return { kind: "CreateAccount" };
    case "DeployContract":
      return { kind: "DeployContract", code: toBytes(p.codeBase64 ?? p.code, "code") };
    case "FunctionCall":
      return {
        kind: "FunctionCall",
        methodName: str(p.methodName, "method name"),
        args: argsOf(p),
        gas: toBigInt(p.gas ?? "30000000000000", "gas"),
        deposit: toBigInt(p.deposit ?? "0", "deposit"),
      };
    case "Transfer":
      return { kind: "Transfer", deposit: toBigInt(p.deposit, "deposit") };
    case "Stake":
      return { kind: "Stake", stake: toBigInt(p.stake, "stake"), publicKey: publicKeyOf(p.publicKey) };
    case "AddKey": {
      const ak = isObj(p.accessKey) ? p.accessKey : {};
      return {
        kind: "AddKey",
        publicKey: publicKeyOf(p.publicKey),
        accessKey: { nonce: toBigInt(ak.nonce ?? 0, "nonce"), permission: permissionOf(ak.permission) },
      };
    }
    case "DeleteKey":
      return { kind: "DeleteKey", publicKey: publicKeyOf(p.publicKey) };
    case "DeleteAccount":
      return { kind: "DeleteAccount", beneficiaryId: str(p.beneficiaryId, "beneficiary") };
    case "DeployGlobalContract": {
      const m = p.deployMode;
      const mode = m === "AccountId" || (isObj(m) && ("AccountId" in m || m.enum === "AccountId")) ? "AccountId" : "CodeHash";
      return { kind: "DeployGlobalContract", code: toBytes(p.codeBase64 ?? p.code, "code"), deployMode: mode };
    }
    case "UseGlobalContract": {
      const id = isObj(p.contractIdentifier) ? p.contractIdentifier : {};
      if (typeof id.AccountId === "string") return { kind: "UseGlobalContract", contractIdentifier: { accountId: id.AccountId } };
      if (typeof id.accountId === "string") return { kind: "UseGlobalContract", contractIdentifier: { accountId: id.accountId } };
      const h = toBytes(id.CodeHash ?? id.codeHash, "code hash");
      if (h.length !== 32) throw new BadAction("bad code hash");
      return { kind: "UseGlobalContract", contractIdentifier: { codeHash: h } };
    }
    default:
      return { kind: "Unknown", tag: -1 };
  }
}

const NAJ_KEYS: Record<string, string> = {
  createAccount: "CreateAccount",
  deployContract: "DeployContract",
  functionCall: "FunctionCall",
  transfer: "Transfer",
  stake: "Stake",
  addKey: "AddKey",
  deleteKey: "DeleteKey",
  deleteAccount: "DeleteAccount",
  signedDelegate: "Delegate",
  deployGlobalContract: "DeployGlobalContract",
  useGlobalContract: "UseGlobalContract",
};

/** One NearActionJson → Action. Malformed input throws BadAction; an unknown kind returns `Unknown`. */
export function parseAction(x: unknown): Action {
  if (!isObj(x)) throw new BadAction("bad action");
  try {
    if (typeof x.type === "string") return fromInternal(x.type, isObj(x.params) ? x.params : {});
    const key = typeof x.enum === "string" && x.enum in NAJ_KEYS ? x.enum : Object.keys(NAJ_KEYS).find((k) => isObj(x[k]));
    if (!key) return { kind: "Unknown", tag: -1 };
    const type = NAJ_KEYS[key]!;
    if (type === "Delegate") return { kind: "Unknown", tag: 8 };
    return fromInternal(type, isObj(x[key]) ? (x[key] as Obj) : {});
  } catch (e) {
    if (e instanceof BadAction) throw e;
    throw new BadAction((e as Error).message);
  }
}
