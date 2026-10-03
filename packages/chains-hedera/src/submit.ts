import { sha384 } from "@noble/hashes/sha2.js";
import { accountIdString, transactionIdString } from "./ids.js";
import { GRPC_WEB_NODES, type HederaLedger } from "./networks.js";
import { decodeTransactionResponse, encodeTransaction } from "./proto/hapi.js";
import { parseTransaction } from "./tx.js";
import { hex } from "./util.js";

/**
 * Submits a signed transaction to a consensus node over gRPC-Web: one POST of a single gRPC-Web frame to
 * `<proxy>/proto.<Service>/<method>`, exactly what the Hiero SDK's WebChannel does (hiero-sdk-js v2.89.1,
 * src/channel/WebChannel.js + Channel.js encodeRequest/decodeUnaryResponse). Frames: 1 flag byte (0x80 =
 * trailers), 4-byte big-endian length, payload (https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md).
 * Uses plain `fetch`, so it runs the same in the extension's service worker, pages and React Native.
 */

/** The SDK's TransactionResponse.toJSON() shape (hedera-wallet-connect returns this to dapps). */
export interface HederaTransactionResponse {
  nodeId: string;
  /** hex SHA-384 of the submitted SignedTransaction bytes */
  transactionHash: string;
  transactionId: string;
}

/**
 * The HAPI service and rpc for each TransactionBody data case (services/*_service.proto in hedera-protobufs
 * v0.77.2: CryptoService, TokenService, SmartContractService, ScheduleService, ConsensusService, FileService,
 * UtilService). Keyed by TransactionBody field number.
 */
const RPC: Record<number, string> = {
  7: "SmartContractService/contractCallMethod",
  8: "SmartContractService/createContract",
  9: "SmartContractService/updateContract",
  11: "CryptoService/createAccount",
  12: "CryptoService/cryptoDelete",
  14: "CryptoService/cryptoTransfer",
  15: "CryptoService/updateAccount",
  16: "FileService/appendContent",
  17: "FileService/createFile",
  18: "FileService/deleteFile",
  19: "FileService/updateFile",
  22: "SmartContractService/deleteContract",
  24: "ConsensusService/createTopic",
  25: "ConsensusService/updateTopic",
  26: "ConsensusService/deleteTopic",
  27: "ConsensusService/submitMessage",
  29: "TokenService/createToken",
  31: "TokenService/freezeTokenAccount",
  32: "TokenService/unfreezeTokenAccount",
  33: "TokenService/grantKycToTokenAccount",
  34: "TokenService/revokeKycFromTokenAccount",
  35: "TokenService/deleteToken",
  36: "TokenService/updateToken",
  37: "TokenService/mintToken",
  38: "TokenService/burnToken",
  39: "TokenService/wipeTokenAccount",
  40: "TokenService/associateTokens",
  41: "TokenService/dissociateTokens",
  42: "ScheduleService/createSchedule",
  43: "ScheduleService/deleteSchedule",
  44: "ScheduleService/signSchedule",
  45: "TokenService/updateTokenFeeSchedule",
  46: "TokenService/pauseToken",
  47: "TokenService/unpauseToken",
  48: "CryptoService/approveAllowances",
  49: "CryptoService/deleteAllowances",
  50: "SmartContractService/callEthereum",
  52: "UtilService/prng",
  53: "TokenService/updateNfts",
  57: "TokenService/rejectToken",
  58: "TokenService/airdropTokens",
  59: "TokenService/cancelAirdrop",
  60: "TokenService/claimAirdrop",
  74: "UtilService/atomicBatch",
  75: "SmartContractService/hookStore",
};

/** ResponseCodeEnum values (services/response_code.proto) the wallet reacts to. */
const STATUS: Record<number, string> = {
  0: "OK",
  1: "INVALID_TRANSACTION",
  2: "PAYER_ACCOUNT_NOT_FOUND",
  3: "INVALID_NODE_ACCOUNT",
  4: "TRANSACTION_EXPIRED",
  5: "INVALID_TRANSACTION_START",
  7: "INVALID_SIGNATURE",
  9: "INSUFFICIENT_TX_FEE",
  10: "INSUFFICIENT_PAYER_BALANCE",
  11: "DUPLICATE_TRANSACTION",
  12: "BUSY",
  15: "INVALID_ACCOUNT_ID",
  21: "UNKNOWN",
  28: "INSUFFICIENT_ACCOUNT_BALANCE",
  43: "INVALID_PAYER_SIGNATURE",
  67: "PLATFORM_NOT_ACTIVE",
  69: "PLATFORM_TRANSACTION_NOT_CREATED",
  178: "INSUFFICIENT_TOKEN_BALANCE",
  184: "TOKEN_NOT_ASSOCIATED_TO_ACCOUNT",
  366: "THROTTLED_AT_CONSENSUS",
};
/** Same retry set as the SDK's Transaction._getStatusAndExecutionState. */
const RETRY = new Set([12, 21, 67, 69, 3]);

