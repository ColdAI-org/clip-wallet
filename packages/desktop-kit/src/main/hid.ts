/**
 * Ledger over WebHID for the main-process engine.
 *
 * WebHID exists only in a renderer, and the device picker (navigator.hid.requestDevice) needs a click there. The
 * engine (and @clip-wallet/hardware's LedgerSigner, with its APDU encoders and the checks on what comes back) runs
 * here, in the main process. So the transport is split, like the phone's Bluetooth transport is injected
 * (apps/mobile/src/background/ledger-ble.ts):
 *
 *   LedgerSigner (main) ─ RelayTransport.exchange(apdu) ─► IPC CH.hidJob ─► wallet/approval renderer
 *                                                              └─ @ledgerhq/hw-transport-webhid exchange
 *
 * The renderer only moves raw APDU bytes; status words are interpreted here by Transport.send(), and every
 * signature is verified by the engine's hardware keyring against the account's public key before use.
 *
 * Device choice is explicit: the default session's `select-hid-device` handler lists only Ledger devices (USB vendor
 * 0x2c97) in a native dialog and the user picks one, or cancels. Nothing is auto-selected.
 */
import Transport from "@ledgerhq/hw-transport";
import { ClipError } from "@clip-wallet/core";
import type { TransportFactory } from "@clip-wallet/hardware";
import type { DistributiveOmit, HidJob, HidReply } from "../shared/ipc";

export const LEDGER_VENDOR_ID = 0x2c97;

export interface HidTarget {
  send(job: HidJob): void;
}

type Pending = { resolve: (r: HidReply) => void; timer: ReturnType<typeof setTimeout> };

export class HidRelay {
  private seq = 0;
  private pending = new Map<string, Pending>();

  constructor(
    private readonly o: {
      /** The app window doing device I/O right now (approval window while signing, else the wallet window). */
      target(): HidTarget | null;
      /** A user confirming on the device can take a while. */
      timeoutMs?: number;
    },
  ) {}

  request(job: DistributiveOmit<HidJob, "id">): Promise<HidReply> {
    const target = this.o.target();
    if (!target) return Promise.reject(new ClipError("Open the wallet window to use your Ledger.", "hw/no-window"));
    const id = `hid-${++this.seq}`;
    return new Promise<HidReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error("Ledger disconnected (timeout)"), { name: "DisconnectedDeviceDuringOperation" }));
      }, this.o.timeoutMs ?? 120_000);
      this.pending.set(id, { resolve, timer });
      try {
        target.send({ ...job, id } as HidJob);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  /** A renderer answered (schema-checked by the caller). Unknown ids are ignored. */
  onReply(r: HidReply): void {
    const p = this.pending.get(r.id);
    if (!p) return;
    this.pending.delete(r.id);
    clearTimeout(p.timer);
    p.resolve(r);
  }

  /** For LedgerSigner({ transport }): opens (and on first use, picks) the device in the renderer. */
  readonly transport: TransportFactory = async () => {
    unwrap(await this.request({ op: "open" }));
    return new RelayTransport(this) as never;
  };
}

function unwrap(r: HidReply): string {
  if (r.ok) return r.data ?? "";
  // Shape @clip-wallet/hardware's ledgerError() understands (name / message / statusCode).
  throw Object.assign(new Error(r.message), { name: r.name, ...(r.statusCode !== undefined ? { statusCode: r.statusCode } : {}) });
}

class RelayTransport extends Transport {
  constructor(private readonly relay: HidRelay) {
    super();
  }

  override async exchange(apdu: Buffer): Promise<Buffer> {
    const data = unwrap(await this.relay.request({ op: "exchange", apdu: apdu.toString("hex") }));
    return Buffer.from(data, "hex");
  }

  override setScrambleKey(): void {
    /* WebHID needs none */
  }

  override async close(): Promise<void> {
    await this.relay.request({ op: "close" }).catch(() => undefined);
  }
}

/** Devices the HID chooser offers: Ledger only, by USB vendor id. */
export function ledgerDevices<T extends { vendorId: number }>(list: readonly T[] | undefined): T[] {
  return (list ?? []).filter((d) => d.vendorId === LEDGER_VENDOR_ID);
}
