/**
 * Shown in the approval window after the user pressed Approve on a hardware account's request.
 * Ledger: "check and confirm on your Ledger". Keystone: show the request QR, then scan the answer.
 */
import { useCallback, useState } from "react";
import { Button, ErrorNote, Screen, Spinner } from "../components";
import { AnimatedQr, UrScanner, type ScannerStart } from "./qr";
import type { KeystoneRequestView } from "./types";

export function LedgerConfirm(props: { title: string; app: string; error?: string | null; onRetry?: () => void; onCancel: () => void }) {
  return (
    <Screen title="Confirm on your Ledger">
      <p className="clip-lede">{props.title}</p>
      {props.error ? (
        <>
          <ErrorNote message={props.error} />
          {props.onRetry && (
            <Button block onClick={props.onRetry}>
              Try again
            </Button>
          )}
        </>
      ) : (
        <>
          <ol className="clip-steps">
            <li className="clip-step">Make sure the {props.app} app is open on your Ledger.</li>
            <li className="clip-step">Check that what your Ledger shows matches this request.</li>
            <li className="clip-step">Approve it on the Ledger.</li>
          </ol>
          <Spinner label="Waiting for your Ledger" />
        </>
      )}
      <Button variant="ghost" block onClick={props.onCancel}>
        Cancel
      </Button>
    </Screen>
  );
}

export function KeystoneExchangeScreen(props: {
  title: string;
  request: KeystoneRequestView;
  onSignature: (ur: { type: string; cborHex: string }) => void;
  onCancel: () => void;
  scanner?: ScannerStart;
  error?: string | null;
}) {
  const [phase, setPhase] = useState<"show" | "scan">("show");
  const { onSignature } = props;
  const done = useCallback((ur: { type: string; cborHex: string }) => onSignature(ur), [onSignature]);
  return (
    <Screen title={phase === "show" ? "Scan with your Keystone" : "Scan the signature"}>
      <p className="clip-lede">{props.title}</p>
      {phase === "show" ? (
        <>
          <AnimatedQr ur={props.request} label="Request for your Keystone" />
          <p className="clip-hint">Scan this with your Keystone, check the details on its screen and approve. Then come back here.</p>
          <Button block onClick={() => setPhase("scan")}>
            Next: scan the signature
          </Button>
        </>
      ) : (
        <>
          <UrScanner expect={props.request.expect} onComplete={done} start={props.scanner} label="Camera preview for your Keystone's signature" />
          <Button variant="ghost" onClick={() => setPhase("show")}>
            Show the request again
          </Button>
        </>
      )}
      <ErrorNote message={props.error} />
      <Button variant="ghost" block onClick={props.onCancel}>
        Cancel
      </Button>
    </Screen>
  );
}