export class PrecheckError extends Error {
  constructor(
    readonly status: string,
    readonly code: number,
    readonly nodeId: string,
  ) {
    super(`precheck failed on ${nodeId}: ${status}`);
  }
}

export interface SubmitOptions {
  fetch?: typeof fetch;
  /** Per-request timeout; the SDK's gRPC deadline is 10 s. */
  timeoutMs?: number;
  /** Node account id → gRPC-Web base URL; default GRPC_WEB_NODES[ledger]. */
  nodes?: Record<string, string>;
}

export function grpcWebFrame(message: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(message.length + 5);
  new DataView(out.buffer).setUint32(1, message.length);
  out.set(message, 5);
  return out;
}

/** The data frame of a unary gRPC-Web response, and the grpc-status from the trailers (if any). */
export function parseGrpcWebResponse(body: Uint8Array): { message: Uint8Array | null; status: number | null; statusMessage: string | null } {
  let message: Uint8Array | null = null;
  let status: number | null = null;
  let statusMessage: string | null = null;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let o = 0;
  while (o + 5 <= body.length) {
    const flag = body[o]!;
    const len = view.getUint32(o + 1);
    if (o + 5 + len > body.length) throw new Error("gRPC-Web: truncated frame");
    const data = body.subarray(o + 5, o + 5 + len);
    if (flag & 0x80) {
      for (const line of new TextDecoder().decode(data).split(/\r?\n/)) {
        const i = line.indexOf(":");
        if (i < 0) continue;
        const k = line.slice(0, i).trim().toLowerCase();
        const v = line.slice(i + 1).trim();
        if (k === "grpc-status") status = Number(v);
        else if (k === "grpc-message") statusMessage = decodeURIComponent(v);
      }
    } else if (message == null) message = data;
    o += 5 + len;
  }
  return { message, status, statusMessage };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends each node its own SignedTransaction (they differ in nodeAccountID), in list order, until one node
 * accepts it at precheck. BUSY / PLATFORM_* / UNKNOWN / unreachable → next node, with a short backoff.
 */
export async function submitTransaction(signedList: Uint8Array, ledger: HederaLedger, opts: SubmitOptions = {}): Promise<HederaTransactionResponse> {
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const nodes = opts.nodes ?? GRPC_WEB_NODES[ledger];
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const parsed = parseTransaction(signedList);
  if (!parsed.frozen) throw new Error("transaction is not frozen");
  const rpc = RPC[parsed.body.kind];
  if (!rpc) throw new PrecheckError("NOT_SUPPORTED", -1, "");
  const transactionId = parsed.body.transactionId ? transactionIdString(parsed.body.transactionId) : null;
  if (!transactionId) throw new Error("transaction has no transaction id");

  const list = parsed.entries.flatMap((e) =>
    e.raw && e.body.nodeAccountId ? [{ nodeId: accountIdString(e.body.nodeAccountId), signedTransactionBytes: e.raw }] : [],
  );
  let lastError: unknown = new Error("no reachable node for this transaction");
  let attempt = 0;
  for (const { nodeId, signedTransactionBytes } of list) {
    const base = nodes[nodeId];
    if (!base) continue;
    if (attempt++ > 0) await sleep(Math.min(250 * 2 ** (attempt - 2), 2000));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base.replace(/\/+$/, "")}/proto.${rpc}`, {
        method: "POST",
        headers: { "content-type": "application/grpc-web+proto", "x-grpc-web": "1" },
        body: grpcWebFrame(encodeTransaction(signedTransactionBytes)),
        signal: ctl.signal,
      });
      if (!res.ok) {
        lastError = new Error(`gRPC-Web HTTP ${res.status} from ${nodeId}`);
        continue;
      }
      const headerStatus = res.headers.get("grpc-status");
      if (headerStatus != null && headerStatus !== "0") {
        lastError = new Error(`gRPC status ${headerStatus} from ${nodeId}: ${res.headers.get("grpc-message") ?? ""}`);
        continue;
      }
      const frame = parseGrpcWebResponse(new Uint8Array(await res.arrayBuffer()));
      if (frame.status != null && frame.status !== 0) {
        lastError = new Error(`gRPC status ${frame.status} from ${nodeId}: ${frame.statusMessage ?? ""}`);
        continue;
      }
      if (!frame.message) {
        lastError = new Error(`empty gRPC-Web response from ${nodeId}`);
        continue;
      }
      const { precheckCode } = decodeTransactionResponse(frame.message);
      if (precheckCode === 0) {
        return { nodeId, transactionHash: hex(sha384(signedTransactionBytes)), transactionId };
      }
      const err = new PrecheckError(STATUS[precheckCode] ?? `CODE_${precheckCode}`, precheckCode, nodeId);
      if (!RETRY.has(precheckCode)) throw err;
      lastError = err;
    } catch (e) {
      if (e instanceof PrecheckError && !RETRY.has(e.code)) throw e;
      lastError = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
