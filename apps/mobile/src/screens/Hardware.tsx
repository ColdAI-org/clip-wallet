/**
 * Hardware wallets: the extension's HardwareSettings, ConnectHardware and the approval-time device steps
 * (packages/ui/src/hardware/*) in React Native.
 *
 *   Ledger    over Bluetooth (Nano X, Stax, Flex): scan, pick your Ledger, then its accounts. The engine
 *             reopens the same Ledger for every approval (background/ledger-ble.ts).
 *   Keystone  air-gapped: scan its account QR with the camera; to sign, it scans our animated request QR and
 *             we scan its answer.
 *
 * Keys stay on the device. The wallet only stores addresses, public keys and paths.
 */
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { DEVICE_FAMILIES, FAMILY_WORDS, userMessageOf, type HardwareAccountView, type HardwareApprovalState, type HardwareFamilyView, type HardwareKindView, type KeystoneRequestView, type PathStyleView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Checkbox, Chip, Choices, Empty, ErrorNote, Field, Screen, Spinner, Steps, T, Toggle } from "../ui/kit";
import { AnimatedUrQr, UrScanner } from "../ui/ur";
import type { LedgerDeviceView } from "../background/ledger-ble";

const PAGE = 5;
export const KEYSTONE_EXPORT_TYPES = ["crypto-multi-accounts", "crypto-hdkey", "crypto-account"];

const short = (a: string): string => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/* ------------------------------------------------------------------ Settings → Hardware wallets */

interface Device {
  key: string;
  kind: HardwareKindView;
  name: string;
  accounts: HardwareAccountView[];
}

function devices(accounts: HardwareAccountView[]): Device[] {
  const by = new Map<string, Device>();
  for (const a of accounts) {
    // Ledger apps report different ids per app, so group Ledger accounts by device kind + name only.
    const key = a.hardware.kind === "keystone" ? `keystone:${a.hardware.fingerprint}` : `ledger:${a.hardware.deviceName ?? ""}`;
    const d = by.get(key) ?? { key, kind: a.hardware.kind, name: a.hardware.deviceName ?? (a.hardware.kind === "ledger" ? "Ledger" : "Keystone"), accounts: [] };
    d.accounts.push(a);
    by.set(key, d);
  }
  return [...by.values()];
}

