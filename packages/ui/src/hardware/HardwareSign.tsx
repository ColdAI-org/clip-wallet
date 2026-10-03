/**
 * Shown in the approval window after the user pressed Approve on a hardware account's request.
 * Ledger: "check and confirm on your Ledger". Keystone: show the request QR, then scan the answer.
 */
import { useCallback, useState } from "react";
import { Button, ErrorNote, Screen, Spinner } from "../components";
import { useUiT } from "../i18n";
import { AnimatedQr, UrScanner, type ScannerStart } from "./qr";
import type { KeystoneRequestView } from "./types";

export function LedgerConfirm(props: { title: string; app: string; error?: string | null; onRetry?: () => void; onCancel: () => void }) {
  const t = useUiT();
  return (
    <Screen title={t("hardware.ledgerSign.title")}>
      <p className="clip-lede">{props.title}</p>
      {props.error ? (
        <>
          <ErrorNote message={props.error} />
          {props.onRetry && (
            <Button block onClick={props.onRetry}>
              {t("common.retry")}
            </Button>
          )}
        </>
      ) : (
        <>
          <ol className="clip-steps">
            <li className="clip-step">{t("hardware.ledgerSign.step1", { app: props.app })}</li>
            <li className="clip-step">{t("hardware.ledgerSign.step2")}</li>
            <li className="clip-step">{t("hardware.ledgerSign.step3")}</li>
          </ol>
          <Spinner label={t("hardware.ledgerSign.waiting")} />
        </>
      )}
      <Button variant="ghost" block onClick={props.onCancel}>
        {t("common.cancel")}
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
  const t = useUiT();
  const [phase, setPhase] = useState<"show" | "scan">("show");
  const { onSignature } = props;
  const done = useCallback((ur: { type: string; cborHex: string }) => onSignature(ur), [onSignature]);
  return (
    <Screen title={phase === "show" ? t("hardware.keystoneSign.showTitle") : t("hardware.keystoneSign.scanTitle")}>
      <p className="clip-lede">{props.title}</p>
      {phase === "show" ? (
        <>
          <AnimatedQr ur={props.request} label={t("hardware.keystoneSign.request")} />
          <p className="clip-hint">{t("hardware.keystoneSign.hint")}</p>
          <Button block onClick={() => setPhase("scan")}>
            {t("hardware.keystoneSign.next")}
          </Button>
        </>
      ) : (
        <>
          <UrScanner expect={props.request.expect} onComplete={done} start={props.scanner} label={t("hardware.keystoneSign.camera")} />
          <Button variant="ghost" onClick={() => setPhase("show")}>
            {t("hardware.keystoneSign.showAgain")}
          </Button>
        </>
      )}
      <ErrorNote message={props.error} />
      <Button variant="ghost" block onClick={props.onCancel}>
        {t("common.cancel")}
      </Button>
    </Screen>
  );
}
