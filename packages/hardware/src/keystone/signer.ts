/**
 * KeystoneSigner: air-gapped signing over animated QR codes (BC-UR), via @keystonehq/keystone-sdk.
 *  - Accounts come from the device's export QR: crypto-multi-accounts, crypto-hdkey or crypto-account.
 *    We keep only public keys (+ chain codes for non-hardened derivation) and the master fingerprint.
 *  - sign() shows eth-sign-request / sol-sign-request / crypto-psbt as an animated QR and waits for the
 *    eth-signature / sol-signature / signed crypto-psbt the device shows back.
 * The QR display and camera are UI; the background gives this signer a KeystoneQrChannel that asks
 * the approval window to do the showing and scanning.
 */
import type * as KeystoneModule from "@keystonehq/keystone-sdk";
import type { DappRequest, DecodedRequest, Signature, SignablePayload } from "@clip-wallet/core";
import { base58 } from "@scure/base";
import { derivePublic, encodeXpub, publicNode, XPUB_VERSIONS, type PublicNode } from "../bip32pub.js";
import { partialSigFrom, psbtKey, psbtPayloads, segwitAddress, withDerivations } from "../bitcoin.js";
import { equal, fromHex, toHex } from "../bytes.js";
import { evmAddress } from "../evm.js";
import { HardwareErrors } from "../errors.js";
import type { HardwareStorage } from "../keyring.js";
import { HARDWARE_CURVE, bitcoinAccountPath, hardwarePath, parsePath, type PathOptions } from "../paths.js";
import type { HardwareAccount, HardwareFamily, HardwareSignContext, HardwareSigner, PathStyle } from "../types.js";
import { hardwareAccountId } from "../types.js";
import { ecdsaSignature, ed25519Signature } from "../verify.js";
import { personalDigest } from "../ledger/eth.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { hashTypedData, type TypedDataDefinition } from "viem";
import { AnimatedUr, UR } from "./ur.js";

/** UR types this package reads. */
export const KEYSTONE_ACCOUNT_TYPES = ["crypto-multi-accounts", "crypto-hdkey", "crypto-account"] as const;

export interface KeystoneExchange {
  /** The approval this signature belongs to (one exchange per approval at a time). */
  approvalId: string;
  /** Animated QR to show the device. */
  request: AnimatedUr;
  /** UR types to accept back. */
  expect: string[];
  /** Plain words for the sheet: "Scan with your Keystone, then scan the signature it shows". */
  title: string;
  requestContext: { request: DappRequest; decoded: DecodedRequest };
}

/** UI side of signing: show `request` in a loop, scan the answer, resolve with it (or reject with HardwareErrors.cancelled()). */
export interface KeystoneQrChannel {
  exchange(x: KeystoneExchange): Promise<UR>;
}

export interface KeystoneKey {
  /** m/... */
  path: string;
  /** hex: 33-byte secp256k1 or 32-byte ed25519 */
  publicKey: string;
  /** hex, present when non-hardened children can be derived from this key */
  chainCode?: string;
  /** Keystone's "account.standard" / "account.ledger_live" / "account.ledger_legacy" */
  note?: string;
  chain?: string;
}

export interface KeystoneSync {
  fingerprint: string;
  device?: string;
  keys: KeystoneKey[];
  syncedAt: number;
}

export interface KeystoneSignerOptions extends PathOptions {
  channel: KeystoneQrChannel;
  storage: HardwareStorage;
  storageKey?: string;
  newId?: () => string;
  now?: () => number;
  origin?: string;
}

const norm = (p: string): string => `m/${p.replace(/^[mM]\/?/, "").replace(/h/g, "'")}`;

export class KeystoneSigner implements HardwareSigner {
  readonly kind = "keystone" as const;
  /** The Keystone SDK is large and registers every chain's UR types on import, so load it on first use. */
  private ksP: Promise<{ mod: typeof KeystoneModule; sdk: KeystoneModule.KeystoneSDK }> | undefined;
  private ks() {
    return (this.ksP ??= import("@keystonehq/keystone-sdk").then((mod) => ({ mod, sdk: new mod.KeystoneSDK({ origin: this.origin }) })));
  }
  private readonly channel: KeystoneQrChannel;
  private readonly storage: HardwareStorage;
  private readonly storageKey: string;
  private readonly network: "mainnet" | "testnet";
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly origin: string;
  private readonly psbtCache = new Map<string, Promise<Uint8Array>>();

