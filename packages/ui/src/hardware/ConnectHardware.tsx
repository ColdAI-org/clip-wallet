/**
 * "Connect a hardware wallet": onboarding (after the password step) and Settings → Hardware wallets → Add.
 * Ledger over USB (WebHID), Keystone by scanning its account QR code. Picks accounts; keys stay on the device.
 */
import { useCallback, useState } from "react";
import { requestLedgerAccess } from "@clip-wallet/hardware/qr";
import { userMessageOf } from "../client";
import { Button, ErrorNote, Screen, Spinner, Toggle } from "../components";
import { useUi } from "../context";
import { useUiT } from "../i18n";
import { UrScanner, type ScannerStart } from "./qr";
import { DEVICE_FAMILIES, FAMILY_WORDS, shortAddress, type HardwareAccountView, type HardwareClient, type HardwareFamilyView, type HardwareKindView, type PathStyleView } from "./types";

const PAGE = 5;
const KEYSTONE_EXPORT_TYPES = ["crypto-multi-accounts", "crypto-hdkey", "crypto-account"];

type Step =
  | { s: "pick-device" }
  | { s: "pick-family"; kind: HardwareKindView }
  | { s: "keystone-scan"; family: HardwareFamilyView }
  | { s: "accounts"; kind: HardwareKindView; family: HardwareFamilyView };

export function ConnectHardware(props: {
  hardware: HardwareClient;
  onDone: (added: string[]) => void;
  onBack?: () => void;
  scanner?: ScannerStart;
  advanced?: boolean;
  /** USB permission prompt for the Ledger, run in this page on the Connect click. */
  requestLedger?: () => Promise<void>;
}) {
  const t = useUiT();
  const [step, setStep] = useState<Step>({ s: "pick-device" });
  const back = step.s === "pick-device" ? props.onBack : () => setStep({ s: "pick-device" });

  return (
    <Screen back={back ?? false} title={t("hardware.connect.title")}>
      {step.s === "pick-device" && <PickDevice onPick={(kind) => setStep({ s: "pick-family", kind })} />}
      {step.s === "pick-family" && (
        <PickFamily
          kind={step.kind}
          onPick={(family) => setStep(step.kind === "keystone" ? { s: "keystone-scan", family } : { s: "accounts", kind: "ledger", family })}
        />
      )}
      {step.s === "keystone-scan" && (
        <KeystoneSync hardware={props.hardware} scanner={props.scanner} onSynced={() => setStep({ s: "accounts", kind: "keystone", family: step.family })} />
      )}
      {step.s === "accounts" && (
        <PickAccounts hardware={props.hardware} kind={step.kind} family={step.family} advanced={!!props.advanced} onDone={props.onDone} requestLedger={props.requestLedger ?? (() => requestLedgerAccess())} />
      )}
    </Screen>
  );
}

function PickDevice(props: { onPick: (k: HardwareKindView) => void }) {
  const t = useUiT();
  const { config } = useUi();
  return (
    <>
      <p className="clip-lede">{t("hardware.connect.lede", { name: config.name })}</p>
      <div className="clip-options">
        <button type="button" className="clip-option" onClick={() => props.onPick("ledger")}>
          <span className="clip-option__title">Ledger</span>
          <span className="clip-option__hint">{t("hardware.connect.ledgerHint")}</span>
        </button>
        <button type="button" className="clip-option" onClick={() => props.onPick("keystone")}>
          <span className="clip-option__title">Keystone</span>
          <span className="clip-option__hint">{t("hardware.connect.keystoneHint")}</span>
        </button>
      </div>
    </>
  );
}

