/**
 * Hardware accounts (Ledger, Keystone) for any engine host. The same behaviour as the extension's background
 * (apps/extension/src/background/service.ts, docs/phase2/integration/hardware.md §4), moved out of the
 * orchestration class so WalletEngine only needs a few hooks:
 *
 *   walletAccount(family)  a hardware account picked for a family replaces the phrase account
 *   owns(accountId)        approve() routes signing to the device instead of the vault
 *   sign(...)              shows the device step on the approval (Ledger "confirm", Keystone QR exchange)
 *   withState(view)        getApproval() returns the Keystone exchange while sign() waits for it
 *   lock()                 forgets approvals and cancels open exchanges
 *
 * The host builds the signers (WebHID or Bluetooth for Ledger; the camera for Keystone) and hands them in.
 * Only public data is stored or returned: addresses, public keys, paths, device fingerprints.
 */
import { z } from "zod";
import { ClipError, type Account, type DappRequest, type DecodedRequest, type Family, type Signature, type SignablePayload } from "@clip-wallet/core";
import {
  HardwareErrors,
  urFromJson,
  type HardwareAccount,
  type HardwareFamily,
  type HardwareKeyring,
  type HardwareSigner,
  type KeystoneBridge,
  type KeystoneSigner,
  type PathStyle,
} from "@clip-wallet/hardware/core";
import type { ApprovalView, HardwareAccountView, HardwareApprovalClient, HardwareClient, HardwareFamilyView } from "@clip-wallet/ui";
import type { KV } from "./kv.js";

export const HARDWARE_KEYS = { active: "clip/hardware/active" } as const;

const LEDGER_APP: Record<string, string> = { evm: "Ethereum", solana: "Solana", bitcoin: "Bitcoin", hedera: "Hedera" };

/* ------------------------------------------------------------------ requests (same schema as the extension's bus) */

const hwFamily = z.enum(["evm", "solana", "bitcoin", "hedera"]);
const pathStyle = z.enum(["standard", "ledger-live", "ledger-legacy"]);
const urJson = z.object({ type: z.string().regex(/^[a-z0-9-]{1,40}$/), cborHex: z.string().regex(/^[0-9a-f]*$/).max(200_000) }).strict();
const hwId = z.string().regex(/^hw:(ledger|keystone):[0-9a-f]{8}:[a-z]+:\d{1,10}(:ledger-live|:ledger-legacy)?$/);
const id = z.string().min(1).max(200);
const page = { family: hwFamily, start: z.number().int().min(0).max(1000), count: z.number().int().min(1).max(20), pathStyle: pathStyle.optional() };

export const HardwareRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hwLedgerAccounts"), ...page }),
  z.object({ type: z.literal("hwKeystoneImport"), ur: urJson }),
  z.object({ type: z.literal("hwKeystoneAccounts"), ...page }),
  z.object({ type: z.literal("hwAddAccounts"), ids: z.array(hwId).min(1).max(50) }),
  z.object({ type: z.literal("hwListAccounts") }),
  z.object({ type: z.literal("hwRenameAccount"), id: hwId, label: z.string().max(60) }),
  z.object({ type: z.literal("hwForgetDevice"), kind: z.enum(["ledger", "keystone"]), fingerprint: z.string().regex(/^[0-9a-f]{8}$/) }),
  z.object({ type: z.literal("hwSetActive"), family: hwFamily, accountId: hwId.nullable() }),
  z.object({ type: z.literal("hwKeystoneAnswer"), id, ur: urJson }),
  z.object({ type: z.literal("hwCancel"), id }),
]);
export type HardwareRequest = z.infer<typeof HardwareRequest>;

/* ------------------------------------------------------------------ deps */

/** A Ledger signer that may load its device code on first use (see the extension's lazyHardware). */
export type EngineLedger = HardwareSigner & { close(): Promise<void> };
export type EngineKeystone = HardwareSigner & Pick<KeystoneSigner, "importSync" | "forget">;

export interface EngineHardwareDeps {
  keyring: HardwareKeyring;
  ledger: EngineLedger;
  keystone: { signer: EngineKeystone; bridge: KeystoneBridge };
  kv: KV;
}

