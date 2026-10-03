import {
  type AssetRef,
  type ChainContext,
  type ChainModule,
  ClipError,
  type DappRequest,
  type DecodedRequest,
  type Network,
  type Nft,
  type Signature,
  type SignablePayload,
  type TokenBalance,
  type Warning,
} from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getTransactionEncoder,
  type Instruction,
  isAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { findAssociatedTokenPda, getCreateAssociatedTokenIdempotentInstruction, getTransferCheckedInstruction } from "@solana-program/token";
import { type Described, describeTransaction, plainSolanaError } from "./describe.js";
import { clusterOf, fromChainId, solAsset } from "./networks.js";
import { type ParsedAccount, RpcError, SolanaRpc, getMultipleAccounts } from "./rpc.js";
import { type SignInInput, createSignInMessageText } from "./siws.js";
import {
  TOKEN_PROGRAMS,
  assetFor,
  dasCompressedNfts,
  fetchOffchain,
  mintInfos,
  ownerTokenAccounts,
  toTokenAccount,
} from "./tokens.js";
import { decodeWire, looksLikeTransaction, parseTransaction, withSignature } from "./tx.js";
import { b64encode, formatUnits, hex, hostOf, randomId, toBytes } from "./util.js";

/** Injected (Wallet Standard via 1Mask) and WalletConnect method names. */
export const SOLANA_METHODS = {
  signTransaction: "solana:signTransaction",
  signAndSendTransaction: "solana:signAndSendTransaction",
  signMessage: "solana:signMessage",
  signIn: "solana:signIn",
  wcSignTransaction: "solana_signTransaction",
  wcSignAndSendTransaction: "solana_signAndSendTransaction",
  wcSignAllTransactions: "solana_signAllTransactions",
  wcSignMessage: "solana_signMessage",
} as const;

export interface SolanaModuleOptions {
  /** DAS API endpoint (per network id, or one for all) for compressed NFTs. */
  dasUrl?: string | Record<string, string>;
  ipfsGateway?: string;
  /** Run simulateTransaction in decode() (default true). */
  simulate?: boolean;
}

type Normalized =
  | { kind: "tx"; send: boolean; wc: boolean; txs: Uint8Array[]; sendOptions: Record<string, unknown> }
  | { kind: "message"; wc: boolean; messages: Uint8Array[] }
  | { kind: "signIn"; inputs: (SignInInput & { domain: string; address: string })[] };

function bad(what: string): ClipError {
  return new ClipError(`This request is missing its ${what}.`, "solana/bad-params");
}

function accountAddress(a: unknown): string | null {
  if (typeof a === "string") return a;
  if (a && typeof a === "object" && typeof (a as { address?: unknown }).address === "string") return (a as { address: string }).address;
  return null;
}

function inputsOf(params: unknown): Record<string, unknown>[] {
  if (Array.isArray(params)) return params as Record<string, unknown>[];
  if (params && typeof params === "object") {
    const p = params as { inputs?: unknown };
    if (Array.isArray(p.inputs)) return p.inputs as Record<string, unknown>[];
    return [params as Record<string, unknown>];
  }
  throw bad("details");
}

