import { useEffect, useMemo, useState } from "react";
import type { Family } from "@clip-wallet/core";
import { useAsync, useRouter } from "../context";
import { Button, Card, ErrorNote, Field, Screen, Spinner, Toggle } from "../components";
import { IconAlert } from "../components/icons";
import { formatLocale, shortAddress } from "../lib/format";
import { useUiT } from "../i18n";
import { useSocial } from "./context";
import { socialErrorText } from "./errors";
import { useFamilyName } from "./Contacts";

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/;

/**
 * Your Clip handle: claim one, choose which of your addresses it publishes (with the privacy warning first),
 * show it next to your address, or give it up. Every change is a Hedera transaction you approve.
 */
export function HandleScreen() {
  const t = useUiT();
  const social = useSocial();
  const { navigate } = useRouter();
  const { data, error, reload } = useAsync(() => social.handleStatus(), [social]);
  const familyName = useFamilyName();
  const [err, setErr] = useState<string | null>(null);

  const queued = (id: string) => navigate(`/approval/${encodeURIComponent(id)}`);
  const run = async (fn: () => Promise<{ approvalId: string }>) => {
    setErr(null);
    try {
      queued((await fn()).approvalId);
    } catch (e) {
      setErr(socialErrorText(e, t));
    }
  };

  if (error) {
    return (
      <Screen back title={t("social.handle.title")}>
        <ErrorNote message={socialErrorText(error, t)} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen back title={t("social.handle.title")}>
        <Spinner />
      </Screen>
    );
  }
  if (!data.enabled) {
    return (
      <Screen back title={t("social.handle.title")}>
        <p className="clip-lede">{t("social.handle.intro")}</p>
        <p className="clip-notice clip-notice--info">{t("social.handle.off")}</p>
      </Screen>
    );
  }

  return (
    <Screen back title={t("social.handle.title")}>
      <p className="clip-lede">{t("social.handle.intro")}</p>
      {!data.hederaReady && <p className="clip-notice clip-notice--caution">{t("social.handle.needHedera")}</p>}
      <ErrorNote message={err} />
      {data.mine ? (
        <Mine
          handle={data.mine.handle}
          since={new Date(data.mine.registeredAt).toLocaleDateString(formatLocale())}
          records={data.mine.records}
          publishable={data.publishable}
          reverse={data.mine.reverse}
          familyName={familyName}
          disabled={!data.hederaReady}
          onPublish={(records) => run(() => social.publishHandle(records))}
          onReverse={(on) => run(() => social.setHandleReverse(on))}
          onRelease={() => run(() => social.releaseHandle())}
        />
      ) : (
        <Claim disabled={!data.hederaReady} onClaim={(h) => run(() => social.registerHandle(h))} />
      )}
      <Button variant="ghost" onClick={reload}>
        {t("social.discover.refresh")}
      </Button>
    </Screen>
  );
}

