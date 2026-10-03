/**
 * "Connect a hardware wallet": onboarding (after the password step) and Settings → Hardware wallets → Add.
 * Ledger over USB (WebHID), Keystone by scanning its account QR code. Picks accounts; keys stay on the device.
 */
import { useCallback, useState } from "react";
import { requestLedgerAccess } from "@clip-wallet/hardware/qr";
import { userMessageOf } from "../client";
import { Button, ErrorNote, Screen, Spinner, Toggle } from "../components";
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
  const [step, setStep] = useState<Step>({ s: "pick-device" });
  const back = step.s === "pick-device" ? props.onBack : () => setStep({ s: "pick-device" });

  return (
    <Screen back={back ?? false} title="Connect a hardware wallet">
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
  return (
    <>
      <p className="clip-lede">Your keys stay on the device. Clip Wallet only sees your addresses, and every payment needs your OK on the device.</p>
      <div className="clip-options">
        <button type="button" className="clip-option" onClick={() => props.onPick("ledger")}>
          <span className="clip-option__title">Ledger</span>
          <span className="clip-option__hint">Connect with a USB cable.</span>
        </button>
        <button type="button" className="clip-option" onClick={() => props.onPick("keystone")}>
          <span className="clip-option__title">Keystone</span>
          <span className="clip-option__hint">No cable: you scan QR codes with the camera.</span>
        </button>
      </div>
    </>
  );
}

function PickFamily(props: { kind: HardwareKindView; onPick: (f: HardwareFamilyView) => void }) {
  return (
    <>
      <p className="clip-lede">What do you keep on it?</p>
      <div className="clip-options">
        {DEVICE_FAMILIES[props.kind].map((f) => (
          <button key={f} type="button" className="clip-option" onClick={() => props.onPick(f)}>
            <span className="clip-option__title">{FAMILY_WORDS[f].title}</span>
            <span className="clip-option__hint">{FAMILY_WORDS[f].assets}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function KeystoneSync(props: { hardware: HardwareClient; scanner?: ScannerStart; onSynced: () => void }) {
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
        <li className="clip-step">On your Keystone, open the menu and choose “Connect Software Wallet”.</li>
        <li className="clip-step">Pick a wallet that supports the networks you want (any “Keystone” or “MetaMask” option works for Ethereum).</li>
        <li className="clip-step">Hold the QR code it shows in front of this camera.</li>
      </ol>
      {busy ? <Spinner label="Reading your accounts" /> : <UrScanner expect={KEYSTONE_EXPORT_TYPES} onComplete={onComplete} start={props.scanner} label="Camera preview for your Keystone's code" />}
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
            <li className="clip-step">Plug in your Ledger and unlock it with your PIN.</li>
            <li className="clip-step">Open the {words.app} app on it.</li>
            <li className="clip-step">Press Connect and choose your Ledger in the list your browser shows.</li>
          </ol>
        ) : (
          <p className="clip-lede">Got it. Now pick the accounts to add.</p>
        )}
        {props.advanced && props.family !== "hedera" && (
          <Toggle
            label="Use Ledger Live's accounts"
            description="Only if you made these accounts in Ledger Live. Clip Wallet's usual accounts match MetaMask, Phantom and other wallets."
            checked={style === "ledger-live"}
            onChange={(v) => setStyle(v ? "ledger-live" : "standard")}
          />
        )}
        <ErrorNote message={err} />
        <Button block disabled={busy} onClick={() => void load(0)}>
          {busy ? "Connecting…" : props.kind === "ledger" ? "Connect" : "Show accounts"}
        </Button>
      </>
    );
  }

  return (
    <>
      <p className="clip-lede">Pick the accounts to add. You can add more later in Settings.</p>
      <ul className="clip-list" aria-label="Accounts on your device">
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
              <span>Account {a.index + 1}</span>
              <code className="clip-mono">{a.address ? shortAddress(a.address) : "New Hedera account"}</code>
            </label>
          </li>
        ))}
      </ul>
      <ErrorNote message={err} />
      <Button variant="ghost" disabled={busy} onClick={() => void load(accounts.length)}>
        Show more
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
        {picked.size === 1 ? "Add 1 account" : `Add ${picked.size} accounts`}
      </Button>
    </>
  );
}
