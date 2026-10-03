import { ec, hash } from "starknet";
import { RPC_ERRORS, RpcError, type StarknetRpc } from "./rpc.js";
import { bytesToBigInt, hex, padAddress, toHexFelt } from "./util.js";

/**
 * Account contracts. Default: OpenZeppelin account v0.17.0, the class @clip-wallet/vault uses for its default
 * Starknet address (STARKNET_OZ_ACCOUNT_CLASS_HASH, as in the starknet.js create-account guide). Both OZ classes
 * below and Argent's are declared on Sepolia and mainnet (starknet_getClass, 2026-10-03).
 *
 *  - "openzeppelin": constructor `(public_key)`; signature `[r, s]`; SRC-6 `__execute__(Array<Call>)`; SRC-9 v2
 *    outside execution (paymaster-ready); upgradeable. Deploys itself with DEPLOY_ACCOUNT.
 *  - "argent": Argent account 0.4.0, constructor `(owner: Signer::Starknet(pubkey), guardian: Option::None)` =
 *    calldata `[0, pubkey, 1]`; accepts `[r, s]` from a Starknet owner (checked: a DEPLOY_ACCOUNT simulated on
 *    Sepolia without SKIP_VALIDATE passed with [r, s] and failed with "argent/invalid-owner-sig" when corrupted).
 *
 * Counterfactual address = calculateContractAddressFromHash(salt = public key, class hash, constructor calldata,
 * deployer = 0): what DEPLOY_ACCOUNT produces when the account deploys itself.
 */
export const OZ_ACCOUNT_CLASS_HASH = "0x0540d7f5ec7ecf317e68d48564934cb99259781b1ee3cedbbc37ec5337f8e688";
/** OpenZeppelin contracts-cairo 3.x AccountUpgradeable preset (docs.openzeppelin.com/contracts-cairo/3.x/presets). */
export const OZ_V3_ACCOUNT_CLASS_HASH = "0x01d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";
/** Argent account 0.4.0 (what Argent X deploys for new accounts). */
export const ARGENT_ACCOUNT_CLASS_HASH = "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f";

export type AccountKind = "openzeppelin" | "argent";

export interface AccountClass {
  kind: AccountKind;
  classHash: string;
}

export const DEFAULT_ACCOUNT_CLASS: AccountClass = { kind: "openzeppelin", classHash: OZ_ACCOUNT_CLASS_HASH };

function constructorCalldata(kind: AccountKind, key: string): string[] {
  return kind === "argent" ? ["0x0", key, "0x1"] : [key];
}

/** Stark curve order-related bound for addresses (2**251 - 256), per Starknet's ADDR_BOUND. */
export const ADDR_BOUND = 2n ** 251n - 256n;

/**
 * The Stark public key as the account stores it (the point's x coordinate, a felt).
 * Accepts 32 bytes (x), 33 bytes (compressed point) or 65 bytes (uncompressed point).
 */
export function starkKeyX(publicKey: Uint8Array): bigint {
  if (publicKey.length === 32) return bytesToBigInt(publicKey);
  if (publicKey.length === 33 && (publicKey[0] === 2 || publicKey[0] === 3)) return bytesToBigInt(publicKey.subarray(1));
  if (publicKey.length === 65 && publicKey[0] === 4) return bytesToBigInt(publicKey.subarray(1, 33));
  throw new Error("Stark public key must be 32 (x), 33 (compressed) or 65 (uncompressed) bytes");
}

export interface DeploymentData {
  address: string;
  class_hash: string;
  salt: string;
  calldata: string[];
  /** wallet_deploymentData: 1 = Cairo 1 account. */
  version: 1;
}

export function deploymentData(publicKeyX: bigint, account: AccountClass = DEFAULT_ACCOUNT_CLASS): DeploymentData {
  const key = toHexFelt(publicKeyX);
  const calldata = constructorCalldata(account.kind, key);
  const address = padAddress(hash.calculateContractAddressFromHash(key, account.classHash, calldata, 0));
  return { address, class_hash: padAddress(account.classHash), salt: key, calldata, version: 1 };
}

/**
 * Account address for a Stark public key. Shaped for @clip-wallet/vault's `addressOf` injection, e.g.
 * `addressOf: (family, pk) => family === "starknet" ? accountAddress(pk, { kind: "argent", classHash: ARGENT_ACCOUNT_CLASS_HASH }) : undefined`.
 */
export function accountAddress(publicKey: Uint8Array, account: AccountClass = DEFAULT_ACCOUNT_CLASS): string {
  return deploymentData(starkKeyX(publicKey), account).address;
}

export function isStarknetAddress(value: string): boolean {
  const v = value.trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(v)) return false;
  const n = BigInt(v);
  return n > 0n && n < ADDR_BOUND;
}

/** Deployed = the address has a class. Contract-not-found means "not active yet". */
export async function isDeployed(rpc: StarknetRpc, address: string): Promise<boolean> {
  try {
    await rpc.call<string>("starknet_getClassHashAt", ["latest", address]);
    return true;
  } catch (e) {
    if (e instanceof RpcError && e.rpcCode === RPC_ERRORS.CONTRACT_NOT_FOUND) return false;
    throw e;
  }
}

/**
 * Verifies a Stark ECDSA signature [r, s] over `msgHash` for the account's public key. With an x-only key both
 * y parities are tried, as Starknet's own ECDSA check (check_ecdsa_signature) accepts either point.
 */
export function verifyStark(r: bigint, s: bigint, msgHash: bigint, publicKey: Uint8Array): boolean {
  const sig = new ec.starkCurve.Signature(r, s);
  const msg = toHexFelt(msgHash);
  const candidates =
    publicKey.length === 32 ? [`02${hex(publicKey)}`, `03${hex(publicKey)}`] : [hex(publicKey)];
  for (const pk of candidates) {
    try {
      if (ec.starkCurve.verify(sig, msg, pk)) return true;
    } catch {
      /* not a point for this parity */
    }
  }
  return false;
}
