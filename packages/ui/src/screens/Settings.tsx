import { useEffect, useRef, useState } from "react";
import type { Prefs } from "../client";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, ErrorNote, Field, Row, Screen, Toggle } from "../components";
import { PasskeyEnroll } from "./Passkey";
import { relativeTime } from "../lib/format";

const AUTO_LOCK = [1, 5, 15, 30, 60];

export function isWalletConnectUri(uri: string): boolean {
  return /^wc:[0-9a-f]{64}@2\?/i.test(uri.trim()) && /[?&]symKey=[0-9a-f]{64}/i.test(uri) && /[?&]relay-protocol=/i.test(uri);
}

function Section(props: { title: string; children: React.ReactNode; id?: string }) {
  const id = props.id ?? props.title.toLowerCase().replace(/\W+/g, "-");
  return (
    <section aria-labelledby={id} className="clip-settings-section">
      <h2 id={id} className="clip-h2">
        {props.title}
      </h2>
      <Card>{props.children}</Card>
    </section>
  );
}

function Sessions() {
  const { client, state } = useUi();
  const { data, reload, error } = useAsync(() => client.listSessions(), [client]);
  return (
    <Section title="Connected apps">
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {data && data.length === 0 && <p className="clip-hint">No apps are connected.</p>}
      <ul className="clip-sessions">
        {data?.map((s) => (
          <li key={s.id} className="clip-session">
            <div>
              <div className="clip-session__name">{s.dapp.name}</div>
              <div className="clip-session__meta">
                {s.dapp.domain} · {s.via === "walletconnect" ? "WalletConnect" : "In this browser"} · {relativeTime(s.connectedAt)}
                {state?.prefs.advanced && s.networkIds.length > 0 && <> · {s.networkIds.join(", ")}</>}
              </div>
            </div>
            <Button
              variant="secondary"
              aria-label={`Disconnect ${s.dapp.name}`}
              onClick={async () => {
                await client.disconnect(s.id);
                reload();
              }}
            >
              Disconnect
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function WalletConnectPair() {
  const { client } = useUi();
  const [uri, setUri] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = isWalletConnectUri(uri);
  return (
    <Section title="Connect with a code" id="walletconnect">
      <p className="clip-hint">For apps on another device or browser: copy their WalletConnect code (it starts with "wc:") or scan its QR code.</p>
      <Field
        label="Connection code"
        placeholder="wc:…"
        autoComplete="off"
        spellCheck={false}
        value={uri}
        onChange={(e) => {
          setUri(e.target.value);
          setErr(null);
          setMsg(null);
        }}
        error={uri && !valid ? "That doesn't look like a WalletConnect code." : null}
      />
      <ErrorNote message={err} />
      {msg && <p className="clip-notice clip-notice--info">{msg}</p>}
      <div className="clip-actions">
        <Button variant="secondary" onClick={() => client.openFullTab("/scan")}>
          Scan QR code
        </Button>
        <Button
          disabled={!valid}
          onClick={async () => {
            try {
              await client.pairWalletConnect(uri.trim());
              setUri("");
              setMsg("Pairing started. The app will ask you to connect.");
            } catch (e) {
              setErr(userMessageOf(e));
            }
          }}
        >
          Connect
        </Button>
      </div>
    </Section>
  );
}

function AdvancedNetworks(props: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => Promise<void> }) {
  const { client } = useUi();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const [draft, setDraft] = useState<Record<string, string>>(props.prefs.rpcOverrides);
  return (
    <Section title="Networks">
      {data?.networks.map((n) => (
        <div key={n.id} className="clip-network-adv">
          <Row label={n.name} value={<code className="clip-mono">{n.id}</code>} hint={n.chainId !== undefined ? `chain id ${n.chainId}` : undefined} />
          <Field
            label={`RPC override for ${n.name}`}
            placeholder={n.rpcUrl ?? "https://"}
            value={draft[n.id] ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, [n.id]: e.target.value }))}
            onBlur={() => {
              const v = (draft[n.id] ?? "").trim();
              const next = { ...props.prefs.rpcOverrides };
              if (v && /^https:\/\//.test(v)) next[n.id] = v;
              else delete next[n.id];
              void props.setPrefs({ rpcOverrides: next });
            }}
            error={draft[n.id] && !/^https:\/\//.test(draft[n.id]!) ? "Use an https:// URL." : null}
          />
        </div>
      ))}
    </Section>
  );
}

export function Settings() {
  const { client, state, refresh, config } = useUi();
  const [enrolling, setEnrolling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  const { navigate } = useRouter();
  if (!state) return null;
  const prefs = state.prefs;
  const setPrefs = async (p: Partial<Prefs>) => {
    try {
      await client.setPrefs(p);
      await refresh();
    } catch (e) {
      setErr(userMessageOf(e));
    }
  };

  return (
    <Screen nav title="Settings">
      <ErrorNote message={err} />
      <Section title="Display">
        <label className="clip-select-row">
          <span>Currency</span>
          <select className="clip-select" value={prefs.displayCurrency} onChange={(e) => setPrefs({ displayCurrency: e.target.value })}>
            {config.currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="clip-select-row">
          <span>Appearance</span>
          <select className="clip-select" value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as Prefs["theme"] })}>
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </Section>

      <Section title="Security">
        <label className="clip-select-row">
          <span>Lock automatically after</span>
          <select className="clip-select" value={prefs.autoLockMinutes} onChange={(e) => setPrefs({ autoLockMinutes: Number(e.target.value) })}>
            {AUTO_LOCK.map((m) => (
              <option key={m} value={m}>
                {m === 60 ? "1 hour" : `${m} minute${m === 1 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </label>
        <div className="clip-passkey-row">
          <div>
            <div className="clip-toggle__label">Unlock with Face ID / Touch ID</div>
            <div className="clip-toggle__desc">{state.passkey.enrolled ? "On for this device." : "Use a passkey instead of your password."}</div>
          </div>
          {state.passkey.enrolled ? (
            <Button
              variant="secondary"
              onClick={async () => {
                await client.passkeyRemove();
                await refresh();
              }}
            >
              Remove
            </Button>
          ) : (
            !enrolling && (
              <Button variant="secondary" onClick={() => setEnrolling(true)}>
                Set up
              </Button>
            )
          )}
        </div>
        {enrolling && <PasskeyEnroll onDone={() => setEnrolling(false)} />}
        <Button
          variant="secondary"
          block
          onClick={async () => {
            await client.lock();
            await refresh();
          }}
        >
          Lock now
        </Button>
      </Section>

      <Sessions />
      <WalletConnectPair />

      <Section title="Advanced">
        <Toggle
          label="Advanced mode"
          description="Shows network names, chain ids, RPC settings and raw requests. Also lets you override blocked unreadable requests, one at a time."
          checked={prefs.advanced}
          onChange={(v) => setPrefs({ advanced: v })}
        />
      </Section>
      {prefs.advanced && <AdvancedNetworks prefs={prefs} setPrefs={setPrefs} />}

      {state.mocks && client.devSimulateRequest && (
        <Section title="Developer (mock data)">
          <p className="clip-hint">This build uses sample data. Simulate a request from an app:</p>
          <div className="clip-dev-buttons">
            {(["pay", "connect", "blind", "approval-for-all"] as const).map((k) => (
              <Button
                key={k}
                variant="secondary"
                onClick={async () => {
                  const id = await client.devSimulateRequest!(k);
                  setDevMsg(`Queued ${k} request`);
                  await refresh();
                  navigate(`/approval/${encodeURIComponent(id)}`);
                }}
              >
                {k}
              </Button>
            ))}
          </div>
          {devMsg && <p className="clip-hint">{devMsg}</p>}
        </Section>
      )}

      <p className="clip-about">
        {config.name} · test networks only
      </p>
    </Screen>
  );
}

/* ------------------------------------------------------------------ camera QR scan (full tab) */

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

export function ScanWalletConnect() {
  const { client } = useUi();
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<string>("Point your camera at the app's QR code.");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let stop = false;
    const Detector = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    if (!Detector) {
      setErr("This browser can't read QR codes from the camera. Paste the connection code in Settings instead.");
      return;
    }
    const detector = new Detector({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => []);
          const hit = codes.find((c) => isWalletConnectUri(c.rawValue));
          if (hit) {
            setStatus("Found it. Connecting…");
            await client.pairWalletConnect(hit.rawValue);
            setDone(true);
            setStatus("Pairing started. Go back to the app to finish connecting.");
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch (e) {
        setErr(e && typeof e === "object" && "name" in e && (e as { name: string }).name === "NotAllowedError" ? "Camera access was blocked. Allow it, or paste the code instead." : userMessageOf(e));
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [client]);

  return (
    <Screen title="Scan to connect">
      {!done && !err && <video ref={video} className="clip-scan-video" muted playsInline aria-label="Camera preview" />}
      <ErrorNote message={err} />
      <p className="clip-lede">{status}</p>
    </Screen>
  );
}