function Claim(props: { disabled: boolean; onClaim: (handle: string) => Promise<void> }) {
  const t = useUiT();
  const social = useSocial();
  const [raw, setRaw] = useState("");
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  const valid = HANDLE_RE.test(handle);
  const [avail, setAvail] = useState<{ handle: string; available: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setAvail(null);
    if (!valid) return;
    let live = true;
    setChecking(true);
    const timer = setTimeout(() => {
      void social.checkHandle(handle).then(
        (r) => live && setAvail({ handle, available: r.available }),
        () => undefined,
      ).finally(() => live && setChecking(false));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [handle, valid, social]);

  const status = !raw ? undefined : !valid ? t("social.handle.rules") : checking || avail?.handle !== handle ? t("social.handle.checking") : avail.available ? t("social.handle.available", { handle }) : t("social.handle.taken", { handle });
  return (
    <Card>
      <Field
        label={t("social.handle.claimLabel")}
        placeholder="@alex"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        maxLength={33}
        error={raw && (!valid || (avail?.handle === handle && !avail.available)) ? status : null}
        hint={raw && valid && !(avail?.handle === handle && !avail.available) ? status : t("social.handle.rules")}
      />
      <p className="clip-hint">{t("social.handle.privacyOne", { handle: handle || "alex" })}</p>
      <Button block disabled={props.disabled || !valid || !avail?.available || avail.handle !== handle} onClick={() => void props.onClaim(handle)}>
        {t("social.handle.claim", { handle: handle || "…" })}
      </Button>
    </Card>
  );
}

function Mine(props: {
  handle: string;
  since: string;
  records: { family: Family; address: string }[];
  publishable: { family: Family; address: string }[];
  reverse: boolean;
  familyName: (f: Family) => string;
  disabled: boolean;
  onPublish: (records: { family: Family; address: string }[]) => Promise<void>;
  onReverse: (on: boolean) => Promise<void>;
  onRelease: () => Promise<void>;
}) {
  const t = useUiT();
  const published = useMemo(() => new Set(props.records.map((r) => `${r.family}|${r.address}`)), [props.records]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(props.publishable.filter((p) => published.has(`${p.family}|${p.address}`)).map((p) => p.family)));
  const [understood, setUnderstood] = useState(false);

  // What changes: families newly published, families whose address changes, families removed.
  const changes = props.publishable
    .map((p) => {
      const on = picked.has(p.family);
      const was = props.records.find((r) => r.family === p.family);
      if (on && was?.address !== p.address) return { family: p.family, address: p.address };
      if (!on && was) return { family: p.family, address: "" };
      return null;
    })
    .filter((x): x is { family: Family; address: string } => !!x);
  const willPublish = props.publishable.filter((p) => picked.has(p.family));
  const adding = changes.some((c) => c.address);

  return (
    <>
      <Card>
        <h2 className="clip-h2">{t("social.handle.yours", { handle: props.handle })}</h2>
        <p className="clip-hint">{t("social.handle.since", { date: props.since })}</p>
      </Card>

      <section aria-labelledby="handle-publish">
        <h2 id="handle-publish" className="clip-h2">
          {t("social.handle.publishTitle")}
        </h2>
        <p className="clip-hint">{t("social.handle.publishHint", { handle: props.handle })}</p>
        <Card>
          {props.publishable.map((p) => (
            <Toggle
              key={p.family}
              label={props.familyName(p.family)}
              description={`${shortAddress(p.address, 6)} · ${published.has(`${p.family}|${p.address}`) ? t("social.handle.published") : t("social.handle.notPublished")}`}
              checked={picked.has(p.family)}
              onChange={(on) => {
                setUnderstood(false);
                setPicked((s) => {
                  const n = new Set(s);
                  if (on) n.add(p.family);
                  else n.delete(p.family);
                  return n;
                });
              }}
            />
          ))}
        </Card>
        {adding && (
          <div className="clip-notice clip-notice--danger" role="alert">
            <IconAlert />
            <div>
              <strong>{t("social.handle.privacyTitle")}</strong>
              <p>
                {willPublish.length > 1
                  ? t("social.handle.privacyMany", { count: willPublish.length, handle: props.handle })
                  : t("social.handle.privacyOne", { handle: props.handle })}
              </p>
              <label className="clip-check">
                <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> {t("social.handle.understand")}
              </label>
            </div>
          </div>
        )}
        <Button block disabled={props.disabled || changes.length === 0 || (adding && !understood)} onClick={() => void props.onPublish(changes)}>
          {changes.length === 0 ? t("social.handle.noChanges") : t("social.handle.publish")}
        </Button>
      </section>

      <Card>
        <Toggle
          label={t("social.handle.reverse", { handle: props.handle })}
          description={t("social.handle.reverseHint")}
          checked={props.reverse}
          disabled={props.disabled}
          onChange={(on) => void props.onReverse(on)}
        />
      </Card>

      <Button
        block
        variant="danger"
        disabled={props.disabled}
        onClick={() => {
          if (typeof window !== "undefined" && window.confirm && !window.confirm(t("social.handle.confirmRelease", { handle: props.handle }))) return;
          void props.onRelease();
        }}
      >
        {t("social.handle.release", { handle: props.handle })}
      </Button>
    </>
  );
}