/** What the engine gives the hardware module (WalletEngine.attachHardware). */
export interface HardwareHost {
  /** Re-derive the account set (afterUnlock) after the active hardware account changed. */
  refreshAccounts(): Promise<void>;
  broadcast(): void;
  isUnlocked(): Promise<boolean>;
  /** Re-arms auto-lock: hardware screens count as activity. */
  touch(): Promise<void>;
}

export class EngineHardware {
  /** Accounts the user was just shown on "Connect a hardware wallet"; hwAddAccounts adds from here. */
  private seen = new Map<string, HardwareAccount>();
  private host: HardwareHost | null = null;

  constructor(private readonly d: EngineHardwareDeps) {}

  bind(host: HardwareHost) {
    this.host = host;
  }

  private get h(): HardwareHost {
    if (!this.host) throw new ClipError("Hardware wallets aren't ready yet. Try again in a moment.", "hw/not-attached");
    return this.host;
  }

  /* ------------------------------------------------------------------ engine hooks */

  owns(accountId: string): boolean {
    return this.d.keyring.owns(accountId);
  }

  private async activeMap(): Promise<Partial<Record<Family, string>>> {
    return (await this.d.kv.get<Partial<Record<Family, string>>>(HARDWARE_KEYS.active)) ?? {};
  }

  /** The hardware account picked for this family, if any (it replaces the phrase account). */
  async walletAccount(family: Family): Promise<Account | undefined> {
    const hwId = (await this.activeMap())[family];
    return hwId ? await this.d.keyring.account(hwId) : undefined;
  }

  registerApproval(approvalId: string, payloads: SignablePayload[], ttlMs: number) {
    this.d.keyring.registerApproval(approvalId, payloads, ttlMs);
  }

  revokeApproval(approvalId: string) {
    this.d.keyring.revokeApproval(approvalId);
  }

  /** Hardware sign: tell the approval which device step to show, then wait for the device. */
  async sign(view: ApprovalView, payload: SignablePayload, ctx: { request: DappRequest; decoded: DecodedRequest }): Promise<Signature> {
    const acct = await this.d.keyring.account(payload.accountId);
    if (!acct) throw HardwareErrors.unknownAccount();
    if (acct.hardware.kind === "ledger") view.hardware = { kind: "ledger", stage: "confirm", app: LEDGER_APP[acct.family] ?? "right" };
    this.h.broadcast();
    try {
      return await this.d.keyring.sign(payload, ctx);
    } finally {
      view.hardware = undefined;
      this.h.broadcast();
    }
  }

  /** A Keystone exchange in progress for this approval is shown as its QR step. */
  withState(v: ApprovalView): ApprovalView {
    const x = this.d.keystone.bridge.current(v.id);
    return x ? { ...v, hardware: { kind: "keystone", stage: "exchange", request: { type: x.type, cborHex: x.cborHex, expect: x.expect } } } : v;
  }

  lock() {
    this.d.keyring.lock();
    this.d.keystone.bridge.cancelAll();
    this.seen.clear();
  }

  /* ------------------------------------------------------------------ requests */

  /** Validates an untrusted message (zod) and runs it. Throws ClipError with a plain userMessage. */
  async handleUntrusted(msg: unknown): Promise<unknown> {
    const parsed = HardwareRequest.safeParse(msg);
    if (!parsed.success) throw new ClipError("Something went wrong. Please try again.", "bus/invalid");
    return this.handle(parsed.data);
  }

