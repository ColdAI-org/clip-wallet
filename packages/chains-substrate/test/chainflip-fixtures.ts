/**
 * Chainflip fixtures: real mainnet runtime metadata V15 (chainflip-node specVersion 20216, transactionVersion 13,
 * read from https://mainnet-rpc.chainflip.io on 2026-10-06 with Metadata_metadata_at_version(15)), and payloads
 * shaped like the ones lp.chainflip.io hands an injectedWeb3 signer.
 */
import type { Account } from "@clip-wallet/core";
import { fromBufferToBase58 } from "@polkadot-api/substrate-bindings";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { CHAINFLIP, Enum, type Runtime, type SignerPayloadJSON, runtimeFromBytes } from "../src/index.js";
import { concat, fromHex, hex0x } from "../src/util.js";

export const CF_METADATA = gunzipSync(readFileSync(new URL("./fixtures/chainflip-metadata-v15.scale.gz", import.meta.url)));
export const CF_VERSION = { specName: "chainflip-node", specVersion: 20216, transactionVersion: 13 };
export const CF_GENESIS = "0x8b8c140b0af9db70686583e3f6bf2a59052bfe9584b97d20c45068281e976eb9";
export const CF_BLOCK_HASH = `0x${"ab".repeat(32)}`;

let rt: Runtime | undefined;
export function cfRuntime(): Runtime {
  rt ??= runtimeFromBytes(CF_METADATA, CF_GENESIS, CF_VERSION);
  return rt;
}

/**
 * sr25519 account 0 of the public "abandon … about" test phrase (the vault's substrate derivation: root key, no
 * junctions; generic address 5EPCUjPx…, as packages/vault/test/families.test.ts), and another account.
 *
 * redeemSig: signingBytes(cfRuntime(), cfPayload(me, redeemCall())), signed once offline with the vault's
 * signSr25519 in a scratch script outside the repo (AGENTS.md rule 1). sr25519 signatures are randomised, so
 * tests only verify it. The same scratch run checked these signing bytes and the signed extrinsic byte for byte
 * against @polkadot/types 17 (`ExtrinsicPayload.toU8a({ method: true })`, `Extrinsic.addSignature`) with this
 * metadata, with and without CheckMetadataHash, and had a wallet-built register_lp_account from this account
 * validated read-only by mainnet and Perseverance (`TaggedTransactionQueue_validate_transaction` → Payment,
 * i.e. the signature and extensions were accepted and only FLIP for the fee was missing).
 */
export const CF_FIX = {
  pub: "66933bd1f37070ef87bd1198af3dacceb095237f803f3d32b173e6b425ed7972",
  other: "29699b799d38ff33a0a722186972e05cf07b26a602407a52591e9a7cda1b94f1",
  redeemSig: "82ced53a475513a34de349344ab836f24de7cfd77dd97499fc2f1d6572f1283b20dd6eab1ab390adc72ac9df03c33c4fdc6cfbf5ab017bc04d29d6cff3d37e8d",
} as const;

export const cf = (pub: string) => fromBufferToBase58(2112)(fromHex(pub));

export function cfAccount(pub: string): Account {
  return { id: "substrate:0", family: "substrate", index: 0, curve: "sr25519", derivationPath: "", publicKey: pub, address: fromBufferToBase58(42)(fromHex(pub)) };
}

export function cfCall(pallet: string, call: string, args: unknown): Uint8Array {
  const c = cfRuntime().builder.buildCall(pallet, call);
  return concat(Uint8Array.from(c.location), c.codec.enc(args));
}

/** Funding.redeem(Exact 5 FLIP) to 0xabab…ab, any executor: the call the LP portal's "Redeem" button sends. */
export const REDEEM_TO = `0x${"ab".repeat(20)}`;
export const redeemCall = () => cfCall("Funding", "redeem", { amount: Enum("Exact", 5n * 10n ** 18n), address: REDEEM_TO, executor: undefined });

/** A SignerPayloadJSON as polkadot.js builds it for Chainflip (era mortal 64 from block 12345678, nonce 7). */
export function cfPayload(address: string, method: Uint8Array, over: Partial<SignerPayloadJSON> = {}): SignerPayloadJSON {
  return {
    address,
    assetId: null,
    blockHash: CF_BLOCK_HASH,
    blockNumber: "0x00bc614e",
    era: "0xe500",
    genesisHash: CF_GENESIS,
    metadataHash: null,
    method: hex0x(method),
    mode: 0,
    nonce: "0x00000007",
    signedExtensions: cfRuntime().extensions.map((e) => e.identifier),
    specVersion: "0x00004ef8",
    tip: "0x00000000000000000000000000000000",
    transactionVersion: "0x0000000d",
    version: 4,
    ...over,
  };
}

export const cfEnc = {
  storageKey: (pallet: string, entry: string, ...keys: unknown[]) => cfRuntime().builder.buildStorage(pallet, entry).keys.enc(...keys),
  storageValue: (pallet: string, entry: string, value: unknown) => hex0x(cfRuntime().builder.buildStorage(pallet, entry).value.enc(value)),
  apiResult: (api: string, method: string, value: unknown) => hex0x(cfRuntime().builder.buildRuntimeCall(api, method).value.enc(value)),
};

export { CHAINFLIP };
