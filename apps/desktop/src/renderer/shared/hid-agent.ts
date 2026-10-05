/**
 * The WebHID half of Ledger support (main/hid.ts has the other half). Runs in the wallet and approval windows,
 * where navigator.hid exists and the user's click allows the device picker. It only moves raw APDU bytes; the main
 * process builds the commands, reads the status words and verifies every signature.
 */
import type Transport from "@ledgerhq/hw-transport";
import type { HidJob, HidReply } from "../../shared/ipc";
import { desktop } from "./bridge";

let transport: Transport | null = null;

async function open(): Promise<void> {
  if (transport) return;
  const { default: TransportWebHID } = await import("@ledgerhq/hw-transport-webhid");
  // A Ledger already picked in this run reopens without asking; otherwise the native chooser (main/index.ts).
  transport = (await TransportWebHID.openConnected().catch(() => null)) ?? (await TransportWebHID.create());
  transport.on("disconnect", () => (transport = null));
}

function failure(id: string, e: unknown): HidReply {
  const x = e as { name?: string; message?: string; statusCode?: number };
  return { id, ok: false, name: String(x?.name ?? "Error").slice(0, 100), message: String(x?.message ?? e).slice(0, 500), ...(typeof x?.statusCode === "number" ? { statusCode: x.statusCode } : {}) };
}

async function run(job: HidJob): Promise<HidReply> {
  try {
    switch (job.op) {
      case "open":
        await open();
        return { id: job.id, ok: true };
      case "exchange": {
        if (!transport) await open();
        const out = await transport!.exchange(Buffer.from(job.apdu, "hex"));
        return { id: job.id, ok: true, data: Buffer.from(out).toString("hex") };
      }
      case "close": {
        const t = transport;
        transport = null;
        await t?.close().catch(() => undefined);
        return { id: job.id, ok: true };
      }
    }
  } catch (e) {
    if (job.op !== "close") {
      const t = transport;
      transport = null;
      await t?.close().catch(() => undefined);
    }
    return failure(job.id, e);
  }
}

export function startHidAgent() {
  if (!("hid" in navigator)) return;
  desktop().onHidJob(run);
}
