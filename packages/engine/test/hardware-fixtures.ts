/**
 * Hardware test doubles for the engine (and the mobile screen tests). Public data only: the account is the
 * public EVM address of the BIP-39 "abandon … about" test account at m/44'/60'/0'/0/1, and "signatures" are
 * constant placeholders. The real keyring's signature check is covered in packages/hardware with recorded
 * device answers; here a fake keyring stands in so the engine's routing can be tested without any signing.
 */
import type { DappRequest, DecodedRequest, Signature, SignablePayload } from "@clip-wallet/core";
import { KeystoneBridge, urFromJson, type HardwareAccount, type HardwareFamily, type HardwareKeyring } from "@clip-wallet/hardware/core";
import type { EngineHardwareDeps } from "../src/hardware.js";
import type { KV } from "../src/kv.js";

export const HW_ADDRESS = "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0";

export function hwAccount(kind: "ledger" | "keystone", index = 1, family: HardwareFamily = "evm"): HardwareAccount {
  const fingerprint = kind === "ledger" ? "0a1b2c3d" : "f23f9fd2";
  return {
    id: `hw:${kind}:${fingerprint}:${family}:${index}`,
    family,
    index,
    curve: "secp256k1",
    derivationPath: `m/44'/60'/0'/0/${index}`,
    publicKey: "03",
    address: HW_ADDRESS,
    hardware: { kind, fingerprint, path: `m/44'/60'/0'/0/${index}`, pathStyle: "standard", ...(kind === "ledger" ? { deviceName: "Nano X" } : {}) },
  };
}

/** A keyring that stores accounts in memory and signs through the given hook (no verification). */
export class FakeKeyring {
  stored: HardwareAccount[] = [];
  registered = new Map<string, SignablePayload[]>();
  locked = 0;
  constructor(private readonly onSign: (p: SignablePayload, a: HardwareAccount) => Promise<Signature>) {}
  owns(id: string) {
    return id.startsWith("hw:");
  }
  async accounts() {
    return this.stored;
  }
  async account(id: string) {
    return this.stored.find((a) => a.id === id);
  }
  async addAccounts(list: HardwareAccount[]) {
    for (const a of list) if (!this.stored.some((x) => x.id === a.id)) this.stored.push(a);
  }
  async updateAccount(id: string, patch: { label?: string }) {
    const a = this.stored.find((x) => x.id === id);
    if (a) a.label = patch.label;
  }
  async removeDevice(kind: string, fingerprint: string) {
    this.stored = this.stored.filter((a) => !(a.hardware.kind === kind && a.hardware.fingerprint === fingerprint));
  }
  registerApproval(id: string, payloads: SignablePayload[]) {
    this.registered.set(id, payloads);
  }
  revokeApproval(id: string) {
    this.registered.delete(id);
  }
  lock() {
    this.locked++;
    this.registered.clear();
  }
  async sign(payload: SignablePayload, _ctx: { request: DappRequest; decoded: DecodedRequest }): Promise<Signature> {
    if (!this.registered.has(payload.approvalId)) throw new Error("not approved");
    const a = await this.account(payload.accountId);
    if (!a) throw new Error("unknown account");
    return this.onSign(payload, a);
  }
}

const SIG = (p: SignablePayload): Signature => ({ scheme: p.scheme, bytes: new Uint8Array(64).fill(9), recovery: 0, publicKey: "03" });

/**
 * Ledger signs after `ledgerGate` resolves (so a test can look at the approval mid-sign); Keystone goes
 * through the real KeystoneBridge (request QR → scanned answer).
 */
export function fakeHardwareDeps(kv: KV, onChange: () => void = () => undefined) {
  const bridge = new KeystoneBridge(onChange);
  let release: (() => void) | null = null;
  const ledgerWaiting = () => new Promise<void>((r) => (release = r));
  const keyring = new FakeKeyring(async (p, a) => {
    if (a.hardware.kind === "ledger") {
      await ledgerWaiting();
      return SIG(p);
    }
    await bridge.exchange({ approvalId: p.approvalId, request: { ur: urFromJson({ type: "eth-sign-request", cborHex: "a1016161" }) }, expect: ["eth-signature"], title: "Sign" } as never);
    return SIG(p);
  });
  const ledgerAccounts = [hwAccount("ledger", 0), hwAccount("ledger", 1)];
  const deps: EngineHardwareDeps = {
    keyring: keyring as unknown as HardwareKeyring,
    ledger: {
      kind: "ledger",
      listAccounts: async (_f, start, count) => ledgerAccounts.slice(start, start + count),
      sign: async () => {
        throw new Error("signs through the keyring");
      },
      close: async () => undefined,
    },
    keystone: {
      signer: {
        kind: "keystone",
        listAccounts: async (_f, start, count) => [hwAccount("keystone", 0), hwAccount("keystone", 1)].slice(start, start + count),
        sign: async () => {
          throw new Error("signs through the keyring");
        },
        importSync: async () => ({ fingerprint: "f23f9fd2", keys: [{ path: "m/44'/60'/0'" }, { path: "m/84'/1'/0'" }] }) as never,
        forget: async () => undefined,
      },
      bridge,
    },
    kv,
  };
  return { deps, keyring, bridge, releaseLedger: () => release?.() };
}
