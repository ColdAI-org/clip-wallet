/**
 * Shapes shared by the background and the pages for hardware accounts. Device I/O runs in the pages
 * (WebHID and the camera need one); the background keeps approvals and verifies every signature.
 */
import type { HardwareAccount, HardwareKind } from "@clip-wallet/hardware/core";
import type { HardwareAccountView } from "@clip-wallet/ui";

/**
 * One payload the background wants a device to sign, as the approval window reads it (`hwSignJobs`).
 * `payload`, `account`, `request` and `decoded` are in the wire form of @clip-wallet/hardware (toWire).
 * The window answers with `hwSignResult` (a signature the background verifies against its own copy of
 * the payload) or `hwSignFailed`.
 */
export interface HardwareSignJob {
  approvalId: string;
  jobId: string;
  kind: HardwareKind;
  payload: unknown;
  account: unknown;
  request: unknown;
  decoded: unknown;
}

export function hardwareAccountView(a: HardwareAccount): HardwareAccountView {
  return {
    id: a.id,
    family: a.family as HardwareAccountView["family"],
    index: a.index,
    address: a.hederaAccountId ?? a.address,
    derivationPath: a.derivationPath,
    label: a.label,
    hardware: { kind: a.hardware.kind, fingerprint: a.hardware.fingerprint, pathStyle: a.hardware.pathStyle, deviceName: a.hardware.deviceName },
  };
}
