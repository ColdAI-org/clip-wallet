/**
 * Settings → Linked devices on the phone (r1/connect), on wallet.link (LinkService in src/background/link.ts):
 *  - linked browsers / Clip Desktop that send requests here; they arrive on the normal approval sheet,
 *  - scan a pairing code (clipwallet://link?…) to link a browser, or to move a wallet in either direction,
 *  - the 6-digit code to compare on both screens, then (moving a wallet) the password step,
 *  - settings sync, and pages other devices asked to continue here.
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { relativeTime, userMessageOf, type LinkStatusView, type PairingView } from "@clip-wallet/ui";
import { useWallet } from "../ui/context";
import { Button, Card, Empty, ErrorNote, Field, MenuItem, Notice, Screen, Spinner, T, Toggle } from "../ui/kit";
import { APP } from "../env";
import { useMobileT } from "../i18n";

export function useLinkStatus(): { status: LinkStatusView | undefined; error: unknown; reload: () => void } {
  const { wallet } = useWallet();
  const [status, setStatus] = useState<LinkStatusView>();
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(() => {
    wallet.link.status().then(
      (s) => (setStatus(s), setError(null)),
      (e) => setError(e),
    );
  }, [wallet]);
  useEffect(() => {
    reload();
    const off = wallet.events.on((e) => e.type === "change" && reload());
    const t = setInterval(reload, 1500);
    return () => {
      off();
      clearInterval(t);
    };
  }, [wallet, reload]);
  return { status, error, reload };
}

export function LinkedDevices() {
  const t = useMobileT();
  const { wallet, navigate } = useWallet();
  const link = wallet.link;
  const { status, error, reload } = useLinkStatus();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  if (!status) {
    return (
      <Screen back title={t("m.link.title")}>
        <ErrorNote message={error ? userMessageOf(error) : null} />
        {!error && <Spinner />}
      </Screen>
    );
  }
  return (
    <Screen back title={t("m.link.title")}>
      <T v="lede">{t("m.link.lede")}</T>
      <ErrorNote message={err} />

      {status.handoffs.map((h) => (
        <Card key={h.id}>
          <View testID="handoff" style={{ gap: 8 }}>
            <T v="label">{t("m.link.handoff.from", { site: new URL(h.origin).hostname, device: h.from ?? "" })}</T>
            <T v="hint">{h.verified ? t("m.link.handoff.verified") : t("m.link.handoff.unverified")}</T>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button onPress={() => run(async () => navigate({ name: "browser", url: (await link.handoffAccept({ id: h.id })).url }))}>{t("m.link.handoff.open")}</Button>
              <Button variant="ghost" onPress={() => run(() => link.handoffDismiss({ id: h.id }))}>
                {t("m.link.handoff.dismiss")}
              </Button>
            </View>
          </View>
        </Card>
      ))}

      <T v="h2">{t("m.link.devices")}</T>
      {status.devices.length === 0 ? (
        <Empty title={t("m.link.none")}>{t("m.link.noneHint", { name: APP.config.name })}</Empty>
      ) : (
        <>
          <T v="hint">{t("m.link.listening", { name: APP.config.name })}</T>
          {status.devices.map((d) => (
            <Card key={d.id}>
              <View testID="linked-device" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <T v="label">{d.name}</T>
                  <T v="hint">{d.online ? t("m.link.online") : d.lastSeenAt ? t("m.link.lastSeen", { time: relativeTime(d.lastSeenAt) }) : t("m.link.offline")}</T>
                </View>
                <Button variant="ghost" disabled={busy} onPress={() => run(() => link.deviceRemove({ id: d.id }))}>
                  {t("m.link.remove")}
                </Button>
              </View>
            </Card>
          ))}
        </>
      )}

      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {status.capabilities.relay && <MenuItem title={t("m.link.scan")} testID="link-scan" onPress={() => navigate({ name: "scan" })} />}
        {status.capabilities.relay && <MenuItem title={t("m.link.add")} hint={t("m.link.addHint")} testID="link-add" onPress={() => navigate({ name: "scan" })} />}
      </Card>

      {status.capabilities.sync && (
        <View style={{ gap: 8 }}>
          <T v="h2">{t("m.link.sync.title")}</T>
          <Toggle label={t("m.link.sync.toggle")} description={t("m.link.sync.hint")} checked={status.sync.enabled} disabled={busy} testID="link-sync" onChange={(v) => run(() => link.syncSet({ enabled: v }))} />
          {status.sync.enabled && (
            <>
              <T v="hint">{status.sync.error ?? (status.sync.lastSyncAt ? t("m.link.sync.last", { time: relativeTime(status.sync.lastSyncAt) }) : t("m.link.sync.never"))}</T>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button variant="secondary" disabled={busy} onPress={() => run(() => link.syncNow())}>
                  {t("m.link.sync.now")}
                </Button>
                <Button variant="ghost" disabled={busy} onPress={() => run(async () => (await link.syncDelete(), setNote(t("m.link.sync.deleted"))))}>
                  {t("m.link.sync.delete")}
                </Button>
              </View>
            </>
          )}
          {note && <Notice level="info">{note}</Notice>}
        </View>
      )}
    </Screen>
  );
}

/** One pairing: from a scanned code (`uri`) or an existing run (`id`) to linked / moved. */
export function LinkPair(props: { uri?: string; id?: string }) {
  const t = useMobileT();
  const { wallet, navigate, back, refresh } = useWallet();
  const link = wallet.link;
  const { status } = useLinkStatus();
  const [id, setId] = useState<string | undefined>(props.id);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");

  useEffect(() => {
    if (id || !props.uri) return;
    link.pairScan({ uri: props.uri }).then(
      (v) => setId(v.id),
      (e) => setErr(userMessageOf(e)),
    );
  }, [link, id, props.uri]);

  const p: PairingView | undefined = status?.pairings.find((x) => x.id === id);
  useEffect(() => {
    if (p?.state === "done" && p.direction === "receive") void refresh();
  }, [p?.state, p?.direction, refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = () => navigate({ name: "home" });
  const cancel = () => {
    if (id) void link.pairCancel({ id });
    back();
  };
  const peer = p?.peerName ?? "";

  return (
    <Screen back={cancel} title={t("m.link.pair.title")}>
      <ErrorNote message={err} />
      {!p && !err && <Spinner />}
      {(p?.state === "connecting" || p?.state === "waiting") && (
        <View style={{ gap: 12, alignItems: "center" }}>
          <Spinner />
          <T v="hint">{t("m.link.pair.connecting")}</T>
          <Button variant="ghost" onPress={cancel}>{t("m.link.pair.cancel")}</Button>
        </View>
      )}
      {p?.state === "compare" && p.sas && (
        <View style={{ gap: 12 }}>
          <T v="h2">{t("m.link.pair.compare")}</T>
          <T v="display" testID="sas" style={{ textAlign: "center", letterSpacing: 4, writingDirection: "ltr" }}>{`${p.sas.slice(0, 3)} ${p.sas.slice(3)}`}</T>
          <T v="hint">{t("m.link.pair.compareHint", { device: peer })}</T>
          <Button block disabled={busy} testID="sas-match" onPress={() => act(() => link.pairConfirm({ id: p.id, match: true }))}>
            {t("m.link.pair.match")}
          </Button>
          <Button block variant="secondary" disabled={busy} testID="sas-mismatch" onPress={() => act(() => link.pairConfirm({ id: p.id, match: false }))}>
            {t("m.link.pair.noMatch")}
          </Button>
        </View>
      )}
      {p?.state === "confirming" && (
        <View style={{ gap: 12, alignItems: "center" }}>
          <Spinner />
          <T v="hint">{t("m.link.pair.confirming")}</T>
        </View>
      )}
      {p?.state === "password" && p.direction !== "receive" && (
        <View style={{ gap: 12 }}>
          <T v="h2">{t("m.link.transfer.sendTitle", { device: peer })}</T>
          <T v="hint">{t("m.link.transfer.sendHint")}</T>
          <Field label={t("m.link.transfer.password")} secureTextEntry value={pw} onChangeText={setPw} testID="transfer-password" />
          <Button block disabled={busy || !pw} onPress={() => act(async () => (await link.transferSend({ id: p.id, password: pw }), setPw("")))}>
            {t("m.link.transfer.send")}
          </Button>
        </View>
      )}
      {p?.state === "password" && p.direction === "receive" && (
        <View style={{ gap: 12 }}>
          <T v="h2">{t("m.link.transfer.receiveTitle")}</T>
          <T v="hint">{t("m.link.transfer.receiveHint")}</T>
          <Field label={t("m.link.transfer.newPassword")} secureTextEntry value={pw} onChangeText={setPw} />
          <Field label={t("m.link.transfer.repeat")} secureTextEntry value={pw2} onChangeText={setPw2} />
          <Button
            block
            disabled={busy || pw.length < 8}
            onPress={() => (pw !== pw2 ? setErr(t("m.link.transfer.mismatch")) : void act(async () => (await link.transferReceive({ id: p.id, password: pw }), setPw(""), setPw2(""))))}
          >
            {t("m.link.transfer.receive")}
          </Button>
        </View>
      )}
      {p?.state === "transferring" && (
        <View style={{ gap: 12, alignItems: "center" }}>
          <Spinner />
          <T v="hint">{t("m.link.transfer.moving")}</T>
        </View>
      )}
      {p?.state === "done" && (
        <View style={{ gap: 12 }}>
          <T v="h2">
            {p.purpose === "device-add" ? (p.direction === "receive" ? t("m.link.transfer.received") : t("m.link.transfer.sent", { device: peer })) : t("m.link.pair.done", { device: peer })}
          </T>
          {p.purpose !== "device-add" && <T v="hint">{t("m.link.pair.doneHint")}</T>}
          <Button block onPress={finish}>{t("m.link.pair.close")}</Button>
        </View>
      )}
      {p?.state === "failed" && (
        <View style={{ gap: 12 }}>
          <T v="h2">{t("m.link.pair.failed")}</T>
          <T>{p.error?.userMessage ?? ""}</T>
          <Button block onPress={back}>{t("m.link.pair.again")}</Button>
        </View>
      )}
    </Screen>
  );
}
