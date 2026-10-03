import { ClipError, type DappRequest } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  type Instruction,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLifetimeUsingDurableNonce,
} from "@solana/kit";
import { getAdvanceNonceAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import { getApproveInstruction } from "@solana-program/token";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SOLANA_CLUSTERS,
  SOLANA_DEVNET,
  SOLANA_MAINNET,
  SOLANA_NETWORKS,
  clearTokenCache,
  createSignInMessageText,
  createSolanaModule,
  fromChainId,
  looksLikeTransaction,
  solAsset,
  toWalletStandardChain,
  tokenAssetKey,
} from "../src/index.js";
import { b64decode, b64encode } from "../src/util.js";
import { TOKEN, TOKEN22, ctxFor, fixtureSigner, makeAccount, metaplexData, mintAccount, mockSolana, tokenAccount } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const BOB = FIX.bob;
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const signer = fixtureSigner(ME, [FIX.solTransferSig, FIX.usdcTransferSig, FIX.messageSig, FIX.siwsSig]);
const SIWS_INPUT = { domain: "app.example", statement: "Sign in to App", uri: "https://app.example", version: "1", nonce: "abc12345", issuedAt: "2026-10-03T00:00:00Z" };

function req(method: string, params: unknown, origin = "https://app.example", via: DappRequest["via"] = "injected"): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin, via, family: "solana", networkId: SOLANA_DEVNET.id, method, params };
}
const ws = (method: string, transaction: string, extra: Record<string, unknown> = {}) =>
  req(method, { inputs: [{ account: ME, transaction, chain: "solana:devnet", ...extra }] });

/** Unsigned v0 transaction (decode-only fixtures need no signature). */
function build(ixs: Instruction[], feePayer: string = ME, tweak?: (m: ReturnType<typeof baseMessage>) => Parameters<typeof compileTransaction>[0]): string {
  const m = baseMessage(ixs, feePayer);
  return b64encode(new Uint8Array(getTransactionEncoder().encode(compileTransaction(tweak ? tweak(m) : m))));
}
function baseMessage(ixs: Instruction[], feePayer: string) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: FIX.blockhash as never, lastValidBlockHeight: 100n }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
}

/** Default chain state: I hold 10 devnet USDC in my ATA; bob has no USDC account yet. */
const accounts: Record<string, unknown> = {
  [USDC]: mintAccount(6, "1000000000000000"),
  [FIX.myUsdcAta]: tokenAccount(USDC, ME, "10000000", 6),
};
const rpcBase = (extra: Record<string, unknown> = {}) => ({
  getMultipleAccounts: (p: unknown[]) => ({ context: { slot: 1 }, value: (p[0] as string[]).map((a) => ({ ...accounts, ...extra })[a] ?? null) }),
});

beforeEach(() => clearTokenCache());

