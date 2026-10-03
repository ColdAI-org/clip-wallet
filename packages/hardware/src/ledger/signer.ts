/**
 * LedgerSigner: HardwareSigner over WebHID for the Ethereum, Solana, Bitcoin (Test) and Hedera apps.
 * Before signing it re-reads the account's public key from the device (silently), so a different
 * Ledger, or the same Ledger with another passphrase, fails with "wrong device" instead of a bad signature.
 */
import type { Signature, SignablePayload } from "@clip-wallet/core";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58 } from "@scure/base";
import { decodeXpub, derivePublic, fingerprintOf } from "../bip32pub.js";
import { psbtKey, psbtPayloads, segwitAddress } from "../bitcoin.js";
import { fromHex, toHex } from "../bytes.js";
import { evmAddress } from "../evm.js";
import { HardwareErrors, type LedgerAppName } from "../errors.js";
import { HARDWARE_CURVE, bitcoinAccountPath, hardwarePath, type PathOptions } from "../paths.js";
import type { HardwareAccount, HardwareFamily, HardwareSignContext, HardwareSigner, PathStyle } from "../types.js";
import { hardwareAccountId } from "../types.js";
import { ecdsaSignature } from "../verify.js";
import { btcAccountXpub, btcMasterFingerprint, btcSignMessage, btcSignPsbt } from "./bitcoin.js";
import { defaultEthResolver, ethPublicKey, ethSign, type EthLoadConfig, type EthResolver } from "./eth.js";
import { hederaPublicKey, hederaSign } from "./hedera.js";
import { solanaPublicKey, solanaSign } from "./solana.js";
import { LedgerConnection, webHidTransport, type TransportFactory } from "./transport.js";

export interface LedgerSignerOptions extends PathOptions {
  transport?: TransportFactory;
  /** EVM clear-signing metadata lookup. Default: Ledger's CAL service; tests pass a stub. */
  ethResolver?: EthResolver;
  /** Ledger metadata service config for the Ethereum app (EIP-712 filters). Default: Ledger's. */
  ethLoadConfig?: EthLoadConfig;
  deviceName?: string;
}

const compress = (pubHex: string): string => toHex(secp256k1.Point.fromBytes(fromHex(pubHex)).toBytes(true));

/** A stable id for "this seed" on apps that can't report a master fingerprint: hash160 of account 0's key. */
const seedId = (pubHex: string): string => fingerprintOf(fromHex(pubHex)).hex;

export class LedgerSigner implements HardwareSigner {
  readonly kind = "ledger" as const;
  private readonly conn: LedgerConnection;
  private readonly ethResolver: EthResolver;
  private readonly ethLoadConfig: EthLoadConfig | undefined;
  private readonly network: "mainnet" | "testnet";
  private readonly deviceName: string | undefined;
  /** Bitcoin: signatures of one PSBT signing, answered per input. Cleared when used up. */
  private readonly psbtCache = new Map<string, Promise<Map<number, Uint8Array>>>();

  constructor(opts: LedgerSignerOptions = {}) {
    this.conn = new LedgerConnection(opts.transport ?? webHidTransport);
    this.ethResolver = opts.ethResolver ?? defaultEthResolver;
    this.ethLoadConfig = opts.ethLoadConfig;
    this.network = opts.bitcoinNetwork ?? "testnet";
    this.deviceName = opts.deviceName;
  }

  private get btcApp(): LedgerAppName {
    return this.network === "mainnet" ? "Bitcoin" : "Bitcoin Test";
  }

  close(): Promise<void> {
    return this.conn.close();
  }

