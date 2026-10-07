/**
 * Ledger over Bluetooth (Nano X, Stax, Flex) through @ledgerhq/react-native-hw-transport-ble 6.41, which
 * depends on react-native-ble-plx 3.4.0. The packages load on first use, so the app starts (and the screen
 * tests run) without the native Bluetooth module.
 *
 * Flow: the Connect screen scans (`scan`), the user picks their Ledger, we remember its id (`select`), and
 * `transport` opens it for @clip-wallet/hardware's LedgerSigner. Later approvals reopen the same device.
 *
 * Permissions (app.config.ts): iOS NSBluetoothAlwaysUsageDescription (ble-plx config plugin). Android 12+
 * asks for BLUETOOTH_SCAN (declared neverForLocation) and BLUETOOTH_CONNECT at run time; Android 11 and
 * lower need ACCESS_FINE_LOCATION for BLE scans.
 *
 * New Architecture: ble-plx 3.4.0 is a legacy native module (no codegenConfig) and runs through React Native's
 * interop layer. dotintent/react-native-ble-plx#1277 reports a crash on connect with the New Architecture
 * (RN 0.76.7, still open). RN 0.82+ has no legacy architecture to fall back to, so this path is unverified
 * until it runs on a device.
 */
import { PermissionsAndroid, Platform } from "react-native";
import { ClipError } from "@clip-wallet/core";
import type { KV } from "@clip-wallet/engine";
import type { TransportFactory } from "@clip-wallet/hardware";

const KEY = "clip-mobile/ledger-device";

export interface LedgerDeviceView {
  id: string;
  name: string;
}

export interface LedgerBle {
  /** Asks for Bluetooth permission (Android) and checks Bluetooth is on. Throws a plain ClipError. */
  prepare(): Promise<void>;
  /** Scans for Ledgers until the returned stop() is called. */
  scan(onDevice: (d: LedgerDeviceView) => void, onError: (message: string) => void): () => void;
  select(d: LedgerDeviceView): Promise<void>;
  selected(): Promise<LedgerDeviceView | null>;
  forget(): Promise<void>;
  /** For LedgerSigner: opens the remembered Ledger. */
  transport: TransportFactory;
}

type BleModule = typeof import("@ledgerhq/react-native-hw-transport-ble").default;

let bleModule: Promise<BleModule> | undefined;
/**
 * The BLE transport, loaded on first use (a dynamic import, so a published build keeps it a real dependency the
 * bundler sees, and a build without the native module only fails here, in plain words).
 */
function ble(): Promise<BleModule> {
  bleModule ??= import("@ledgerhq/react-native-hw-transport-ble").then(
    (m) => ((m as { default?: BleModule }).default ?? (m as unknown as BleModule)),
    (e: unknown) => {
      bleModule = undefined;
      throw new ClipError("Bluetooth isn't available in this build of the app.", "hw/no-bluetooth", e);
    },
  );
  return bleModule;
}

async function androidPermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const P = PermissionsAndroid.PERMISSIONS;
  const wanted = (Platform.Version as number) >= 31 ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT] : [P.ACCESS_FINE_LOCATION];
  const got = await PermissionsAndroid.requestMultiple(wanted);
  if (!wanted.every((p) => got[p] === PermissionsAndroid.RESULTS.GRANTED)) {
    throw new ClipError("Allow Bluetooth for this app in your phone's settings, then try again.", "hw/bluetooth-denied");
  }
}

function bluetoothOn(m: BleModule, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    let sub: { unsubscribe(): void } | undefined;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      queueMicrotask(() => sub?.unsubscribe());
      fn();
    };
    const t = setTimeout(() => finish(() => reject(new ClipError("Turn on Bluetooth, then try again.", "hw/bluetooth-off"))), timeoutMs);
    sub = m.observeState({
      next: (e) => e.available && finish(resolve),
      error: (e) => finish(() => reject(new ClipError("Turn on Bluetooth, then try again.", "hw/bluetooth-off", e))),
      complete: () => undefined,
    });
  });
}

export function ledgerBle(kv: KV): LedgerBle {
  return {
    async prepare() {
      await androidPermissions();
      await bluetoothOn(await ble());
    },
    scan(onDevice, onError) {
      let sub: { unsubscribe(): void } | undefined;
      let stopped = false;
      const fail = (e: unknown) => onError(e instanceof ClipError ? e.userMessage : "Bluetooth isn't available right now.");
      void ble().then((m) => {
        if (stopped) return;
        try {
          sub = m.listen({
            next: (e: { type: string; descriptor?: { id: string; localName?: string | null; name?: string | null } }) => {
              if (e.type === "add" && e.descriptor) onDevice({ id: e.descriptor.id, name: e.descriptor.localName ?? e.descriptor.name ?? "Ledger" });
            },
            error: () => onError("We couldn't look for your Ledger. Check that Bluetooth is on and try again."),
            complete: () => undefined,
          });
        } catch (e) {
          fail(e);
        }
      }, fail);
      return () => {
        stopped = true;
        sub?.unsubscribe();
      };
    },
    async select(d) {
      await kv.set(KEY, d);
    },
    async selected() {
      return (await kv.get<LedgerDeviceView>(KEY)) ?? null;
    },
    async forget() {
      const d = await kv.get<LedgerDeviceView>(KEY);
      await kv.set(KEY, null);
      if (d) await ble().then((m) => m.disconnectDevice(d.id)).catch(() => undefined);
    },
    transport: async () => {
      const d = await kv.get<LedgerDeviceView>(KEY);
      if (!d) throw new ClipError("Pick your Ledger first: Settings → Hardware wallets → Connect.", "hw/no-device");
      const m = await ble();
      await bluetoothOn(m);
      // The hardware package's LedgerConnection maps open/exchange failures to plain words (ledgerError).
      return (await m.open(d.id)) as unknown as Awaited<ReturnType<TransportFactory>>;
    },
  };
}
