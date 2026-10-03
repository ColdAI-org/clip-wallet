import { useEffect, useRef, useState } from "react";
import type { Family } from "@clip-wallet/core";
import { useRouter } from "../context";
import { Button, ErrorNote, Field, Screen, Spinner } from "../components";
import { useUiT } from "../i18n";
import type { ContactAddress } from "./client";
import { useSocial } from "./context";
import { socialErrorText } from "./errors";
import { useFamilyName } from "./Contacts";

interface Row {
  key: number;
  address: string;
  label: string;
  /** Families whose rules accept the address (from the background). */
  fits: Family[];
  family?: Family;
}

let rowKey = 0;
const row = (a?: Partial<ContactAddress>): Row => ({ key: ++rowKey, address: a?.address ?? "", label: a?.label ?? "", fits: a?.family ? [a.family] : [], ...(a?.family ? { family: a.family } : {}) });

/**
 * Add or edit a contact. The kind of each address is worked out from the address itself; only when several
 * kinds accept it (a 0x address fits Ethereum-style networks and Hedera) does the user pick.
 */
export function ContactEdit(props: { id?: string; prefill?: { address?: string; family?: Family; name?: string } }) {
  const t = useUiT();
  const social = useSocial();
  const { navigate, back } = useRouter();
  const familyName = useFamilyName();
  const [loaded, setLoaded] = useState(!props.id);
  const [name, setName] = useState(props.prefill?.name ?? "");
  const [handle, setHandle] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [row(props.prefill?.address ? { address: props.prefill.address, ...(props.prefill.family ? { family: props.prefill.family } : {}) } : undefined)]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const detectSeq = useRef(0);

  useEffect(() => {
    if (!props.id) return;
    let live = true;
    void social.contacts().then(
      (v) => {
        if (!live) return;
        const c = v.contacts.find((x) => x.id === props.id);
        if (c) {
          setName(c.name);
          setHandle(c.handle ? `@${c.handle}` : "");
          setNotes(c.notes ?? "");
          setRows(c.addresses.map((a) => row(a)));
        }
        setLoaded(true);
      },
      (e) => live && (setErr(socialErrorText(e, t)), setLoaded(true)),
    );
    return () => {
      live = false;
    };
  }, [social, props.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Work out the kind of a prefilled address once.
  useEffect(() => {
    const r = rows[0];
    if (r && r.address && !r.fits.length) void detect(r.key, r.address);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function detect(key: number, address: string) {
    const seq = ++detectSeq.current;
    const fits = address.trim() ? await social.detectFamily(address.trim()).catch(() => [] as Family[]) : [];
    if (seq !== detectSeq.current && fits.length === 0) return;
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, fits, ...(r.family && fits.includes(r.family) ? {} : fits.length === 1 ? { family: fits[0]! } : { family: undefined }) } : r)));
  }

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function fillFromHandle() {
    setErr(null);
    setNote(null);
    try {
      const hit = await social.lookupHandle(handle);
      if (!hit) return setNote(t("social.edit.handleNone", { handle: handle.replace(/^@/, "") }));
      const fresh = (Object.entries(hit.byFamily) as [Family, string][]).filter(([f, a]) => !rows.some((r) => r.family === f && r.address === a));
      const kept = rows.filter((r) => r.address.trim());
      setRows([...kept, ...fresh.map(([family, address]) => row({ family, address }))]);
      setNote(
        `${t("social.edit.handleFilled", { count: fresh.length, handle: hit.handle })}${hit.recentlyRegistered ? ` ${t("social.edit.handleNew", { handle: hit.handle })}` : ""}`,
      );
    } catch (e) {
      setErr(socialErrorText(e, t));
    }
  }

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const addresses = rows
        .filter((r) => r.address.trim())
        .map((r) => {
          if (!r.family) throw Object.assign(new Error("family"), { code: "contacts/bad-address" });
          return { family: r.family, address: r.address.trim(), ...(r.label.trim() ? { label: r.label.trim() } : {}) };
        });
      await social.saveContact({
        ...(props.id ? { id: props.id } : {}),
        input: { name, addresses, ...(notes.trim() ? { notes } : {}), ...(handle.trim() ? { handle: handle.trim() } : {}) },
      });
      back();
    } catch (e) {
      setErr(socialErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!props.id) return;
    if (typeof window !== "undefined" && window.confirm && !window.confirm(t("social.edit.confirmDelete", { name }))) return;
    try {
      await social.deleteContact(props.id);
      navigate("/contacts", { replace: true });
    } catch (e) {
      setErr(socialErrorText(e, t));
    }
  }

  if (!loaded) {
    return (
      <Screen back title={t("social.edit.editTitle")}>
        <Spinner />
      </Screen>
    );
  }

  return (
    <Screen back title={props.id ? t("social.edit.editTitle") : t("social.edit.newTitle")}>
      <form
        className="clip-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t("social.edit.name")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={64} />
        <Field
          label={t("social.edit.handle")}
          placeholder="@alex"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          trailing={
            handle.replace(/^@/, "").trim().length >= 3 ? (
              <button type="button" className="clip-link" onClick={() => void fillFromHandle()}>
                {t("social.edit.handleFill")}
              </button>
            ) : undefined
          }
        />
        {note && <p className="clip-notice clip-notice--info">{note}</p>}

        <fieldset className="clip-contact-addresses">
          <legend className="clip-h2">{t("social.edit.addresses")}</legend>
          {rows.map((r, i) => (
            <div key={r.key} className="clip-contact-address">
              <Field
                label={t("social.edit.address", { n: i + 1 })}
                placeholder={t("social.edit.addressPlaceholder")}
                value={r.address}
                autoComplete="off"
                spellCheck={false}
                className="clip-mono"
                onChange={(e) => update(r.key, { address: e.target.value })}
                onBlur={() => void detect(r.key, r.address)}
                error={r.address.trim() && r.fits.length === 0 && r.family === undefined ? t("social.edit.kindUnknown") : null}
                hint={r.family && r.fits.length <= 1 ? familyName(r.family) : undefined}
              />
              {r.fits.length > 1 && (
                <label className="clip-select-row">
                  <span>{t("social.edit.kind")}</span>
                  <select className="clip-select" value={r.family ?? ""} onChange={(e) => update(r.key, { family: e.target.value as Family })}>
                    <option value="" disabled>
                      —
                    </option>
                    {r.fits.map((f) => (
                      <option key={f} value={f}>
                        {familyName(f)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Field label={t("social.edit.label")} placeholder={t("social.edit.labelPlaceholder")} value={r.label} maxLength={40} onChange={(e) => update(r.key, { label: e.target.value })} />
              {rows.length > 1 && (
                <button type="button" className="clip-link" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={t("social.edit.removeAddress", { n: i + 1 })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <Button variant="ghost" onClick={() => setRows((rs) => [...rs, row()])} disabled={rows.length >= 20}>
            {t("social.edit.addAddress")}
          </Button>
        </fieldset>

        <label className="clip-field">
          <span className="clip-field__label">{t("social.edit.notes")}</span>
          <textarea className="clip-input" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <ErrorNote message={err} />
        <Button block type="submit" disabled={busy || !name.trim()}>
          {busy ? t("social.edit.saving") : t("social.edit.save")}
        </Button>
        {props.id && (
          <Button block variant="danger" onClick={() => void remove()}>
            {t("social.edit.delete")}
          </Button>
        )}
      </form>
    </Screen>
  );
}