export function normalize(request: DappRequest, me: string): Normalized {
  const checkInput = (i: Record<string, unknown>) => {
    const acct = accountAddress(i.account);
    if (acct && acct !== me) throw new ClipError("This request is for a different account than the one you connected.", "solana/wrong-account");
    if (typeof i.chain === "string" && fromChainId(i.chain) !== request.networkId) {
      throw new ClipError("This app is asking for a different Solana network than the one it's connected to.", "solana/network-mismatch");
    }
  };
  const p = (request.params ?? {}) as Record<string, unknown>;
  switch (request.method) {
    case SOLANA_METHODS.signTransaction:
    case SOLANA_METHODS.signAndSendTransaction: {
      const inputs = inputsOf(request.params);
      if (!inputs.length) throw bad("transaction");
      inputs.forEach(checkInput);
      return {
        kind: "tx",
        send: request.method === SOLANA_METHODS.signAndSendTransaction,
        wc: false,
        txs: inputs.map((i) => toBytes(i.transaction, "transaction")),
        sendOptions: (inputs[0]?.options as Record<string, unknown> | undefined) ?? {},
      };
    }
    case SOLANA_METHODS.wcSignTransaction:
    case SOLANA_METHODS.wcSignAndSendTransaction:
      if (p.transaction == null) throw bad("transaction");
      return {
        kind: "tx",
        send: request.method === SOLANA_METHODS.wcSignAndSendTransaction,
        wc: true,
        txs: [toBytes(p.transaction, "transaction")],
        sendOptions: (p.sendOptions as Record<string, unknown> | undefined) ?? {},
      };
    case SOLANA_METHODS.wcSignAllTransactions:
      if (!Array.isArray(p.transactions) || !p.transactions.length) throw bad("transactions");
      return { kind: "tx", send: false, wc: true, txs: p.transactions.map((t) => toBytes(t, "transaction")), sendOptions: {} };
    case SOLANA_METHODS.signMessage: {
      const inputs = inputsOf(request.params);
      inputs.forEach(checkInput);
      return { kind: "message", wc: false, messages: inputs.map((i) => toBytes(i.message, "message")) };
    }
    case SOLANA_METHODS.wcSignMessage: {
      if (typeof p.message !== "string") throw bad("message");
      if (typeof p.pubkey === "string" && p.pubkey !== me) {
        throw new ClipError("This request is for a different account than the one you connected.", "solana/wrong-account");
      }
      return { kind: "message", wc: true, messages: [new Uint8Array(getBase58Encoder().encode(p.message))] };
    }
    case SOLANA_METHODS.signIn: {
      const host = hostOf(request.origin);
      const inputs = inputsOf(request.params ?? {}).map((i) => {
        const input = i as SignInInput;
        if (input.address && input.address !== me) {
          throw new ClipError("This sign-in is for a different account than the one you connected.", "solana/wrong-account");
        }
        return { ...input, domain: input.domain ?? host, address: input.address ?? me };
      });
      return { kind: "signIn", inputs: inputs.length ? inputs : [{ domain: host, address: me }] };
    }
    default:
      throw new ClipError("Clip Wallet doesn't support this Solana request yet.", "solana/unsupported-method");
  }
}

function rpcFor(ctx: ChainContext): SolanaRpc {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("No Solana connection is set up for this network.", "solana/no-rpc");
  return new SolanaRpc(url, ctx.fetch);
}

const MESSAGE_REFUSAL = "This “message” is really a transaction in disguise. Clip Wallet won't sign it.";

function textOf(bytes: Uint8Array): string | null {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // Printable text only (allow newlines / tabs).
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s) ? null : s;
  } catch {
    return null;
  }
}