export function HardwareSettings() {
  const { wallet, navigate } = useWallet();
  const hw = wallet.hardware;
  const { data, error, reload } = useAsync(() => hw.listAccounts(), [hw]);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(userMessageOf(e));
    }
  };
  const forget = (d: Device) =>
    Alert.alert(`Remove ${d.name}?`, "Your funds stay on the device. You can connect it again any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void run(async () => {
            for (const fp of new Set(d.accounts.map((a) => a.hardware.fingerprint))) await hw.forgetDevice(d.kind, fp);
            if (d.kind === "ledger") await wallet.ledger.forget();
          }),
      },
    ]);

  return (
    <Screen
      back
      title="Hardware wallets"
      footer={
        <Button block onPress={() => navigate({ name: "hardware-connect" })} testID="hw-connect">
          Connect a hardware wallet
        </Button>
      }
    >
      <ErrorNote message={error ? userMessageOf(error) : err} />
      {!data ? (
        error ? null : <Spinner />
      ) : data.length === 0 ? (
        <Empty title="No hardware wallet yet">Connect a Ledger or Keystone to keep your keys off this phone.</Empty>
      ) : (
        devices(data).map((d) => (
          <Card key={d.key}>
            <T v="h2">{d.name}</T>
            {d.accounts.map((a) =>
              editing === a.id ? (
                <View key={a.id} style={{ gap: 8 }}>
                  <Field label="Account name" value={label} onChangeText={setLabel} autoFocus testID={`hw-name-${a.id}`} />
                  <Button onPress={() => (setEditing(null), void run(() => hw.renameAccount(a.id, label.trim())))}>Save</Button>
                </View>
              ) : (
                <View key={a.id} testID={`hw-account-${a.id}`} style={{ gap: 6, paddingVertical: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <T style={{ fontWeight: "600" }}>{a.label ?? `${FAMILY_WORDS[a.family].title} · Account ${a.index + 1}`}</T>
                    {a.hardware.pathStyle !== "standard" && <T v="hint">(Ledger Live)</T>}
                    {a.active && <Chip tone="accent">In use</Chip>}
                  </View>
                  <T v="mono">{a.address ? short(a.address) : "No account id yet"}</T>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {!a.active && (
                      <Button variant="secondary" testID={`hw-use-${a.id}`} onPress={() => void run(() => hw.setActive(a.family, a.id))}>
                        Use this account
                      </Button>
                    )}
                    <Button variant="ghost" onPress={() => (setEditing(a.id), setLabel(a.label ?? ""))}>
                      Rename
                    </Button>
                  </View>
                </View>
              ),
            )}
            {d.accounts.some((a) => a.active) && (
              <Button variant="ghost" block onPress={() => void run(async () => { for (const a of d.accounts.filter((x) => x.active)) await hw.setActive(a.family, null); })}>
                Use my recovery-phrase accounts instead
              </Button>
            )}
            <Button variant="danger" block onPress={() => forget(d)} testID={`hw-forget-${d.kind}`}>
              {`Remove ${d.name}`}
            </Button>
          </Card>
        ))
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ Connect a hardware wallet */

type Step =
  | { s: "pick-device" }
  | { s: "pick-family"; kind: HardwareKindView }
  | { s: "ledger-device"; family: HardwareFamilyView }
  | { s: "keystone-scan"; family: HardwareFamilyView }
  | { s: "accounts"; kind: HardwareKindView; family: HardwareFamilyView };

export function ConnectHardware(props: { onDone?: () => void }) {
  const { back, state } = useWallet();
  const [step, setStep] = useState<Step>({ s: "pick-device" });
  const goBack = step.s === "pick-device" ? true : () => setStep({ s: "pick-device" });
  const done = props.onDone ?? back;
  return (
    <Screen back={goBack} title="Connect a hardware wallet">
      {step.s === "pick-device" && (
        <>
          <T v="lede">Your keys stay on the device. This app only sees your addresses, and every payment needs your OK on the device.</T>
          <Choices
            label="Device"
            testID="hw-device"
            value={undefined}
            onChange={(kind: HardwareKindView) => setStep({ s: "pick-family", kind })}
            options={[
              { value: "ledger", title: "Ledger", hint: "Nano X, Stax or Flex, over Bluetooth." },
              { value: "keystone", title: "Keystone", hint: "No cable or Bluetooth: you scan QR codes with the camera." },
            ]}
          />
        </>
      )}
      {step.s === "pick-family" && (
        <>
          <T v="lede">What do you keep on it?</T>
          <Choices
            label="What it holds"
            testID="hw-family"
            value={undefined}
            onChange={(family: HardwareFamilyView) => setStep(step.kind === "keystone" ? { s: "keystone-scan", family } : { s: "ledger-device", family })}
            options={DEVICE_FAMILIES[step.kind].map((f) => ({ value: f, title: FAMILY_WORDS[f].title, hint: FAMILY_WORDS[f].assets }))}
          />
        </>
      )}
      {step.s === "ledger-device" && <PickLedger app={FAMILY_WORDS[step.family].app} onPicked={() => setStep({ s: "accounts", kind: "ledger", family: step.family })} />}
      {step.s === "keystone-scan" && <KeystoneSync onSynced={() => setStep({ s: "accounts", kind: "keystone", family: step.family })} />}
      {step.s === "accounts" && <PickAccounts kind={step.kind} family={step.family} advanced={!!state?.prefs.advanced} onDone={done} />}
    </Screen>
  );
}

function PickLedger(props: { app: string; onPicked: () => void }) {
  const { wallet } = useWallet();
  const [phase, setPhase] = useState<"intro" | "scanning">("intro");
  const [found, setFound] = useState<LedgerDeviceView[]>([]);
  const [known, setKnown] = useState<LedgerDeviceView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void wallet.ledger.selected().then(setKnown);
  }, [wallet]);
  useEffect(() => {
    if (phase !== "scanning") return;
    return wallet.ledger.scan(
      (d) => setFound((list) => (list.some((x) => x.id === d.id) ? list : [...list, d])),
      (m) => setErr(m),
    );
  }, [phase, wallet]);

  const start = async () => {
    setErr(null);
    setBusy(true);
    try {
      await wallet.ledger.prepare();
      setFound([]);
      setPhase("scanning");
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = async (d: LedgerDeviceView) => {
    await wallet.ledger.select(d);
    props.onPicked();
  };

  return (
    <>
      <Steps
        label="Before you connect"
        items={["Turn on your Ledger and unlock it with your PIN.", "Turn on Bluetooth on your Ledger (Settings → Bluetooth).", `Open the ${props.app} app on it.`]}
      />
      {known && phase === "intro" && (
        <Button block variant="secondary" testID="ledger-known" onPress={() => props.onPicked()}>
          {`Use ${known.name} again`}
        </Button>
      )}
      {phase === "intro" ? (
        <Button block disabled={busy} onPress={() => void start()} testID="ledger-scan">
          {busy ? "Checking Bluetooth…" : "Look for my Ledger"}
        </Button>
      ) : (
        <Card>
          <T v="h2">Ledgers nearby</T>
          {found.length === 0 && <Spinner />}
          {found.map((d) => (
            <Pressable key={d.id} accessibilityRole="button" testID={`ledger-${d.id}`} onPress={() => void pick(d)} style={{ paddingVertical: 10 }}>
              <T style={{ fontWeight: "600" }}>{d.name}</T>
              <T v="hint">Tap to connect. Your Ledger may ask you to confirm a pairing code.</T>
            </Pressable>
          ))}
        </Card>
      )}
      <ErrorNote message={err} />
    </>
  );
}

function KeystoneSync(props: { onSynced: () => void }) {
  const { wallet } = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Steps
        items={[
          "On your Keystone, open the menu and choose “Connect Software Wallet”.",
          "Pick a wallet that supports the networks you want (any “Keystone” or “MetaMask” option works for Ethereum).",
          "Hold the QR code it shows in front of this camera.",
        ]}
      />
      {busy ? (
        <Spinner />
      ) : (
        <UrScanner
          expect={KEYSTONE_EXPORT_TYPES}
          label="Camera preview for your Keystone's code"
          onComplete={(ur) => {
            setBusy(true);
            wallet.hardware
              .keystoneImport(ur)
              .then(() => props.onSynced())
              .catch((e: unknown) => {
                setErr(userMessageOf(e));
                setBusy(false);
              });
          }}
        />
      )}
      <ErrorNote message={err} />
    </>
  );
}

function PickAccounts(props: { kind: HardwareKindView; family: HardwareFamilyView; advanced: boolean; onDone: () => void }) {
  const { wallet } = useWallet();
  const hw = wallet.hardware;
  const [style, setStyle] = useState<PathStyleView>("standard");
  const [accounts, setAccounts] = useState<HardwareAccountView[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (start: number) => {
    setBusy(true);
    setErr(null);
    try {
      const more = props.kind === "ledger" ? await hw.ledgerAccounts(props.family, start, PAGE, style) : await hw.keystoneAccounts(props.family, start, PAGE, style);
      setAccounts((prev) => [...(start === 0 ? [] : (prev ?? [])), ...more]);
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
        <T v="lede">{props.kind === "ledger" ? "Keep your Ledger unlocked with the app open." : "Got it. Now pick the accounts to add."}</T>
        {props.advanced && props.family !== "hedera" && (
          <Toggle
            label="Use Ledger Live's accounts"
            description="Only if you made these accounts in Ledger Live. The usual accounts match MetaMask, Phantom and other wallets."
            checked={style === "ledger-live"}
            onChange={(v) => setStyle(v ? "ledger-live" : "standard")}
          />
        )}
        <ErrorNote message={err} />
        <Button block disabled={busy} onPress={() => void load(0)} testID="hw-load">
          {busy ? "Connecting…" : "Show accounts"}
        </Button>
      </>
    );
  }

  return (
    <>
      <T v="lede">Pick the accounts to add. You can add more later in Settings.</T>
      <Card>
        {accounts.map((a) => (
          <View key={a.id} style={{ gap: 2, paddingVertical: 4 }}>
            <Checkbox
              testID={`hw-pick-${a.index}`}
              label={`Account ${a.index + 1}`}
              checked={picked.has(a.id)}
              onChange={(on) => {
                const next = new Set(picked);
                if (on) next.add(a.id);
                else next.delete(a.id);
                setPicked(next);
              }}
            />
            <T v="mono" style={{ marginLeft: 32 }}>
              {a.address ? short(a.address) : "New Hedera account"}
            </T>
          </View>
        ))}
      </Card>
      <ErrorNote message={err} />
      <Button variant="ghost" block disabled={busy} onPress={() => void load(accounts.length)}>
        Show more
      </Button>
      <Button
        block
        disabled={busy || picked.size === 0}
        testID="hw-add"
        onPress={async () => {
          setBusy(true);
          try {
            await hw.addAccounts([...picked]);
            props.onDone();
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

/* ------------------------------------------------------------------ during an approval */

export function LedgerConfirm(props: { title: string; app: string; error?: string | null; onCancel: () => void }) {
  return (
    <>
      <T v="h1">Confirm on your Ledger</T>
      <T v="lede">{props.title}</T>
      {props.error ? (
        <ErrorNote message={props.error} />
      ) : (
        <>
          <Steps items={[`Make sure the ${props.app} app is open on your Ledger.`, "Check that what your Ledger shows matches this request.", "Approve it on the Ledger."]} />
          <Spinner />
        </>
      )}
      <Button variant="ghost" block onPress={props.onCancel} testID="hw-cancel">
        Cancel
      </Button>
    </>
  );
}

export function KeystoneExchange(props: { title: string; request: KeystoneRequestView; onSignature: (ur: { type: string; cborHex: string }) => void; onCancel: () => void; error?: string | null }) {
  const [phase, setPhase] = useState<"show" | "scan">("show");
  return (
    <>
      <T v="h1">{phase === "show" ? "Scan with your Keystone" : "Scan the signature"}</T>
      <T v="lede">{props.title}</T>
      {phase === "show" ? (
        <>
          <AnimatedUrQr ur={props.request} label="Request for your Keystone" />
          <T v="hint">Scan this with your Keystone, check the details on its screen and approve. Then come back here.</T>
          <Button block onPress={() => setPhase("scan")} testID="keystone-next">
            Next: scan the signature
          </Button>
        </>
      ) : (
        <>
          <UrScanner expect={props.request.expect} onComplete={props.onSignature} label="Camera preview for your Keystone's signature" />
          <Button variant="ghost" block onPress={() => setPhase("show")}>
            Show the request again
          </Button>
        </>
      )}
      <ErrorNote message={props.error} />
      <Button variant="ghost" block onPress={props.onCancel} testID="hw-cancel">
        Cancel
      </Button>
    </>
  );
}

/** Shown over the approval sheet while the engine waits for a hardware wallet (ApprovalView.hardware). */
export function HardwareStep(props: { approvalId: string; title: string; state: HardwareApprovalState }) {
  const { wallet, theme } = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const cancel = () => void wallet.hardware.hardwareCancel(props.approvalId).catch((e: unknown) => setErr(userMessageOf(e)));
  const s = props.state;
  return (
    <ScrollView testID="hardware-step" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.c.bg }} contentContainerStyle={{ padding: theme.s(4), paddingTop: theme.s(8), gap: theme.s(4) }}>
      {s.kind === "ledger" ? (
        <LedgerConfirm title={props.title} app={s.app} error={s.error ?? err} onCancel={cancel} />
      ) : (
        <KeystoneExchange
          title={props.title}
          request={s.request}
          error={s.error ?? err}
          onCancel={cancel}
          onSignature={(ur) => void wallet.hardware.keystoneAnswer(props.approvalId, ur).catch((e: unknown) => setErr(userMessageOf(e)))}
        />
      )}
    </ScrollView>
  );
}
