import {
  type ChainContext,
  type ChainModule,
  ClipError,
  isWalletOrigin,
  msg as bgMsg,
  titled,
  type Msg,
  type DappRequest,
  type DecodedRequest,
  type Network,
  type Nft,
  type Signature,
  type SignablePayload,
  type TokenBalance,
  type Warning,
} from "@clip-wallet/core";
import { aliasAddress, checksumAlias, isAccountId, isEvmAddress, stripChecksum } from "./address.js";
import {
  SIGN_TRANSACTION_BYTES,
  buildAssociate,
  buildAtomicSwap,
  buildDissociate,
  buildNftTransfer,
  buildScheduleSign,
  buildStakeUpdate,
  buildTransfer,
  mirrorFor,
} from "./builders.js";
import { type Described, describeTransaction } from "./describe.js";
import { DEFAULT_IPFS_GATEWAY, fetchHip412, metadataUri } from "./metadata.js";
import type { Mirror } from "./mirror.js";
import { LEDGER_ID_BYTES, accountIdString, entityChecksum } from "./ids.js";
import { GRPC_WEB_NODES, type HederaLedger, hbarAsset, ledgerOf, tokenAssetKey } from "./networks.js";
import { queryKind } from "./proto/hapi.js";
import { type HederaTransactionResponse, PrecheckError, submitTransaction } from "./submit.js";
import {
  type ParsedTransaction,
  attachSignatures,
  bodiesToSign,
  digest,
  ecdsaPublicKey,
  freezeIfNeeded,
  parseTransaction,
  prefixMessage,
  signatureMapBase64,
  transactionFromBodyBytes,
  verifyEcdsa,
} from "./tx.js";
import { b64decode, b64encode, formatUnits } from "./util.js";

/** Hedera WalletConnect JSON-RPC methods (hedera-wallet-connect 2.1.3, HederaJsonRpcMethod). */
export const HEDERA_METHODS = {
  getNodeAddresses: "hedera_getNodeAddresses",
  executeTransaction: "hedera_executeTransaction",
  signMessage: "hedera_signMessage",
  signAndExecuteQuery: "hedera_signAndExecuteQuery",
  signAndExecuteTransaction: "hedera_signAndExecuteTransaction",
  signTransaction: "hedera_signTransaction",
} as const;

/**
 * Sends a fully signed transaction (TransactionList bytes) to a consensus node. Default: gRPC-Web straight to
 * the network's node proxies (submit.ts), through `ctx.fetch`. Override in tests or to route through a relay.
 */
export type Submitter = (signedTransactionList: Uint8Array, ledger: HederaLedger, ctx: ChainContext) => Promise<HederaTransactionResponse>;
export type { HederaTransactionResponse } from "./submit.js";

export interface HederaModuleOptions {
  submit?: Submitter;
  ipfsGateway?: string;
}

export interface HederaAccountState {
  accountId: string | null;
  evmAddress: string;
  /** -1 = unlimited (HIP-904), 0 = none. */
  maxAutoAssociations: number;
  usedAutoAssociations: number;
  /** null when unlimited. */
  freeAutoAssociationSlots: number | null;
  associations: { tokenId: string; automatic: boolean; frozen: boolean; balance: string }[];
  staking: { nodeId: number | null; accountId: string | null; declineReward: boolean; pendingRewardTinybars: string };
}

export interface HederaModule extends ChainModule {
  getAccountState(ctx: ChainContext): Promise<HederaAccountState>;
  buildNftTransfer: typeof buildNftTransfer;
  buildAssociate: typeof buildAssociate;
  buildDissociate: typeof buildDissociate;
  buildStakeUpdate: typeof buildStakeUpdate;
  buildAtomicSwap: typeof buildAtomicSwap;
  buildScheduleSign: typeof buildScheduleSign;
}

interface TxParams {
  signerAccountId?: string;
  transactionList?: string;
  transactionBody?: string;
  message?: string;
  query?: string;
}

const PLAIN_STATUS: Record<string, string> = {
  INSUFFICIENT_PAYER_BALANCE: "You don't have enough HBAR to pay the network fee.",
  INSUFFICIENT_ACCOUNT_BALANCE: "You don't have enough HBAR for this.",
  INSUFFICIENT_TOKEN_BALANCE: "You don't have enough of that token for this.",
  TOKEN_NOT_ASSOCIATED_TO_ACCOUNT: "The recipient hasn't added this token yet. Ask them to add it first.",
  TRANSACTION_EXPIRED: "This request took too long and expired. Ask the app to try again.",
  DUPLICATE_TRANSACTION: "This was already sent.",
  INVALID_SIGNATURE: "A required signature is missing or wrong.",
  INVALID_ACCOUNT_ID: "That account doesn't exist on Hedera.",
};

