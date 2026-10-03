/**
 * Wraps the approval screen: while the background waits for a hardware wallet, show the device step
 * instead. Integration: ApprovalWindowApp renders <HardwareApprovalGate state={view.hardware} …> around
 * TransactionApproval (docs/phase2/integration/hardware.md).
 */
import type { ReactNode } from "react";
import { userMessageOf } from "../client";
import type { ScannerStart } from "./qr";
import { KeystoneExchangeScreen, LedgerConfirm } from "./HardwareSign";
import type { HardwareApprovalClient, HardwareApprovalState } from "./types";

export function HardwareApprovalGate(props: {
  approvalId: string;
  title: string;
  state: HardwareApprovalState | undefined;
  client: HardwareApprovalClient;
  onError?: (message: string) => void;
  /** Ledger "Try again": re-sends approve for the same request. */
  onRetry?: () => void;
  scanner?: ScannerStart;
  children: ReactNode;
}) {
  const s = props.state;
  const cancel = () => void props.client.hardwareCancel(props.approvalId).catch((e: unknown) => props.onError?.(userMessageOf(e)));
  if (!s) return <>{props.children}</>;
  if (s.kind === "ledger") return <LedgerConfirm title={props.title} app={s.app} error={s.error} onRetry={props.onRetry} onCancel={cancel} />;
  return (
    <KeystoneExchangeScreen
      title={props.title}
      request={s.request}
      error={s.error}
      scanner={props.scanner}
      onCancel={cancel}
      onSignature={(ur) => void props.client.keystoneAnswer(props.approvalId, ur).catch((e: unknown) => props.onError?.(userMessageOf(e)))}
    />
  );
}