  constructor(opts: KeystoneSignerOptions) {
    this.channel = opts.channel;
    this.storage = opts.storage;
    this.storageKey = opts.storageKey ?? "clip-wallet/hardware/keystone/v1";
    this.network = opts.bitcoinNetwork ?? "testnet";
    this.newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
    this.now = opts.now ?? Date.now;
    this.origin = opts.origin ?? "Clip Wallet";
  }

  /* ------------------------------------------------------------------ sync */

  /** Parse a scanned account-export UR and remember its public keys. Returns the merged sync. */
  async importSync(ur: UR): Promise<KeystoneSync> {
    const { sdk } = await this.ks();
    let fingerprint: string;
    let device: string | undefined;
    let keys: KeystoneKey[];
    try {
      switch (ur.type) {
        case "crypto-multi-accounts": {
          const m = sdk.parseMultiAccounts(ur);
          fingerprint = m.masterFingerprint;
          device = m.device;
          keys = m.keys.map((k) => ({ path: norm(k.path), publicKey: k.publicKey, ...(k.chainCode ? { chainCode: k.chainCode } : {}), ...(k.note ? { note: k.note } : {}), chain: k.chain }));
          break;
        }
        case "crypto-hdkey": {
          const k = sdk.parseHDKey(ur);
          if (!k.xfp) throw new Error("hdkey without source fingerprint");
          fingerprint = k.xfp;
          keys = [{ path: norm(k.path), publicKey: k.publicKey, ...(k.chainCode ? { chainCode: k.chainCode } : {}), ...(k.note ? { note: k.note } : {}), chain: k.chain }];
          break;
        }
        case "crypto-account": {
          const a = sdk.parseAccount(ur);
          fingerprint = a.masterFingerprint;
          keys = a.keys.map((k) => ({ path: norm(k.path), publicKey: k.publicKey, ...(k.chainCode ? { chainCode: k.chainCode } : {}), chain: k.chain }));
          break;
        }
        default:
          throw HardwareErrors.wrongQr("your Keystone's account code");
      }
    } catch (e) {
      if (e instanceof Error && "userMessage" in e) throw e;
      throw HardwareErrors.wrongQr("your Keystone's account code", e);
    }
    fingerprint = fingerprint.toLowerCase().padStart(8, "0");
    const all = await this.syncs();
    const prev = all.find((s) => s.fingerprint === fingerprint);
    const merged: KeystoneSync = {
      fingerprint,
      ...(device ?? prev?.device ? { device: device ?? prev?.device } : {}),
      keys: [...(prev?.keys ?? []).filter((k) => !keys.some((n) => n.path === k.path)), ...keys],
      syncedAt: this.now(),
    };
    await this.storage.set(this.storageKey, JSON.stringify([...all.filter((s) => s.fingerprint !== fingerprint), merged]));
    return merged;
  }

  async syncs(): Promise<KeystoneSync[]> {
    const raw = await this.storage.get(this.storageKey);
    return raw ? (JSON.parse(raw) as KeystoneSync[]) : [];
  }

  async forget(fingerprint: string): Promise<void> {
    const all = await this.syncs();
    await this.storage.set(this.storageKey, JSON.stringify(all.filter((s) => s.fingerprint !== fingerprint.toLowerCase())));
  }

  /* ------------------------------------------------------------------ accounts */