describe("networks", () => {
  it("maps Wallet Standard chains and CAIP-2 genesis-hash ids", () => {
    expect(SOLANA_DEVNET.id).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
    expect(SOLANA_MAINNET.id).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(SOLANA_CLUSTERS.testnet.caip2).toBe("solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z");
    for (const c of Object.values(SOLANA_CLUSTERS)) expect(c.caip2).toBe(`solana:${c.genesisHash.slice(0, 32)}`);
    expect(toWalletStandardChain(SOLANA_DEVNET.id)).toBe("solana:devnet");
    expect(fromChainId("solana:mainnet")).toBe(SOLANA_MAINNET.id);
    expect(fromChainId(`solana:${SOLANA_CLUSTERS.devnet.genesisHash}`)).toBe(SOLANA_DEVNET.id);
    expect(tokenAssetKey(SOLANA_DEVNET.id, USDC)).toBe("usdc");
    expect(tokenAssetKey(SOLANA_MAINNET.id, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("usdc");
    expect(solAsset(SOLANA_DEVNET.id)).toMatchObject({ key: "sol", decimals: 9 });
  });

  it("addresses", () => {
    const m = createSolanaModule();
    expect(m.addressFromPublicKey(new Uint8Array(getAddressEncoder().encode(address(ME))), SOLANA_DEVNET)).toBe(ME);
    expect(m.isAddress(ME)).toBe(true);
    expect(m.isAddress("0x1234")).toBe(false);
    expect(m.networksForAddress(ME, SOLANA_NETWORKS)).toHaveLength(3);
    expect(m.derivationPath(1)).toBe("m/44'/501'/1'/0'");
  });
});

describe("decode", () => {
  const setup = (methods: Record<string, (p: unknown[]) => unknown> = {}, opts = { simulate: false }) => {
    const mock = mockSolana({ ...rpcBase(), ...methods });
    return { m: createSolanaModule(opts), ctx: ctxFor(makeAccount(ME), mock.fetch), calls: mock.calls };
  };

  it("SOL transfer with priority fee", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(ws("solana:signAndSendTransaction", FIX.solTransfer), ctx);
    expect(d.title).toBe(`Send 1.5 SOL to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([{ asset: solAsset(SOLANA_DEVNET.id), delta: "-1500000000" }]);
    expect(d.fee).toEqual({ asset: solAsset(SOLANA_DEVNET.id), amount: "5200" }); // 5000 + 1000 µlamports × 200k CU
    expect(d.lines).toContainEqual({ label: "To", value: `${BOB} gets 1.5 SOL` });
  });

  it("USDC transfer that opens the recipient's account", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(ws("solana:signAndSendTransaction", FIX.usdcTransfer), ctx);
    expect(d.title).toBe(`Send 2.5 USDC to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(d.lines).toContainEqual({ label: "Also", value: "Also opens a USDC account for the recipient (≈0.002 SOL)" });
    expect(d.balanceChanges).toEqual(
      expect.arrayContaining([
        { asset: expect.objectContaining({ key: "usdc", symbol: "USDC", decimals: 6 }), delta: "-2500000" },
        { asset: solAsset(SOLANA_DEVNET.id), delta: "-2039280" },
      ]),
    );
  });

  it("simulation drives balance changes (fee shown separately)", async () => {
    const { m, ctx, calls } = setup(
      {
        simulateTransaction: () => ({
          context: { slot: 1 },
          value: {
            err: null,
            fee: 5000,
            logs: [],
            preBalances: [3_000_000_000, 0, 1, 1, 1, 1],
            postBalances: [3_000_000_000 - 2_039_280 - 5_000, 2_039_280, 1, 1, 1, 1],
            preTokenBalances: [{ accountIndex: 2, mint: USDC, owner: ME, uiTokenAmount: { amount: "10000000", decimals: 6 } }],
            postTokenBalances: [
              { accountIndex: 2, mint: USDC, owner: ME, uiTokenAmount: { amount: "7500000", decimals: 6 } },
              { accountIndex: 1, mint: USDC, owner: BOB, uiTokenAmount: { amount: "2500000", decimals: 6 } },
            ],
            loadedAddresses: { writable: [], readonly: [] },
          },
        }),
      },
      { simulate: true },
    );
    const d = await m.decode(ws("solana:signAndSendTransaction", FIX.usdcTransfer), ctx);
    expect(d.simulated).toBe(true);
    expect(d.balanceChanges).toEqual([
      { asset: solAsset(SOLANA_DEVNET.id), delta: "-2039280" },
      { asset: expect.objectContaining({ key: "usdc" }), delta: "-2500000" },
    ]);
    expect(d.fee!.amount).toBe("5000");
    const sim = calls.find((c) => c.method === "simulateTransaction")!;
    expect(sim.params[1]).toMatchObject({ sigVerify: false, replaceRecentBlockhash: true, accounts: { addresses: [ME] } });
  });

  it("failed simulation → plain-language warning", async () => {
    const { m, ctx } = setup({ simulateTransaction: () => ({ context: { slot: 1 }, value: { err: "InsufficientFundsForFee", logs: [], fee: null } }) }, { simulate: true });
    const d = await m.decode(ws("solana:signAndSendTransaction", FIX.solTransfer), ctx);
    expect(d.simulated).toBe(false);
    expect(d.warnings).toContainEqual({ level: "caution", code: "simulation-failed", message: "You don't have enough SOL to pay the network fee." });
  });

  it("approve: unlimited → danger, bounded → caution", async () => {
    const { m, ctx } = setup();
    const tx = (amount: bigint) => build([getApproveInstruction({ source: address(FIX.myUsdcAta), delegate: address(BOB), owner: createNoopSigner(address(ME)), amount })]);
    const big = await m.decode(ws("solana:signTransaction", tx(18446744073709551615n)), ctx);
    expect(big.title).toBe(`Allow ${BOB.slice(0, 4)}…${BOB.slice(-4)} to spend unlimited USDC`);
    expect(big.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "unlimited-approval" }));
    const small = await m.decode(ws("solana:signTransaction", tx(1_000_000n)), ctx);
    expect(small.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "unlimited-approval" }));
  });

  it("durable nonce → danger", async () => {
    const { m, ctx } = setup();
    const nonceAccount = address(BOB);
    const wire = build([getTransferSolInstruction({ source: createNoopSigner(address(ME)), destination: address(BOB), amount: 1n })], ME, (msg) =>
      setTransactionMessageLifetimeUsingDurableNonce({ nonce: FIX.blockhash as never, nonceAccountAddress: nonceAccount, nonceAuthorityAddress: address(ME) }, msg),
    );
    const d = await m.decode(ws("solana:signTransaction", wire), ctx);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "durable-nonce" }));
    expect(d.title).toMatch(/^Send 0\.000000001 SOL/);
    void getAdvanceNonceAccountInstruction;
  });

  it("unknown program → blind, listed by program id", async () => {
    const { m, ctx } = setup();
    const program = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    const ix: Instruction = { programAddress: address(program), accounts: [{ address: address(ME), role: 3 }], data: new Uint8Array([1, 2, 3]) };
    const d = await m.decode(ws("solana:signAndSendTransaction", build([ix])), ctx);
    expect(d.blind).toBe(true);
    expect(d.title).toBe("Approve an app transaction");
    expect(d.lines).toContainEqual({ label: "Program", value: program });
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "blind-signing" }));
  });

  it("v0 with an address lookup table", async () => {
    const alt = address("AddressLookupTab1e1111111111111111111111111");
    const target = address(BOB);
    const msg = compressTransactionMessageUsingAddressLookupTables(
      baseMessage([getTransferSolInstruction({ source: createNoopSigner(address(ME)), destination: target, amount: 2_000_000_000n })], ME),
      { [alt]: [target] },
    );
    const wire = b64encode(new Uint8Array(getTransactionEncoder().encode(compileTransaction(msg))));
    const altData = new Uint8Array(56 + 32);
    altData.set(getAddressEncoder().encode(target), 56);
    const { m, ctx } = setup(rpcBase({ [alt]: { lamports: 1, owner: "AddressLookupTab1e1111111111111111111111111", executable: false, data: [b64encode(altData), "base64"] } }));
    const d = await m.decode(ws("solana:signTransaction", wire), ctx);
    expect(d.title).toBe(`Send 2 SOL to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
  });

  it("refuses transactions this account doesn't sign, and other networks", async () => {
    const { m, ctx } = setup();
    const notMine = build([getTransferSolInstruction({ source: createNoopSigner(address(BOB)), destination: address(ME), amount: 1n })], BOB);
    await expect(m.decode(ws("solana:signTransaction", notMine), ctx)).rejects.toThrow(/doesn't need your signature/);
    await expect(m.decode(req("solana:signTransaction", { inputs: [{ account: ME, transaction: FIX.solTransfer, chain: "solana:mainnet" }] }), ctx)).rejects.toThrow(/different Solana network/);
    await expect(m.decode(req("solana:signTransaction", { inputs: [{ account: BOB, transaction: FIX.solTransfer }] }), ctx)).rejects.toBeInstanceOf(ClipError);
  });

  it("WalletConnect signAllTransactions describes each", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(req("solana_signAllTransactions", { transactions: [FIX.solTransfer, FIX.usdcTransfer] }, "https://app.example", "walletconnect"), ctx);
    expect(d.title).toBe("Approve 2 transactions");
    expect(d.lines.filter((l) => l.label.startsWith("Transaction")).length).toBe(2);
  });
});

describe("prepare / finalize", () => {
  const setup = (methods: Record<string, (p: unknown[]) => unknown> = {}) => {
    const mock = mockSolana({ ...rpcBase(), ...methods });
    return { m: createSolanaModule({ simulate: false }), ctx: ctxFor(makeAccount(ME), mock.fetch), calls: mock.calls };
  };
  const mySigIn = (wire: Uint8Array) => {
    const tx = getTransactionDecoder().decode(wire);
    return tx.signatures[address(ME)];
  };

  it("solana:signTransaction (Wallet Standard): ed25519 over the message bytes, signature placed in the wire", async () => {
    const { m, ctx } = setup();
    const request = ws("solana:signTransaction", FIX.solTransfer);
    const payloads = await m.prepare(request, ctx, "ap");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ scheme: "ed25519", accountId: "solana:0", approvalId: "ap" });
    expect(payloads[0]!.bytes).toEqual(getTransactionDecoder().decode(b64decode(FIX.solTransfer)).messageBytes);
    // Hardware wallets: the same message bytes, labelled as a transaction.
    expect(payloads[0]!.raw).toEqual({ format: "solana-tx", bytes: payloads[0]!.bytes });
    const out = (await m.finalize(request, payloads.map((p) => signer.sign(p)), ctx)) as { signedTransaction: string }[];
    const sig = mySigIn(b64decode(out[0]!.signedTransaction));
    expect(ed25519.verify(sig!, payloads[0]!.bytes, new Uint8Array(getAddressEncoder().encode(address(ME))))).toBe(true);
  });

  it("solana:signAndSendTransaction: sendTransaction with preflight, signature returned as base64 bytes", async () => {
    let sentWire = "";
    let sentCfg: Record<string, unknown> = {};
    const { m, ctx } = setup({
      sendTransaction: (p) => {
        sentWire = p[0] as string;
        sentCfg = p[1] as Record<string, unknown>;
        return getBase58Decoder().decode(hexBytes(FIX.solTransferSig));
      },
    });
    const request = ws("solana:signAndSendTransaction", FIX.solTransfer);
    const payloads = await m.prepare(request, ctx, "ap");
    const out = (await m.finalize(request, payloads.map((p) => signer.sign(p)), ctx)) as { signature: string }[];
    expect(sentCfg).toMatchObject({ encoding: "base64", skipPreflight: false });
    expect(mySigIn(b64decode(sentWire))).toEqual(hexBytes(FIX.solTransferSig));
    expect(b64decode(out[0]!.signature)).toEqual(hexBytes(FIX.solTransferSig));
  });

  it("WalletConnect solana_signTransaction / solana_signAndSendTransaction shapes", async () => {
    const { m, ctx } = setup({ sendTransaction: () => getBase58Decoder().decode(hexBytes(FIX.usdcTransferSig)) });
    const signReq = req("solana_signTransaction", { transaction: FIX.usdcTransfer }, "https://app.example", "walletconnect");
    const p1 = await m.prepare(signReq, ctx, "a");
    const r1 = (await m.finalize(signReq, p1.map((p) => signer.sign(p)), ctx)) as { signature: string; transaction: string };
    expect(new Uint8Array(getBase58Encoder().encode(r1.signature))).toEqual(hexBytes(FIX.usdcTransferSig));
    expect(mySigIn(b64decode(r1.transaction))).toEqual(hexBytes(FIX.usdcTransferSig));

    const sendReq = req("solana_signAndSendTransaction", { transaction: FIX.usdcTransfer, sendOptions: { maxRetries: 3 } }, "https://app.example", "walletconnect");
    const p2 = await m.prepare(sendReq, ctx, "a");
    expect(await m.finalize(sendReq, p2.map((p) => signer.sign(p)), ctx)).toEqual({ signature: getBase58Decoder().decode(hexBytes(FIX.usdcTransferSig)) });
  });

  it("a wrong signature is refused before anything is sent", async () => {
    const { m, ctx, calls } = setup({ sendTransaction: () => "x" });
    const request = ws("solana:signAndSendTransaction", FIX.solTransfer);
    const payloads = await m.prepare(request, ctx, "ap");
    const wrong = { scheme: "ed25519" as const, bytes: hexBytes(FIX.usdcTransferSig), publicKey: "" };
    await expect(m.finalize(request, [wrong], ctx)).rejects.toThrow(/didn't match/);
    expect(calls.some((c) => c.method === "sendTransaction")).toBe(false);
    void payloads;
  });

  it("send errors come back in plain words", async () => {
    const { m, ctx } = setup({
      sendTransaction: () => {
        throw { code: -32002, message: "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.", data: { err: "AccountNotFound", logs: [] } };
      },
    });
    const request = ws("solana:signAndSendTransaction", FIX.solTransfer);
    const payloads = await m.prepare(request, ctx, "ap");
    await expect(m.finalize(request, payloads.map((p) => signer.sign(p)), ctx)).rejects.toThrow("Your account has no SOL yet, so it can't pay the fee.");
  });

  it("signMessage: Wallet Standard (base64) and WalletConnect (base58)", async () => {
    const { m, ctx } = setup();
    const text = new TextEncoder().encode("Hello Solana");
    const wsReq = req("solana:signMessage", { inputs: [{ account: ME, message: b64encode(text) }] });
    const d = await m.decode(wsReq, ctx);
    expect(d.title).toBe("Sign a message for app.example");
    expect(d.lines).toEqual([{ label: "Message", value: "Hello Solana" }]);
    const p = await m.prepare(wsReq, ctx, "a");
    expect(await m.finalize(wsReq, p.map((x) => signer.sign(x)), ctx)).toEqual([{ signedMessage: b64encode(text), signature: b64encode(hexBytes(FIX.messageSig)) }]);

    const wcReq = req("solana_signMessage", { message: getBase58Decoder().decode(text), pubkey: ME }, "https://app.example", "walletconnect");
    const p2 = await m.prepare(wcReq, ctx, "a");
    expect(await m.finalize(wcReq, p2.map((x) => signer.sign(x)), ctx)).toEqual({ signature: getBase58Decoder().decode(hexBytes(FIX.messageSig)) });
  });

  it("signMessage refuses bytes that parse as a transaction (wire or bare message)", async () => {
    const { m, ctx } = setup();
    const wire = b64decode(FIX.solTransfer);
    const bareMessage = getTransactionDecoder().decode(wire).messageBytes;
    expect(looksLikeTransaction(wire)).toBe(true);
    expect(looksLikeTransaction(new Uint8Array(bareMessage))).toBe(true);
    expect(looksLikeTransaction(new TextEncoder().encode("Hello Solana"))).toBe(false);
    for (const bytes of [wire, new Uint8Array(bareMessage)]) {
      const r = req("solana:signMessage", { inputs: [{ account: ME, message: b64encode(bytes) }] });
      await expect(m.decode(r, ctx)).rejects.toThrow(/transaction in disguise/);
      await expect(m.prepare(r, ctx, "a")).rejects.toThrow(/transaction in disguise/);
    }
  });

  it("signIn (SIWS): shows domain and statement, warns on domain mismatch, signs the standard text", async () => {
    const { m, ctx } = setup();
    const good = req("solana:signIn", { inputs: [SIWS_INPUT] });
    const d = await m.decode(good, ctx);
    expect(d.title).toBe("Sign in to app.example");
    expect(d.lines).toContainEqual({ label: "Statement", value: "Sign in to App" });
    expect(d.warnings).toEqual([]);
    const [p] = await m.prepare(good, ctx, "a");
    const text = createSignInMessageText({ ...SIWS_INPUT, address: ME });
    expect(new TextDecoder().decode(p!.bytes)).toBe(text);
    const out = (await m.finalize(good, [signer.sign(p!)], ctx)) as { account: { address: string }; signature: string }[];
    expect(out[0]!.account.address).toBe(ME);
    expect(out[0]!.signature).toBe(b64encode(hexBytes(FIX.siwsSig)));

    const phish = req("solana:signIn", { inputs: [SIWS_INPUT] }, "https://app-example.evil");
    expect((await m.decode(phish, ctx)).warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "domain-mismatch" }));
  });
});

describe("balances, NFTs, transfers", () => {
  const NFT_MINT = "EziZPA6NcGAThFJTw4RDVsj4prXWuzpGAffQ68Lmj6Y1";
  const T22_MINT = "5F3RWKXDB1xCnMeaih6Mhrfb2D1wyXFB9K8dRqzCBtGp";
  const COLL = "4mgAzQbkuVoFoxQJGFG7FFee3nmTraBxNhpJrKcXxn4a";

  it("SOL, SPL + Token-2022 balances (metadata extension), NFTs via metadata PDA, compressed NFTs via DAS", async () => {
    const enc = getAddressEncoder();
    const { metadataPda } = await import("../src/index.js");
    const pda = await metadataPda(NFT_MINT);
    const mock = mockSolana(
      {
        getBalance: () => ({ context: { slot: 1 }, value: 1_250_000_000 }),
        getTokenAccountsByOwner: (p) => {
          const prog = (p[1] as { programId: string }).programId;
          const list =
            prog === TOKEN
              ? [
                  { pubkey: FIX.myUsdcAta, account: tokenAccount(USDC, ME, "10000000", 6) },
                  { pubkey: "HvFZDyg2Zi7kMBqouj8WHS9QAMtHPNnkkcBkXgZmikqt", account: tokenAccount(NFT_MINT, ME, "1", 0) },
                ]
              : [{ pubkey: "6WexR1jqy4fpyuAGaTBATHAEvsQkfejc3g9CqDMHTKA1", account: tokenAccount(T22_MINT, ME, "42000", 3, TOKEN22) }];
          return { context: { slot: 1 }, value: list };
        },
        getMultipleAccounts: (p) => ({
          context: { slot: 1 },
          value: (p[0] as string[]).map(
            (a) =>
              ({
                [USDC]: mintAccount(6, "1000000000000000"),
                [NFT_MINT]: mintAccount(0, "1"),
                [T22_MINT]: mintAccount(3, "1000000", TOKEN22, [{ extension: "tokenMetadata", state: { name: "Points", symbol: "PTS", uri: "" } }]),
                [pda]: { lamports: 1, owner: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s", executable: false, data: [metaplexData(new Uint8Array(enc.encode(address(NFT_MINT))), "Mad Lad #7", "MAD", "https://meta.example/7.json", new Uint8Array(enc.encode(address(COLL)))), "base64"] },
              })[a] ?? null,
          ),
        }),
      },
      [
        [/meta\.example\/7\.json$/, { name: "Mad Lad #7", image: "https://img.example/7.png", attributes: [{ trait_type: "Hat", value: "Crown" }] }],
        [/das\.example/, { jsonrpc: "2.0", id: "clip", result: { items: [{ id: "cNFT1", compression: { compressed: true }, content: { metadata: { name: "Tiny #1", symbol: "TNY" }, links: { image: "javascript:alert(1)" } }, grouping: [{ group_key: "collection", group_value: "TinyColl" }] }] } }],
      ],
    );
    const m = createSolanaModule({ dasUrl: "https://das.example/rpc" });
    const ctx = ctxFor(makeAccount(ME), mock.fetch);
    const balances = await m.getBalances(ctx);
    expect(balances.map((b) => [b.asset.key, b.asset.symbol, b.amount])).toEqual([
      ["sol", "SOL", "1250000000"],
      ["usdc", "USDC", "10000000"],
      [`spl:${T22_MINT}`, "PTS", "42000"],
    ]);
    const nfts = await m.getNfts(ctx);
    expect(nfts).toEqual([
      {
        networkId: SOLANA_DEVNET.id,
        standard: "metaplex",
        collection: { address: COLL, name: "MAD" },
        tokenId: NFT_MINT,
        name: "Mad Lad #7",
        mediaUrl: "https://img.example/7.png",
        attributes: [{ trait: "Hat", value: "Crown" }],
      },
      { networkId: SOLANA_DEVNET.id, standard: "metaplex", collection: { address: "TinyColl", name: "TNY" }, tokenId: "cNFT1", name: "Tiny #1" },
    ]);
  });

  it("buildTransfer: SOL and USDC (opens the recipient's account), through the normal approval path", async () => {
    const mock = mockSolana({
      ...rpcBase(),
      getLatestBlockhash: () => ({ context: { slot: 1 }, value: { blockhash: FIX.blockhash, lastValidBlockHeight: 100 } }),
      getTokenAccountsByOwner: () => ({ context: { slot: 1 }, value: [{ pubkey: FIX.myUsdcAta, account: tokenAccount(USDC, ME, "10000000", 6) }] }),
    });
    const m = createSolanaModule({ simulate: false });
    const ctx = ctxFor(makeAccount(ME), mock.fetch);
    const solReq = await m.buildTransfer({ asset: solAsset(SOLANA_DEVNET.id), to: BOB, amount: "250000000" }, ctx);
    expect(solReq).toMatchObject({ family: "solana", method: "solana:signAndSendTransaction" });
    expect((await m.decode(solReq, ctx)).title).toBe(`Send 0.25 SOL to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);

    const usdc = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: SOLANA_DEVNET.id, address: USDC };
    const usdcReq = await m.buildTransfer({ asset: usdc, to: BOB, amount: "2500000" }, ctx);
    const d = await m.decode(usdcReq, ctx);
    expect(d.title).toBe(`Send 2.5 USDC to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(d.lines).toContainEqual({ label: "Also", value: "Also opens a USDC account for the recipient (≈0.002 SOL)" });
    // Same bytes as the fixture built offline: the builder is deterministic for a given blockhash.
    expect((usdcReq.params as { inputs: { transaction: string }[] }).inputs[0]!.transaction).toBe(FIX.usdcTransfer);

    await expect(m.buildTransfer({ asset: usdc, to: FIX.myUsdcAta, amount: "1" }, ctx)).rejects.toThrow(/token account, not a wallet/);
    await expect(m.buildTransfer({ asset: usdc, to: BOB, amount: "99000000" }, ctx)).rejects.toThrow(/enough USDC/);
  });
});

describe.runIf(process.env.LIVE === "1")("live devnet (read-only)", () => {
  it("reads balances of the devnet USDC mint authority", async () => {
    const m = createSolanaModule();
    const ctx = { network: SOLANA_DEVNET, account: makeAccount("GrNg1XM2ctzeE2mXxXCfhcTUbejM8Z4z4wNVTy2FjMEz"), fetch };
    const balances = await m.getBalances(ctx);
    expect(balances[0]!.asset.key).toBe("sol");
  }, 30_000);

  it("simulates against devnet: an unfunded fee payer fails in plain words", async () => {
    const m = createSolanaModule();
    const ctx = { network: SOLANA_DEVNET, account: makeAccount(ME), fetch };
    const d = await m.decode(ws("solana:signAndSendTransaction", FIX.solTransfer), ctx);
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "simulation-failed" }));
  }, 30_000);
});

function hexBytes(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
}