  async handle(m: HardwareRequest): Promise<unknown> {
    if (!(await this.h.isUnlocked())) throw new ClipError("Your wallet is locked. Unlock it to continue.", "vault/locked");
    await this.h.touch();
    switch (m.type) {
      case "hwLedgerAccounts":
      case "hwKeystoneAccounts": {
        const signer = m.type === "hwLedgerAccounts" ? this.d.ledger : this.d.keystone.signer;
        const list = await signer.listAccounts(m.family, m.start, m.count, { pathStyle: m.pathStyle as PathStyle | undefined });
        for (const a of list) this.seen.set(a.id, a);
        return list.map((a) => hwView(a));
      }
      case "hwKeystoneImport": {
        const sync = await this.d.keystone.signer.importSync(urFromJson(m.ur));
        const prefix = { evm: "m/44'/60'", solana: "m/44'/501'", bitcoin: "m/84'" } as const;
        const families = (["evm", "solana", "bitcoin"] as const).filter((f) => sync.keys.some((k) => k.path.startsWith(prefix[f])));
        return { fingerprint: sync.fingerprint, families };
      }
      case "hwAddAccounts": {
        const picked = m.ids.map((x) => this.seen.get(x)).filter((a): a is HardwareAccount => !!a);
        if (picked.length !== m.ids.length) throw HardwareErrors.unknownAccount();
        await this.d.keyring.addAccounts(picked);
        // The first account added for a family becomes the one the wallet uses for it.
        const active = await this.activeMap();
        for (const a of picked) if (!active[a.family]) active[a.family] = a.id;
        await this.d.kv.set(HARDWARE_KEYS.active, active);
        await this.h.refreshAccounts();
        return;
      }
      case "hwListAccounts": {
        const active = await this.activeMap();
        return (await this.d.keyring.accounts()).map((a) => ({ ...hwView(a), active: active[a.family] === a.id }));
      }
      case "hwRenameAccount":
        await this.d.keyring.updateAccount(m.id, { label: m.label || undefined });
        this.h.broadcast();
        return;
      case "hwForgetDevice": {
        await this.d.keyring.removeDevice(m.kind, m.fingerprint);
        if (m.kind === "keystone") await this.d.keystone.signer.forget(m.fingerprint);
        const active = await this.activeMap();
        for (const [f, hid] of Object.entries(active)) if (hid && !(await this.d.keyring.account(hid))) delete active[f as Family];
        await this.d.kv.set(HARDWARE_KEYS.active, active);
        await this.h.refreshAccounts();
        return;
      }
      case "hwSetActive": {
        const active = await this.activeMap();
        if (m.accountId) {
          const a = await this.d.keyring.account(m.accountId);
          if (!a || a.family !== m.family) throw HardwareErrors.unknownAccount();
          active[m.family as HardwareFamily] = m.accountId;
        } else delete active[m.family as HardwareFamily];
        await this.d.kv.set(HARDWARE_KEYS.active, active);
        await this.h.refreshAccounts();
        return;
      }
      case "hwKeystoneAnswer":
        this.d.keystone.bridge.answer(m.id, m.ur);
        return;
      case "hwCancel":
        this.d.keystone.bridge.cancel(m.id);
        await this.d.ledger.close(); // aborts a pending Ledger exchange: sign() rejects, approve() throws
        return;
    }
  }
}

function hwView(a: HardwareAccount): HardwareAccountView {
  return {
    id: a.id,
    family: a.family as HardwareFamilyView,
    index: a.index,
    address: a.hederaAccountId ?? a.address,
    derivationPath: a.derivationPath,
    label: a.label,
    hardware: { kind: a.hardware.kind, fingerprint: a.hardware.fingerprint, pathStyle: a.hardware.pathStyle, deviceName: a.hardware.deviceName },
  };
}

/** In-process HardwareClient (+ the approval window's two calls) over the engine's hardware module. */
export function createEngineHardwareClient(hw: EngineHardware): HardwareClient & HardwareApprovalClient {
  const call = <T>(msg: unknown) => hw.handleUntrusted(msg) as Promise<T>;
  return {
    ledgerAccounts: (family, start, count, pathStyle) => call({ type: "hwLedgerAccounts", family, start, count, ...(pathStyle ? { pathStyle } : {}) }),
    keystoneImport: (ur) => call({ type: "hwKeystoneImport", ur }),
    keystoneAccounts: (family, start, count, pathStyle) => call({ type: "hwKeystoneAccounts", family, start, count, ...(pathStyle ? { pathStyle } : {}) }),
    addAccounts: (ids) => call({ type: "hwAddAccounts", ids }),
    listAccounts: () => call({ type: "hwListAccounts" }),
    renameAccount: (accountId, label) => call({ type: "hwRenameAccount", id: accountId, label }),
    forgetDevice: (kind, fingerprint) => call({ type: "hwForgetDevice", kind, fingerprint }),
    setActive: (family, accountId) => call({ type: "hwSetActive", family, accountId }),
    keystoneAnswer: (approvalId, ur) => call({ type: "hwKeystoneAnswer", id: approvalId, ur }),
    hardwareCancel: (approvalId) => call({ type: "hwCancel", id: approvalId }),
  };
}
