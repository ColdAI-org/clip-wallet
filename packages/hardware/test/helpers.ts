import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RecordStore, openTransportReplayer } from "@ledgerhq/hw-transport-mocker";
import type { SignablePayload } from "@clip-wallet/core";
import { HardwareKeyring, LedgerSigner, type HardwareAccount, type HardwareSigner } from "../src/index.js";

export const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

/** A LedgerSigner whose device is the recorded APDU session `name` (test/fixtures/ledger-<name>.apdus). */
export function replay(nameOrApdus: string, opts: { raw?: boolean } = {}): { signer: LedgerSigner; store: RecordStore } {
  const store = RecordStore.fromString(opts.raw ? nameOrApdus : fixture(`ledger-${nameOrApdus}.apdus`));
  const signer = new LedgerSigner({ transport: () => openTransportReplayer(store), ethResolver: async () => null, ethLoadConfig: { calServiceURL: null } });
  return { signer, store };
}

export function memoryStorage(): { get(k: string): Promise<string | undefined>; set(k: string, v: string): Promise<void>; data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k), set: async (k, v) => void data.set(k, v) };
}

export async function keyringWith(signer: HardwareSigner, accounts: HardwareAccount[]): Promise<HardwareKeyring> {
  const k = new HardwareKeyring({ signers: { [signer.kind]: signer }, storage: memoryStorage() });
  await k.addAccounts(accounts);
  return k;
}

export function approve(k: HardwareKeyring, ...payloads: SignablePayload[]): void {
  k.registerApproval(payloads[0]!.approvalId, payloads, 60_000);
}