function PickFamily(props: { kind: HardwareKindView; onPick: (f: HardwareFamilyView) => void }) {
  const t = useUiT();
  return (
    <>
      <p className="clip-lede">{t("hardware.connect.whatOnIt")}</p>
      <div className="clip-options">
        {DEVICE_FAMILIES[props.kind].map((f) => (
          <button key={f} type="button" className="clip-option" onClick={() => props.onPick(f)}>
            <span className="clip-option__title">{t(FAMILY_WORDS[f].title)}</span>
            <span className="clip-option__hint">{t(FAMILY_WORDS[f].assets)}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function KeystoneSync(props: { hardware: HardwareClient; scanner?: ScannerStart; onSynced: () => void }) {
  const t = useUiT();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { hardware, onSynced } = props;
  const onComplete = useCallback(
    (ur: { type: string; cborHex: string }) => {
      setBusy(true);
      hardware
        .keystoneImport(ur)
        .then(() => onSynced())
        .catch((e: unknown) => {
          setErr(userMessageOf(e));
          setBusy(false);
        });
    },
    [hardware, onSynced],
  );
  return (
    <>
      <ol className="clip-steps">
        <li className="clip-step">{t("hardware.keystone.step1")}</li>
        <li className="clip-step">{t("hardware.keystone.step2")}</li>
        <li className="clip-step">{t("hardware.keystone.step3")}</li>
      </ol>
      {busy ? <Spinner label={t("hardware.keystone.reading")} /> : <UrScanner expect={KEYSTONE_EXPORT_TYPES} onComplete={onComplete} start={props.scanner} label={t("hardware.keystone.camera")} />}
      <ErrorNote message={err} />
    </>
  );
}

function PickAccounts(props: { hardware: HardwareClient; kind: HardwareKindView; family: HardwareFamilyView; advanced: boolean; onDone: (ids: string[]) => void; requestLedger: () => Promise<void> }) {
  const [style, setStyle] = useState<PathStyleView>("standard");
  const [accounts, setAccounts] = useState<HardwareAccountView[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useUiT();
  const { config } = useUi();
  const words = FAMILY_WORDS[props.family];

  const load = async (start: number) => {
    setBusy(true);
    setErr(null);
    try {
      if (props.kind === "ledger" && start === 0) await props.requestLedger();
      const more = props.kind === "ledger" ? await props.hardware.ledgerAccounts(props.family, start, PAGE, style) : await props.hardware.keystoneAccounts(props.family, start, PAGE, style);
      setAccounts((prev) => [...(start === 0 ? [] : prev ?? []), ...more]);
      if (start === 0 && more[0]) setPicked(new Set([more[0].id]));
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (!accounts) {
    return (
      <>
        {props.kind === "ledger" ? (
          <ol className="clip-steps">
            <li className="clip-step">{t("hardware.ledger.step1")}</li>
            <li className="clip-step">{t("hardware.ledger.step2", { app: words.app })}</li>
            <li className="clip-step">{t("hardware.ledger.step3")}</li>
          </ol>
        ) : (
          <p className="clip-lede">{t("hardware.accounts.gotIt")}</p>
        )}
        {props.advanced && props.family !== "hedera" && (
          <Toggle
            label={t("hardware.accounts.ledgerLive")}
            description={t("hardware.accounts.ledgerLiveHint", { name: config.name })}
            checked={style === "ledger-live"}
            onChange={(v) => setStyle(v ? "ledger-live" : "standard")}
          />
        )}
        <ErrorNote message={err} />
        <Button block disabled={busy} onClick={() => void load(0)}>
          {busy ? t("hardware.accounts.connecting") : props.kind === "ledger" ? t("hardware.accounts.connect") : t("hardware.accounts.show")}
        </Button>
      </>
    );
  }

  return (
    <>
      <p className="clip-lede">{t("hardware.accounts.pick")}</p>
      <ul className="clip-list" aria-label={t("hardware.accounts.onDevice")}>
        {accounts.map((a) => (
          <li key={a.id}>
            <label className="clip-select-row">
              <input
                type="checkbox"
                className="clip-check"
                checked={picked.has(a.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(a.id);
                  else next.delete(a.id);
                  setPicked(next);
                }}
              />
              <span>{t("hardware.accounts.account", { n: a.index + 1 })}</span>
              <code className="clip-mono">{a.address ? shortAddress(a.address) : t("hardware.accounts.newHedera")}</code>
            </label>
          </li>
        ))}
      </ul>
      <ErrorNote message={err} />
      <Button variant="ghost" disabled={busy} onClick={() => void load(accounts.length)}>
        {t("hardware.accounts.showMore")}
      </Button>
      <Button
        block
        disabled={busy || picked.size === 0}
        onClick={async () => {
          setBusy(true);
          try {
            const ids = [...picked];
            await props.hardware.addAccounts(ids);
            props.onDone(ids);
          } catch (e) {
            setErr(userMessageOf(e));
            setBusy(false);
          }
        }}
      >
        {t("hardware.accounts.add", { n: picked.size })}
      </Button>
    </>
  );
}