const defaultSubmit: Submitter = (signed, ledger, ctx) => submitTransaction(signed, ledger, { fetch: ctx.fetch });

function plainSubmitError(e: unknown): ClipError {
  if (e instanceof ClipError) return e;
  if (e instanceof PrecheckError && e.status === "NOT_SUPPORTED") {
    return new ClipError("Clip Wallet can't send this kind of Hedera transaction yet. Nothing was sent.", "hedera/submit-unsupported", e);
  }
  const status = String((e as { status?: unknown })?.status ?? "");
  return new ClipError(PLAIN_STATUS[status] ?? "Hedera didn't accept this. Nothing was sent. Try again in a moment.", `hedera/submit${status ? `-${status}` : ""}`, e);
}

/** Strips the CAIP-10 prefix: "hedera:testnet:0.0.123" → "0.0.123". Throws on a network mismatch. */
function signerFrom(params: TxParams, request: DappRequest): string | null {
  const raw = params.signerAccountId;
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length === 3) {
    if (`${parts[0]}:${parts[1]}` !== request.networkId) {
      throw new ClipError("This app is asking for a different Hedera network than the one it's connected to.", "hedera/network-mismatch");
    }
    return parts[2]!;
  }
  return raw;
}

export function createHederaModule(options: HederaModuleOptions = {}): HederaModule {
  const submit = options.submit ?? defaultSubmit;
  const gateway = options.ipfsGateway ?? DEFAULT_IPFS_GATEWAY;
  /** HIP-745: a transaction the wallet froze itself must be byte-identical across decode/prepare/finalize. */
  const frozenByRequest = new Map<string, Uint8Array>();

  async function myAccountId(ctx: ChainContext, mirror: Mirror): Promise<string | null> {
    if (ctx.account.hederaAccountId) return ctx.account.hederaAccountId;
    const acct = await mirror.account(ctx.account.address).catch(() => null);
    return acct?.account ?? null;
  }

  function params(request: DappRequest): TxParams {
    const p = request.params;
    if (!p || typeof p !== "object") throw new ClipError("This request is missing its details.", "hedera/bad-params");
    return p as TxParams;
  }

  async function checkSigner(request: DappRequest, ctx: ChainContext, mirror: Mirror): Promise<string | null> {
    const signer = signerFrom(params(request), request);
    const me = await myAccountId(ctx, mirror);
    if (signer && me && stripChecksum(signer) !== me) {
      throw new ClipError("This request is for a different account than the one you connected.", "hedera/wrong-account");
    }
    return me;
  }

  /** The exact transaction bytes this request will sign/submit. */
  async function txBytes(request: DappRequest, ctx: ChainContext, me: string | null): Promise<Uint8Array> {
    const cached = frozenByRequest.get(request.id);
    if (cached) return cached;
    const list = params(request).transactionList;
    if (typeof list !== "string") throw new ClipError("This request is missing its transaction.", "hedera/bad-params");
    const raw = b64decode(list);
    let tx: ParsedTransaction;
    try {
      tx = parseTransaction(raw);
    } catch (cause) {
      throw new ClipError("This transaction can't be read.", "hedera/bad-transaction", cause);
    }
    if (tx.frozen) return raw;
    if (request.method !== HEDERA_METHODS.signAndExecuteTransaction || !me) {
      throw new ClipError("This transaction isn't ready to sign. Ask the app to try again.", "hedera/not-frozen");
    }
    const bytes = freezeIfNeeded(raw, { payer: me, ledger: ledgerOf(request.networkId) });
    frozenByRequest.set(request.id, bytes);
    return bytes;
  }

  /** The wallet's own "sign and hand back the bytes" method (trades) is never a site's to call (audit HED-03). */
  function walletOnly(request: DappRequest): void {
    if (request.method === SIGN_TRANSACTION_BYTES && !isWalletOrigin(request.origin))
      throw new ClipError("Clip Wallet doesn't support this Hedera request yet.", "hedera/unsupported-method");
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const mirror = mirrorFor(ctx);
    const base = { requestId: request.id, networkId: request.networkId, simulated: false } as const;
    const dc = { networkId: request.networkId, me: null as string | null, myAlias: ctx.account.address.toLowerCase(), mirror };
    walletOnly(request);

    switch (request.method) {
      case HEDERA_METHODS.getNodeAddresses:
        return { ...base, title: "Share the list of Hedera nodes", lines: [], balanceChanges: [], blind: false, warnings: [] };

      case HEDERA_METHODS.signMessage: {
        dc.me = await checkSigner(request, ctx, mirror);
        const msg = params(request).message;
        if (typeof msg !== "string") throw new ClipError("This request is missing its message.", "hedera/bad-params");
        return {
          ...base,
          ...titled(bgMsg("bg.req.signMessage", { host: hostOf(request.origin) })),
          lines: [{ label: "Message", value: msg }],
          balanceChanges: [],
          blind: false,
          warnings: [],
        };
      }

      case HEDERA_METHODS.signAndExecuteQuery: {
        dc.me = await checkSigner(request, ctx, mirror);
        const q = params(request).query;
        let kind = "data";
        try {
          kind = queryKind(b64decode(q ?? "")) ?? kind;
        } catch {
          /* fall through */
        }
        return {
          ...base,
          ...titled(bgMsg("bg.hedera.payToRead", { host: hostOf(request.origin) })),
          lines: [{ label: "Request", value: kind }],
          balanceChanges: [],
          blind: false,
          warnings: [],
        };
      }

      case HEDERA_METHODS.signTransaction: {
        dc.me = await checkSigner(request, ctx, mirror);
        const body = params(request).transactionBody;
        if (typeof body !== "string") throw new ClipError("This request is missing its transaction.", "hedera/bad-params");
        let tx: ParsedTransaction;
        try {
          tx = transactionFromBodyBytes(b64decode(body));
        } catch (cause) {
          throw new ClipError("This transaction can't be read.", "hedera/bad-transaction", cause);
        }
        const d = await describeTransaction(tx.body, dc);
        const warnings: Warning[] = [
          ...d.warnings,
          {
            level: "caution",
            code: "network-matters",
            message: `${hostOf(request.origin)} gets your signature and sends the transaction itself. Hedera signatures aren't tied to one network.`,
          },
        ];
        return finish(base, d, tx, dc.me, request, warnings);
      }

      case HEDERA_METHODS.signAndExecuteTransaction:
      case HEDERA_METHODS.executeTransaction:
      case SIGN_TRANSACTION_BYTES: {
        dc.me = await checkSigner(request, ctx, mirror);
        const tx = parseTransaction(await txBytes(request, ctx, dc.me));
        const d = await describeTransaction(tx.body, dc);
        const lines = [...d.lines];
        if (request.method === HEDERA_METHODS.executeTransaction) {
          lines.push({ label: "Signed by", value: `${hostOf(request.origin)} (Clip Wallet only sends it)` });
        }
        if (request.method === SIGN_TRANSACTION_BYTES) {
          lines.push({ label: "Next", value: "The other side approves and sends it. Nothing moves until they do." });
        }
        return finish(base, { ...d, lines }, tx, dc.me, request, d.warnings);
      }

      default:
        throw new ClipError("Clip Wallet doesn't support this Hedera request yet.", "hedera/unsupported-method");
    }
  }

  function finish(
    base: { requestId: string; networkId: string; simulated: false },
    d: Described,
    tx: ParsedTransaction,
    me: string | null,
    request: DappRequest,
    warnings: Warning[],
  ): DecodedRequest {
    const lines = [...d.lines];
    const payerId = tx.body.transactionId?.accountId;
    const payer = payerId ? accountIdString(payerId) : null;
    if (payer && me && payer !== me) lines.push({ label: "Fee paid by", value: payer });
    if (tx.body.memo) lines.push({ label: "Memo", value: tx.body.memo });
    // Like the SDK: a fee of 0 means "not set", so nothing is shown.
    const maxFee = tx.body.fee != null && tx.body.fee > 0n ? tx.body.fee : null;
    const out: DecodedRequest = { ...base, title: d.title, ...msgOf(d), lines, balanceChanges: d.balanceChanges, blind: d.blind, warnings };
    if (maxFee != null && (payer == null || payer === me)) {
      out.fee = { asset: hbarAsset(request.networkId), amount: maxFee.toString() };
      lines.push({ label: "Network fee", value: `up to ${formatUnits(maxFee, 8)} HBAR` });
    }
    return out;
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    walletOnly(request);
    const mirror = mirrorFor(ctx);
    const pk = ecdsaPublicKey(ctx.account.publicKey);
    const payload = (bytes: Uint8Array): SignablePayload => ({ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes, approvalId });

    switch (request.method) {
      case HEDERA_METHODS.getNodeAddresses:
      case HEDERA_METHODS.executeTransaction:
        return [];
      case HEDERA_METHODS.signMessage: {
        await checkSigner(request, ctx, mirror);
        return [payload(digest(prefixMessage(String(params(request).message ?? ""))))];
      }
      case HEDERA_METHODS.signTransaction: {
        await checkSigner(request, ctx, mirror);
        return [payload(digest(b64decode(String(params(request).transactionBody ?? ""))))];
      }
      case HEDERA_METHODS.signAndExecuteTransaction:
      case SIGN_TRANSACTION_BYTES: {
        const me = await checkSigner(request, ctx, mirror);
        const bodies = bodiesToSign(await txBytes(request, ctx, me), pk);
        return bodies.map((b) => payload(digest(b)));
      }
      case HEDERA_METHODS.signAndExecuteQuery:
        throw new ClipError("Paid Hedera data requests aren't supported yet.", "hedera/query-unsupported");
      default:
        throw new ClipError("Clip Wallet doesn't support this Hedera request yet.", "hedera/unsupported-method");
    }
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const mirror = mirrorFor(ctx);
    const pk = ecdsaPublicKey(ctx.account.publicKey);
    const ledger = ledgerOf(request.networkId);
    for (const s of signatures) {
      if (s.scheme !== "ecdsa-secp256k1") throw new ClipError("The signature is the wrong kind for Hedera.", "hedera/bad-signature");
    }
    const sigs = signatures.map((s) => s.bytes);
    const one = (message: Uint8Array): Uint8Array => {
      const sig = sigs.find((s) => verifyEcdsa(pk, message, s));
      if (!sig) throw new ClipError("The signature didn't match. Nothing was sent.", "hedera/bad-signature");
      return sig;
    };

    switch (request.method) {
      case HEDERA_METHODS.getNodeAddresses:
        return { nodes: Object.keys(GRPC_WEB_NODES[ledger]) };
      case HEDERA_METHODS.signMessage: {
        const sig = one(prefixMessage(String(params(request).message ?? "")));
        return { signatureMap: signatureMapBase64(pk, sig) };
      }
      case HEDERA_METHODS.signTransaction: {
        const sig = one(b64decode(String(params(request).transactionBody ?? "")));
        return { signatureMap: signatureMapBase64(pk, sig) };
      }
      case HEDERA_METHODS.executeTransaction: {
        let tx: Uint8Array;
        try {
          tx = b64decode(String(params(request).transactionList ?? ""));
          parseTransaction(tx);
        } catch (cause) {
          throw new ClipError("This transaction can't be read.", "hedera/bad-transaction", cause);
        }
        try {
          return await submit(tx, ledger, ctx);
        } catch (e) {
          throw plainSubmitError(e);
        }
      }
      case HEDERA_METHODS.signAndExecuteTransaction:
      case SIGN_TRANSACTION_BYTES: {
        const me = await checkSigner(request, ctx, mirror);
        const bytes = await txBytes(request, ctx, me);
        let tx: Uint8Array;
        try {
          tx = attachSignatures(bytes, pk, sigs);
        } catch (cause) {
          throw new ClipError("The signature didn't match. Nothing was sent.", "hedera/bad-signature", cause);
        }
        frozenByRequest.delete(request.id);
        if (request.method === SIGN_TRANSACTION_BYTES) return { transactionList: b64encode(tx) };
        try {
          return await submit(tx, ledger, ctx);
        } catch (e) {
          throw plainSubmitError(e);
        }
      }
      default:
        throw new ClipError("Clip Wallet doesn't support this Hedera request yet.", "hedera/unsupported-method");
    }
  }

  async function getAccountState(ctx: ChainContext): Promise<HederaAccountState> {
    const mirror = mirrorFor(ctx);
    const id = ctx.account.hederaAccountId ?? ctx.account.address;
    const acct = await mirror.account(id);
    if (!acct) {
      return {
        accountId: null,
        evmAddress: ctx.account.address,
        maxAutoAssociations: -1,
        usedAutoAssociations: 0,
        freeAutoAssociationSlots: null,
        associations: [],
        staking: { nodeId: null, accountId: null, declineReward: false, pendingRewardTinybars: "0" },
      };
    }
    const rels = await mirror.tokenRelationships(acct.account);
    const used = rels.filter((r) => r.automatic_association).length;
    const max = acct.max_automatic_token_associations;
    return {
      accountId: acct.account,
      evmAddress: acct.evm_address ?? ctx.account.address,
      maxAutoAssociations: max,
      usedAutoAssociations: used,
      freeAutoAssociationSlots: max === -1 ? null : Math.max(0, max - used),
      associations: rels.map((r) => ({ tokenId: r.token_id, automatic: r.automatic_association, frozen: r.freeze_status === "FROZEN", balance: String(r.balance) })),
      staking: {
        nodeId: acct.staked_node_id,
        accountId: acct.staked_account_id,
        declineReward: acct.decline_reward,
        pendingRewardTinybars: String(acct.pending_reward ?? 0),
      },
    };
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const mirror = mirrorFor(ctx);
    const acct = await mirror.account(ctx.account.hederaAccountId ?? ctx.account.address);
    const hbar = hbarAsset(ctx.network.id);
    if (!acct) return [{ asset: hbar, amount: "0" }];
    const out: TokenBalance[] = [{ asset: hbar, amount: BigInt(acct.balance.balance).toString() }];
    const rels = await mirror.tokenRelationships(acct.account);
    const infos = await Promise.all(rels.map((r) => mirror.token(r.token_id).catch(() => null)));
    rels.forEach((r, i) => {
      const info = infos[i];
      if (info?.type === "NON_FUNGIBLE_UNIQUE") return; // shown by getNfts
      // Associated tokens are listed even at zero: on Hedera, "added to your account" is visible state.
      out.push({
        asset: {
          key: tokenAssetKey(ctx.network.id, r.token_id),
          symbol: info?.symbol || r.token_id,
          name: info?.name || `Token ${r.token_id}`,
          decimals: info ? Number(info.decimals) : (r.decimals ?? 0),
          networkId: ctx.network.id,
          address: r.token_id,
        },
        amount: BigInt(r.balance).toString(),
      });
    });
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const mirror = mirrorFor(ctx);
    const acct = await mirror.account(ctx.account.hederaAccountId ?? ctx.account.address);
    if (!acct) return [];
    const nfts = (await mirror.nfts(acct.account)).filter((n) => !n.deleted);
    const out: Nft[] = [];
    const queue = [...nfts];
    const worker = async () => {
      for (let n = queue.shift(); n; n = queue.shift()) {
        const info = await mirror.token(n.token_id).catch(() => null);
        const uri = metadataUri(n.metadata);
        const meta = uri ? await fetchHip412(uri, ctx.fetch, gateway) : null;
        const nft: Nft = {
          networkId: ctx.network.id,
          standard: "hts-nft",
          collection: { address: n.token_id, name: info?.name || n.token_id },
          tokenId: String(n.serial_number),
        };
        const name = meta?.name ?? (info ? `${info.name} #${n.serial_number}` : undefined);
        if (name) nft.name = name;
        if (meta?.image) nft.mediaUrl = meta.image; // untrusted: render via the sandboxed media proxy only
        if (meta?.attributes?.length) nft.attributes = meta.attributes;
        out.push(nft);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, nfts.length) }, worker));
    return out.sort((a, b) => a.collection.address.localeCompare(b.collection.address) || Number(a.tokenId) - Number(b.tokenId));
  }

  return {
    family: "hedera",
    curve: "secp256k1",
    /**
     * BIP-44 coin type 3030 (Hedera), the path the Hiero SDK uses for ECDSA keys
     * (Mnemonic.toStandardECDSAsecp256k1PrivateKey) and the one the vault derives Hedera accounts at, so a Hedera
     * account's key is not the EVM account's key of the same index. The vault owns derivation; this reports its path.
     */
    derivationPath: (index: number) => `m/44'/3030'/0'/0/${index}`,
    // EIP-55, like the vault's account address the wallet shows (dapp matrix: the two differed only in case).
    addressFromPublicKey: (publicKey: Uint8Array) => checksumAlias(aliasAddress(publicKey)),
    isAddress: (value: string) => isAccountId(value) || isEvmAddress(value),
    networksForAddress(value: string, candidates: Network[]): Network[] {
      const v = value.trim();
      const hedera = candidates.filter((n) => n.family === "hedera");
      if (!isAccountId(v) && !isEvmAddress(v)) return [];
      const checksum = /-([a-z]{5})$/.exec(v)?.[1];
      if (!checksum) return hedera; // 0.0.x exists separately on every network
      const plain = stripChecksum(v);
      return hedera.filter((n) => {
        try {
          return entityChecksum(LEDGER_ID_BYTES[ledgerOf(n.id)], plain) === checksum;
        } catch {
          return false;
        }
      });
    },
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    getAccountState,
    buildNftTransfer,
    buildAssociate,
    buildDissociate,
    buildStakeUpdate,
    buildAtomicSwap,
    buildScheduleSign,
  };
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

/** The Msg a described title carries (explicit titles keep it through the mapping to a DecodedRequest). */
function msgOf(d: { title: string }): { titleMsg?: Msg } {
  const m = (d as { titleMsg?: Msg }).titleMsg;
  return m ? { titleMsg: m } : {};
}