  async listAccounts(family: HardwareFamily, start: number, count: number, opts: { pathStyle?: PathStyle } = {}): Promise<HardwareAccount[]> {
    const style = opts.pathStyle ?? "standard";
    const indexes = Array.from({ length: count }, (_, i) => start + i);
    const base = (index: number, publicKey: string, address: string, path: string, fingerprint: string, extra: Partial<HardwareAccount["hardware"]> = {}): HardwareAccount => ({
      id: hardwareAccountId("ledger", fingerprint, family, index, style),
      family,
      index,
      curve: HARDWARE_CURVE[family],
      derivationPath: path,
      publicKey,
      address,
      hardware: { kind: "ledger", fingerprint, path, pathStyle: style, ...(this.deviceName ? { deviceName: this.deviceName } : {}), ...extra },
    });

    switch (family) {
      case "evm":
        return this.conn.run("Ethereum", async (t) => {
          const id = seedId(compress((await ethPublicKey(t, hardwarePath("evm", 0))).publicKey));
          const out: HardwareAccount[] = [];
          for (const i of indexes) {
            const path = hardwarePath("evm", i, style);
            const { publicKey } = await ethPublicKey(t, path);
            const pub = compress(publicKey);
            out.push(base(i, pub, evmAddress(fromHex(pub)), path, id));
          }
          return out;
        });
      case "solana":
        return this.conn.run("Solana", async (t) => {
          const id = seedId(`02${await solanaPublicKey(t, hardwarePath("solana", 0))}`);
          const out: HardwareAccount[] = [];
          for (const i of indexes) {
            const path = hardwarePath("solana", i, style);
            const pub = await solanaPublicKey(t, path);
            out.push(base(i, pub, base58.encode(fromHex(pub)), path, id));
          }
          return out;
        });
      case "hedera":
        return this.conn.run("Hedera", async (t) => {
          const id = seedId(`02${await hederaPublicKey(t, 0)}`);
          const out: HardwareAccount[] = [];
          for (const i of indexes) {
            const pub = await hederaPublicKey(t, i);
            // No address until the account id (0.0.x) is known: see README "Hedera on a Ledger".
            out.push(base(i, pub, "", hardwarePath("hedera", i), id, { keyIndex: i }));
          }
          return out;
        });
      case "bitcoin":
        return this.conn.run(this.btcApp, async (t) => {
          const fpr = await btcMasterFingerprint(t);
          const out: HardwareAccount[] = [];
          const xpubs = new Map<string, string>();
          for (const i of indexes) {
            const path = hardwarePath("bitcoin", i, style, { bitcoinNetwork: this.network });
            const { accountPath, change, addressIndex } = bitcoinAccountPath(path);
            let xpub = xpubs.get(accountPath);
            if (!xpub) {
              xpub = await btcAccountXpub(t, accountPath);
              xpubs.set(accountPath, xpub);
            }
            const pub = derivePublic(decodeXpub(xpub), [change, addressIndex]).publicKey;
            out.push(base(i, toHex(pub), segwitAddress(pub, this.network), path, fpr, { accountXpub: xpub, accountPath, change, addressIndex }));
          }
          return out;
        });
    }
  }

  async sign(payload: SignablePayload, ctx: HardwareSignContext): Promise<Signature> {
    const a = ctx.account;
    const hw = a.hardware;
    switch (a.family as HardwareFamily) {
      case "evm":
        return this.conn.run("Ethereum", async (t) => {
          const { publicKey } = await ethPublicKey(t, hw.path);
          if (compress(publicKey) !== a.publicKey.toLowerCase()) throw HardwareErrors.wrongDevice();
          return ethSign(t, hw.path, payload, a.publicKey, this.ethResolver, this.ethLoadConfig);
        });
      case "solana":
        return this.conn.run("Solana", async (t) => {
          if ((await solanaPublicKey(t, hw.path)) !== a.publicKey.toLowerCase()) throw HardwareErrors.wrongDevice();
          return solanaSign(t, hw.path, payload, ctx.request, a.publicKey);
        });
      case "hedera":
        return this.conn.run("Hedera", async (t) => {
          const index = hw.keyIndex ?? a.index;
          if ((await hederaPublicKey(t, index)) !== a.publicKey.toLowerCase()) throw HardwareErrors.wrongDevice();
          return hederaSign(t, index, payload, a.publicKey);
        });
      case "bitcoin": {
        if (payload.raw?.format === "bitcoin-message") {
          return this.conn.run(this.btcApp, async (t) => {
            if ((await btcMasterFingerprint(t)) !== hw.fingerprint) throw HardwareErrors.wrongDevice();
            return btcSignMessage(t, hw.path, payload, a.publicKey);
          });
        }
        const { psbt, inputIndex } = psbtPayloads(payload);
        const key = psbtKey(payload.approvalId, psbt);
        let pending = this.psbtCache.get(key);
        if (!pending) {
          pending = this.conn.run(this.btcApp, async (t) => {
            if ((await btcMasterFingerprint(t)) !== hw.fingerprint) throw HardwareErrors.wrongDevice();
            return btcSignPsbt(t, psbt, a);
          });
          this.psbtCache.set(key, pending);
          pending.catch(() => this.psbtCache.delete(key));
        }
        const sigs = await pending;
        const rs = sigs.get(inputIndex);
        if (!rs) throw HardwareErrors.badSignature(`device did not sign input ${inputIndex}`);
        sigs.delete(inputIndex);
        if (sigs.size === 0) this.psbtCache.delete(key);
        return ecdsaSignature(rs, payload.bytes, a.publicKey);
      }
      default:
        throw HardwareErrors.unsupported(`${a.family} accounts`);
    }
  }
}