  async listAccounts(family: HardwareFamily, start: number, count: number, opts: { pathStyle?: PathStyle; fingerprint?: string } = {}): Promise<HardwareAccount[]> {
    if (family === "hedera") throw HardwareErrors.unsupported("Hedera accounts on a Keystone");
    const all = await this.syncs();
    const sync = opts.fingerprint ? all.find((s) => s.fingerprint === opts.fingerprint!.toLowerCase()) : [...all].sort((a, b) => b.syncedAt - a.syncedAt)[0];
    if (!sync) throw HardwareErrors.notSynced();
    const style = opts.pathStyle ?? "standard";
    const out: HardwareAccount[] = [];
    for (let i = start; i < start + count; i++) {
      const path = hardwarePath(family, i, style, { bitcoinNetwork: this.network });
      const found = this.keyFor(sync, path);
      if (!found) {
        if (out.length) break; // the device exported fewer accounts than asked for
        throw HardwareErrors.notSynced();
      }
      const pub = found.publicKey;
      const base: HardwareAccount = {
        id: hardwareAccountId("keystone", sync.fingerprint, family, i, style),
        family,
        index: i,
        curve: HARDWARE_CURVE[family],
        derivationPath: path,
        publicKey: toHex(pub),
        address: "",
        hardware: { kind: "keystone", fingerprint: sync.fingerprint, path, pathStyle: style, ...(sync.device ? { deviceName: sync.device } : {}) },
      };
      if (family === "evm") base.address = evmAddress(pub);
      if (family === "solana") base.address = base58.encode(pub);
      if (family === "bitcoin") {
        const { accountPath, change, addressIndex } = bitcoinAccountPath(path);
        base.address = segwitAddress(pub, this.network);
        Object.assign(base.hardware, { accountPath, change, addressIndex, ...(found.accountXpub ? { accountXpub: found.accountXpub } : {}) });
      }
      out.push(base);
    }
    return out;
  }

  /** The public key at `path`: exported directly, or derived from an exported parent with a chain code. */
  private keyFor(sync: KeystoneSync, path: string): { publicKey: Uint8Array; accountXpub?: string } | undefined {
    const direct = sync.keys.find((k) => k.path === path);
    if (direct) return { publicKey: fromHex(direct.publicKey) };
    const segs = path.split("/");
    for (let cut = segs.length - 1; cut >= 2; cut--) {
      const parentPath = segs.slice(0, cut).join("/");
      const rest = segs.slice(cut);
      if (rest.some((s) => s.endsWith("'"))) break; // can't derive hardened children from public data
      const parent = sync.keys.find((k) => k.path === parentPath && k.chainCode && k.publicKey.length === 66);
      if (!parent) continue;
      const node: PublicNode = publicNode(fromHex(parent.publicKey), fromHex(parent.chainCode!), {
        version: this.network === "mainnet" ? XPUB_VERSIONS.xpub : XPUB_VERSIONS.tpub,
        depth: cut - 1,
        childNumber: parsePath(parentPath).at(-1) ?? 0,
      });
      const child = derivePublic(node, rest.map(Number));
      return { publicKey: child.publicKey, accountXpub: encodeXpub(node) };
    }
    return undefined;
  }

  /* ------------------------------------------------------------------ signing */

  async sign(payload: SignablePayload, ctx: HardwareSignContext): Promise<Signature> {
    const a = ctx.account;
    switch (a.family as HardwareFamily) {
      case "evm":
        return this.signEvm(payload, ctx);
      case "solana":
        return this.signSolana(payload, ctx);
      case "bitcoin":
        return this.signBitcoin(payload, ctx);
      default:
        throw HardwareErrors.unsupported(`${a.family} accounts on a Keystone`);
    }
  }

  private async ask(ur: UR, expect: string[], ctx: HardwareSignContext, approvalId: string): Promise<UR> {
    const back = await this.channel.exchange({
      approvalId,
      request: new AnimatedUr(ur),
      expect,
      title: "Scan this with your Keystone, then scan the signature it shows you.",
      requestContext: { request: ctx.request, decoded: ctx.decoded },
    });
    if (!expect.includes(back.type)) throw HardwareErrors.wrongQr("the signature");
    return back;
  }