export function createSolanaModule(options: SolanaModuleOptions = {}): ChainModule & {
  normalize: typeof normalize;
} {
  const gateway = options.ipfsGateway ?? "https://ipfs.io/ipfs/";

  function dasUrlFor(networkId: string): string | null {
    if (!options.dasUrl) return null;
    return typeof options.dasUrl === "string" ? options.dasUrl : (options.dasUrl[networkId] ?? null);
  }

  async function describeAll(txs: Uint8Array[], ctx: ChainContext, simulate: boolean): Promise<{ d: Described; signerOk: boolean[] }> {
    const rpc = rpcFor(ctx);
    const me = ctx.account.address;
    const ds: Described[] = [];
    const signerOk: boolean[] = [];
    for (const wire of txs) {
      let parsed;
      try {
        parsed = await parseTransaction(wire, rpc);
      } catch (cause) {
        throw new ClipError("This transaction can't be read.", "solana/bad-transaction", cause);
      }
      signerOk.push(parsed.signers.includes(me));
      ds.push(await describeTransaction(parsed, { networkId: ctx.network.id, me, rpc, cacheKey: ctx.network.rpcUrls[0] ?? "", simulate }));
    }
    if (ds.length === 1) return { d: ds[0]!, signerOk };
    const sum = new Map<string, { asset: AssetRef; delta: bigint }>();
    for (const c of ds.flatMap((d) => d.balanceChanges)) {
      const k = c.asset.address ?? c.asset.key;
      const e = sum.get(k) ?? { asset: c.asset, delta: 0n };
      e.delta += BigInt(c.delta);
      sum.set(k, e);
    }
    const warnings: Warning[] = [];
    for (const w of ds.flatMap((d) => d.warnings)) if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w);
    return {
      d: {
        title: `Approve ${ds.length} transactions`,
        lines: ds.flatMap((d, i) => [{ label: `Transaction ${i + 1}`, value: d.title }, ...d.lines]),
        balanceChanges: [...sum.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() })),
        warnings,
        blind: ds.some((d) => d.blind),
        simulated: ds.every((d) => d.simulated),
        fee: ds.reduce((a, d) => a + d.fee, 0n),
      },
      signerOk,
    };
  }

  async function decode(request: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
    const me = ctx.account.address;
    const n = normalize(request, me);
    const base = { requestId: request.id, networkId: request.networkId };
    const host = hostOf(request.origin);

    if (n.kind === "tx") {
      const { d, signerOk } = await describeAll(n.txs, ctx, options.simulate ?? true);
      if (!signerOk.some(Boolean)) throw new ClipError("This transaction doesn't need your signature.", "solana/not-a-signer");
      const fee = { asset: solAsset(ctx.network.id), amount: d.fee.toString() };
      const lines = [...d.lines, { label: "Network fee", value: `${formatUnits(d.fee, 9)} SOL` }];
      if (!n.send) lines.push({ label: "Sent by", value: `${host} (it gets the signed transaction)` });
      return { ...base, title: d.title, lines, balanceChanges: d.balanceChanges, fee, simulated: d.simulated, blind: d.blind, warnings: d.warnings };
    }

    if (n.kind === "message") {
      const lines: { label: string; value: string }[] = [];
      let blind = false;
      for (const m of n.messages) {
        if (looksLikeTransaction(m)) throw new ClipError(MESSAGE_REFUSAL, "solana/message-is-transaction");
        const text = textOf(m);
        if (text != null) lines.push({ label: "Message", value: text });
        else {
          blind = true;
          lines.push({ label: "Message (not text)", value: `0x${hex(m)}` });
        }
      }
      const warnings: Warning[] = blind ? [{ level: "danger", code: "blind-signing", message: "This message isn't readable text. Only sign it if you trust the app." }] : [];
      return { ...base, title: `Sign a message for ${host}`, lines, balanceChanges: [], simulated: false, blind, warnings };
    }

    const warnings: Warning[] = [];
    const lines: { label: string; value: string }[] = [];
    for (const input of n.inputs) {
      if (input.domain !== host) {
        warnings.push({
          level: "danger",
          code: "domain-mismatch",
          message: `This sign-in is for ${input.domain}, but the request comes from ${host}. It may be a phishing site.`,
        });
      }
      if (input.statement) lines.push({ label: "Statement", value: input.statement });
      if (input.uri) lines.push({ label: "Website", value: input.uri });
      if (input.expirationTime) lines.push({ label: "Valid until", value: input.expirationTime });
      if (input.resources?.length) lines.push({ label: "Also grants access to", value: input.resources.join(", ") });
    }
    return {
      ...base,
      title: `Sign in to ${n.inputs[0]!.domain}`,
      lines,
      balanceChanges: [],
      simulated: false,
      blind: false,
      warnings,
    };
  }

  /** The exact bytes to sign, in the order prepare() returns them. */
  function signables(n: Normalized, me: string): { index: number; bytes: Uint8Array }[] {
    if (n.kind === "tx") {
      return n.txs.flatMap((wire, index) => {
        const parsed = (() => {
          try {
            return parseSync(wire);
          } catch (cause) {
            throw new ClipError("This transaction can't be read.", "solana/bad-transaction", cause);
          }
        })();
        return parsed.signers.includes(me) ? [{ index, bytes: new Uint8Array(parsed.messageBytes) }] : [];
      });
    }
    if (n.kind === "message") {
      return n.messages.map((m, index) => {
        if (looksLikeTransaction(m)) throw new ClipError(MESSAGE_REFUSAL, "solana/message-is-transaction");
        return { index, bytes: m };
      });
    }
    return n.inputs.map((input, index) => ({ index, bytes: new TextEncoder().encode(createSignInMessageText(input)) }));
  }

  async function prepare(request: DappRequest, ctx: ChainContext, approvalId: string): Promise<SignablePayload[]> {
    const me = ctx.account.address;
    const n = normalize(request, me);
    const list = signables(n, me);
    if (!list.length) throw new ClipError("This transaction doesn't need your signature.", "solana/not-a-signer");
    // Hardware wallets need to know whether the bytes are a transaction message or an off-chain message.
    const format = n.kind === "tx" ? "solana-tx" : "solana-message";
    return list.map((s) => ({ accountId: ctx.account.id, scheme: "ed25519", bytes: s.bytes, approvalId, raw: { format, bytes: s.bytes } }));
  }

  async function finalize(request: DappRequest, signatures: Signature[], ctx: ChainContext): Promise<unknown> {
    const me = ctx.account.address;
    const n = normalize(request, me);
    const list = signables(n, me);
    if (signatures.length !== list.length) throw new ClipError("Some signatures are missing. Nothing was sent.", "solana/bad-signature");
    const pub = new Uint8Array(getAddressEncoder().encode(address(me)));
    const sigs = list.map((s, i) => {
      const sig = signatures[i]!;
      if (sig.scheme !== "ed25519" || !ed25519.verify(sig.bytes, s.bytes, pub)) {
        throw new ClipError("The signature didn't match. Nothing was sent.", "solana/bad-signature");
      }
      return sig.bytes;
    });
    const b58 = (b: Uint8Array) => getBase58Decoder().decode(b);

    if (n.kind === "tx") {
      const signed = n.txs.map((wire) => wire);
      list.forEach((s, i) => {
        signed[s.index] = withSignature(parseSync(n.txs[s.index]!).transaction, me, sigs[i]!);
      });
      if (n.send) {
        const rpc = rpcFor(ctx);
        const sent: string[] = [];
        for (const wire of signed) sent.push(await send(rpc, wire, n.sendOptions));
        if (n.wc) return { signature: sent[0] };
        return sent.map((s) => ({ signature: b64encode(new Uint8Array(getBase58Encoder().encode(s))) }));
      }
      if (request.method === SOLANA_METHODS.wcSignAllTransactions) return { transactions: signed.map(b64encode) };
      if (n.wc) return { signature: b58(sigs[0]!), transaction: b64encode(signed[0]!) };
      return signed.map((w) => ({ signedTransaction: b64encode(w) }));
    }
    if (n.kind === "message") {
      if (n.wc) return { signature: b58(sigs[0]!) };
      return list.map((s, i) => ({ signedMessage: b64encode(s.bytes), signature: b64encode(sigs[i]!) }));
    }
    return list.map((s, i) => ({
      account: { address: me, publicKey: hex(pub) },
      signedMessage: b64encode(s.bytes),
      signature: b64encode(sigs[i]!),
      signatureType: "ed25519",
    }));
  }

  async function send(rpc: SolanaRpc, wire: Uint8Array, opts: Record<string, unknown>): Promise<string> {
    const config: Record<string, unknown> = { encoding: "base64", skipPreflight: false, preflightCommitment: opts.preflightCommitment ?? "confirmed" };
    if (typeof opts.maxRetries === "number") config.maxRetries = opts.maxRetries;
    if (typeof opts.minContextSlot === "number") config.minContextSlot = opts.minContextSlot;
    try {
      return await rpc.call<string>("sendTransaction", [b64encode(wire), config]);
    } catch (e) {
      if (e instanceof RpcError) {
        const logs = (e.data as { logs?: string[] } | undefined)?.logs ?? [];
        throw new ClipError(plainSolanaError(`${e.message}\n${JSON.stringify(e.data ?? "")}\n${logs.join("\n")}`), "solana/send-failed", e);
      }
      throw e;
    }
  }

  async function getBalances(ctx: ChainContext): Promise<TokenBalance[]> {
    const rpc = rpcFor(ctx);
    const me = ctx.account.address;
    const bal = await rpc.call<{ value: number }>("getBalance", [me, { commitment: "confirmed" }]);
    const out: TokenBalance[] = [{ asset: solAsset(ctx.network.id), amount: BigInt(bal.value).toString() }];
    const accounts = await ownerTokenAccounts(rpc, me);
    const infos = await mintInfos(rpc, accounts.map((a) => a.mint), ctx.network.id, ctx.network.rpcUrls[0]);
    const byMint = new Map<string, bigint>();
    for (const a of accounts) {
      const info = infos.get(a.mint);
      if (a.decimals === 0 && info?.supply === "1") continue; // NFT, shown by getNfts
      byMint.set(a.mint, (byMint.get(a.mint) ?? 0n) + a.amount);
    }
    for (const [mint, amount] of byMint) out.push({ asset: assetFor(ctx.network.id, mint, infos.get(mint)), amount: amount.toString() });
    return out;
  }

  async function getNfts(ctx: ChainContext): Promise<Nft[]> {
    const rpc = rpcFor(ctx);
    const me = ctx.account.address;
    const accounts = (await ownerTokenAccounts(rpc, me)).filter((a) => a.decimals === 0 && a.amount === 1n);
    const infos = await mintInfos(rpc, accounts.map((a) => a.mint), ctx.network.id, ctx.network.rpcUrls[0]);
    const out: Nft[] = [];
    for (const a of accounts) {
      const info = infos.get(a.mint);
      if (!info || info.supply !== "1") continue;
      const off = await fetchOffchain(info.uri, ctx.fetch, gateway);
      const nft: Nft = {
        networkId: ctx.network.id,
        standard: "metaplex",
        collection: { address: info.collection ?? a.mint, name: info.symbol || info.name || "Collection" },
        tokenId: a.mint,
      };
      const name = off?.name ?? info.name;
      if (name) nft.name = name;
      if (off?.image) nft.mediaUrl = off.image; // untrusted: sandboxed media proxy only
      if (off?.attributes?.length) nft.attributes = off.attributes;
      out.push(nft);
    }
    const das = dasUrlFor(ctx.network.id);
    if (das) {
      const compressed = await dasCompressedNfts(das, me, ctx.network.id, ctx.fetch, gateway).catch(() => []);
      for (const c of compressed) if (!out.some((o) => o.tokenId === c.tokenId)) out.push(c);
    }
    return out;
  }

  async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
    const rpc = rpcFor(ctx);
    const me = address(ctx.account.address);
    if (!isAddress(p.to.trim())) throw new ClipError("That doesn't look like a Solana address.", "solana/bad-address");
    const to = address(p.to.trim());
    if (to === me) throw new ClipError("That's your own address.", "solana/self-transfer");
    if (!/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter an amount greater than zero.", "solana/bad-amount");
    const amount = BigInt(p.amount);
    const signer = createNoopSigner(me);
    const instructions: Instruction[] = [];

    const [recipient] = await getMultipleAccounts(rpc, [to], "jsonParsed");
    if (recipient && TOKEN_PROGRAMS.includes(recipient.owner)) {
      throw new ClipError("That's a token account, not a wallet address. Ask the recipient for their wallet address.", "solana/token-account-recipient");
    }

    if (!p.asset.address) {
      instructions.push(getTransferSolInstruction({ source: signer, destination: to, amount }));
    } else {
      const mint = address(p.asset.address);
      const info = (await mintInfos(rpc, [mint], ctx.network.id, ctx.network.rpcUrls[0])).get(mint);
      if (!info) throw new ClipError("That token couldn't be found on Solana.", "solana/unknown-mint");
      const tokenProgram = address(info.program);
      const mine = await rpc.call<{ value: { pubkey: string; account: ParsedAccount }[] }>("getTokenAccountsByOwner", [
        me,
        { mint },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
      const source = mine.value
        .map((v) => toTokenAccount(v.pubkey, v.account))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .sort((a, b) => (b.amount > a.amount ? 1 : -1))[0];
      if (!source || source.amount < amount) {
        throw new ClipError(`You don't have enough ${info.symbol ?? "of that token"}.`, "solana/insufficient-token");
      }
      const [ata] = await findAssociatedTokenPda({ owner: to, mint, tokenProgram });
      const [existing] = await getMultipleAccounts(rpc, [ata], "base64");
      if (!existing) {
        instructions.push(getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata, owner: to, mint, tokenProgram }));
      }
      instructions.push(
        getTransferCheckedInstruction(
          { source: address(source.address), mint, destination: ata, authority: signer, amount, decimals: info.decimals },
          { programAddress: tokenProgram },
        ),
      );
    }

    const { value: latest } = await rpc.call<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(me, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.blockhash as never, lastValidBlockHeight: BigInt(latest.lastValidBlockHeight) }, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
    const cluster = clusterOf(ctx.network.id);
    return {
      id: randomId(),
      origin: "clip-wallet",
      via: "injected",
      family: "solana",
      networkId: ctx.network.id,
      method: SOLANA_METHODS.signAndSendTransaction,
      params: { inputs: [{ account: me, transaction: b64encode(wire), chain: cluster ? `solana:${cluster}` : ctx.network.id }] },
    };
  }

  return {
    family: "solana",
    curve: "ed25519",
    /** Phantom / Solflare / Backpack path (SLIP-0010, all hardened). */
    derivationPath: (index: number) => `m/44'/501'/${index}'/0'`,
    addressFromPublicKey(publicKey: Uint8Array): string {
      if (publicKey.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
      return getAddressDecoder().decode(publicKey);
    },
    isAddress: (value: string) => isAddress(value.trim()),
    /** The same address works on every cluster, so every Solana candidate qualifies. */
    networksForAddress: (value: string, candidates: Network[]) => (isAddress(value.trim()) ? candidates.filter((c) => c.family === "solana") : []),
    getBalances,
    getNfts,
    decode,
    prepare,
    finalize,
    buildTransfer,
    normalize,
  };
}

/** Signing only needs the message bytes and signer list, which don't depend on lookup tables. */
function parseSync(wire: Uint8Array) {
  const { transaction, compiled } = decodeWire(wire);
  return {
    transaction,
    messageBytes: transaction.messageBytes,
    signers: compiled.staticAccounts.slice(0, compiled.header.numSignerAccounts).map(String),
  };
}