  private async signEvm(payload: SignablePayload, ctx: HardwareSignContext): Promise<Signature> {
    const raw = payload.raw;
    if (!raw) throw HardwareErrors.needsDeviceView("this Ethereum request");
    const { mod, sdk } = await this.ks();
    const DT = mod.KeystoneEthereumSDK.DataType;
    let dataType: number;
    switch (raw.format) {
      case "evm-tx":
        if (!equal(keccak_256(raw.bytes), payload.bytes)) throw HardwareErrors.badSignature("raw tx does not hash to the approved digest");
        dataType = raw.bytes[0]! <= 0x7f ? DT.typedTransaction : DT.transaction;
        break;
      case "evm-personal":
        if (!equal(personalDigest(raw.bytes), payload.bytes)) throw HardwareErrors.badSignature("message does not hash to the approved digest");
        dataType = DT.personalMessage;
        break;
      case "eip712": {
        const td = JSON.parse(new TextDecoder().decode(raw.bytes)) as TypedDataDefinition;
        if (!equal(fromHex(hashTypedData(td)), payload.bytes)) throw HardwareErrors.badSignature("typed data does not hash to the approved digest");
        dataType = DT.typedData;
        break;
      }
      default:
        throw HardwareErrors.unsupported("this kind of Ethereum request");
    }
    const chainId = raw.chainId ?? chainIdOf(ctx.decoded.networkId ?? ctx.request.networkId);
    const requestId = this.newId();
    const ur = sdk.eth.generateSignRequest({
      requestId,
      signData: toHex(raw.bytes),
      dataType,
      path: ctx.account.hardware.path,
      xfp: ctx.account.hardware.fingerprint,
      ...(chainId !== undefined ? { chainId } : {}),
      address: ctx.account.address,
      origin: this.origin,
    });
    const back = await this.ask(ur, ["eth-signature"], ctx, payload.approvalId);
    const sig = sdk.eth.parseSignature(back);
    if (sig.requestId !== undefined && sig.requestId !== requestId) throw HardwareErrors.wrongRequest();
    const bytes = fromHex(sig.signature);
    if (bytes.length < 64) throw HardwareErrors.badSignature("eth signature length");
    return ecdsaSignature(bytes.subarray(0, 64), payload.bytes, ctx.account.publicKey);
  }

  private async signSolana(payload: SignablePayload, ctx: HardwareSignContext): Promise<Signature> {
    const raw = payload.raw;
    if (raw && !equal(raw.bytes, payload.bytes)) throw HardwareErrors.badSignature("raw differs from the approved message");
    const isTx = raw ? raw.format === "solana-tx" : /transaction/i.test(ctx.request.method);
    const { mod, sdk } = await this.ks();
    const DT = mod.KeystoneSolanaSDK.DataType;
    const requestId = this.newId();
    const ur = sdk.sol.generateSignRequest({
      requestId,
      signData: toHex(payload.bytes),
      dataType: isTx ? DT.Transaction : DT.Message,
      path: ctx.account.hardware.path,
      xfp: ctx.account.hardware.fingerprint,
      origin: this.origin,
    });
    const back = await this.ask(ur, ["sol-signature"], ctx, payload.approvalId);
    const sig = sdk.sol.parseSignature(back);
    if (sig.requestId !== undefined && sig.requestId !== requestId) throw HardwareErrors.wrongRequest();
    return ed25519Signature(fromHex(sig.signature), payload.bytes, ctx.account.publicKey);
  }

  private async signBitcoin(payload: SignablePayload, ctx: HardwareSignContext): Promise<Signature> {
    if (payload.raw?.format === "bitcoin-message") throw HardwareErrors.unsupported("Bitcoin messages on a Keystone");
    const { psbt, inputIndex } = psbtPayloads(payload);
    const key = psbtKey(payload.approvalId, psbt);
    let pending = this.psbtCache.get(key);
    if (!pending) {
      pending = (async () => {
        const { sdk } = await this.ks();
        const { bytes } = withDerivations(psbt, ctx.account);
        const back = await this.ask(sdk.btc.generatePSBT(Buffer.from(bytes)), ["crypto-psbt"], ctx, payload.approvalId);
        return fromHex(sdk.btc.parsePSBT(back));
      })();
      this.psbtCache.set(key, pending);
      pending.catch(() => this.psbtCache.delete(key));
    }
    const signed = await pending;
    const rs = partialSigFrom(signed, inputIndex, ctx.account.publicKey);
    return ecdsaSignature(rs, payload.bytes, ctx.account.publicKey);
  }
}

function chainIdOf(networkId: string | undefined): number | undefined {
  const m = /^eip155:(\d+)$/.exec(networkId ?? "");
  return m ? Number(m[1]) : undefined;
}
