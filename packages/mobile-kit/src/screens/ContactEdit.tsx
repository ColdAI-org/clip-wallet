/**
 * Add or edit a contact (same behaviour as packages/ui/src/social/ContactEdit.tsx). The kind of each address is
 * worked out from the address itself (social.detectFamily); only when several kinds accept it (a 0x address fits
 * Ethereum-style networks and Hedera) does the user pick.
 */
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import type { Family } from "@clip-wallet/core";
import type { ContactAddress } from "@clip-wallet/ui";
import { useWallet } from "../ui/context";
import { Button, Card, ErrorNote, Field, LinkButton, Notice, Screen, Spinner, T } from "../ui/kit";
import { useMobileT } from "../i18n";
import { socialErrorText } from "../lib/social-errors";
import { useFamilyName } from "./Contacts";

interface AddressRow {
  key: number;
  address: string;
  label: string;
  /** Families whose rules accept the address (from the background). */
  fits: Family[];
  family?: Family;
}

let rowKey = 0;
const row = (a?: Partial<ContactAddress>): AddressRow => ({ key: ++rowKey, address: a?.address ?? "", label: a?.label ?? "", fits: a?.family ? [a.family] : [], ...(a?.family ? { family: a.family } : {}) });

export function ContactEdit(props: { id?: string; address?: string; family?: Family }) {
  const { wallet, theme, back } = useWallet();
  const social = wallet.social;
  const t = useMobileT();
  const familyName = useFamilyName();
  const [loaded, setLoaded] = useState(!props.id);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<AddressRow[]>(() => [row(props.address ? { address: props.address, ...(props.family ? { family: props.family } : {}) } : undefined)]);
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

  const update = (key: number, patch: Partial<AddressRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function fillFromHandle() {
    setErr(null);
    setNote(null);
    try {
      const hit = await social.lookupHandle(handle);
      if (!hit) return setNote(t("m.social.edit.handleNone", { handle: handle.replace(/^@/, "") }));
      const fresh = (Object.entries(hit.byFamily) as [Family, string][]).filter(([f, a]) => !rows.some((r) => r.family === f && r.address === a));
      const kept = rows.filter((r) => r.address.trim());
      setRows([...kept, ...fresh.map(([family, address]) => row({ family, address }))]);
      setNote(`${t("m.social.edit.handleFilled", { count: fresh.length, handle: hit.handle })}${hit.recentlyRegistered ? ` ${t("m.social.edit.handleNew", { handle: hit.handle })}` : ""}`);
    } catch (e) {
      setErr(socialErrorText(e, t));
    }
  }

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const addresses = [];
      for (const r of rows.filter((x) => x.address.trim())) {
        // Saved before the field lost focus: work the kind out now (only when exactly one fits).
        const family = r.family ?? (r.fits.length ? undefined : await social.detectFamily(r.address.trim()).then((f) => (f.length === 1 ? f[0] : undefined), () => undefined));
        if (!family) throw Object.assign(new Error("family"), { code: "contacts/bad-address" });
        addresses.push({ family, address: r.address.trim(), ...(r.label.trim() ? { label: r.label.trim() } : {}) });
      }
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

  function remove() {
    const id = props.id;
    if (!id) return;
    Alert.alert(t("m.social.edit.delete"), t("m.social.edit.confirmDelete", { name }), [
      { text: t("m.common.cancel"), style: "cancel" },
      {
        text: t("m.social.edit.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await social.deleteContact(id);
            back();
          } catch (e) {
            setErr(socialErrorText(e, t));
          }
        },
      },
    ]);
  }

  if (!loaded) {
    return (
      <Screen back title={t("m.social.edit.editTitle")}>
        <Spinner />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={props.id ? t("m.social.edit.editTitle") : t("m.social.edit.newTitle")}
      footer={
        <>
          <ErrorNote message={err} />
          <Button block testID="contact-save" disabled={busy || !name.trim()} onPress={() => void save()}>
            {busy ? t("m.social.edit.saving") : t("m.social.edit.save")}
          </Button>
          {props.id && (
            <Button block variant="danger" testID="contact-delete" onPress={remove}>
              {t("m.social.edit.delete")}
            </Button>
          )}
        </>
      }
    >
      <Field label={t("m.social.edit.name")} value={name} onChangeText={setName} autoComplete="off" maxLength={64} testID="contact-name" />
      <Field
        label={t("m.social.edit.handle")}
        placeholder="@alex"
        value={handle}
        onChangeText={setHandle}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        testID="contact-handle"
        trailing={handle.replace(/^@/, "").trim().length >= 3 ? <LinkButton onPress={() => void fillFromHandle()}>{t("m.social.edit.handleFill")}</LinkButton> : undefined}
      />
      {note && <Notice level="info">{note}</Notice>}

      <View style={{ gap: 8 }}>
        <T v="h2">{t("m.social.edit.addresses")}</T>
        {rows.map((r, i) => (
          <Card key={r.key}>
            <Field
              label={t("m.social.edit.address", { n: i + 1 })}
              placeholder={t("m.social.edit.addressPlaceholder")}
              value={r.address}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              style={{ fontFamily: theme.mono, fontSize: 14 }}
              testID={`contact-address-${i}`}
              onChangeText={(v) => update(r.key, { address: v })}
              onBlur={() => void detect(r.key, r.address)}
              error={r.address.trim() && r.fits.length === 0 && r.family === undefined ? t("m.social.edit.kindUnknown") : null}
              hint={r.family && r.fits.length <= 1 ? familyName(r.family) : undefined}
            />
            {r.fits.length > 1 && (
              <View style={{ gap: 6 }}>
                <T v="label">{t("m.social.edit.kind")}</T>
                <View accessibilityRole="radiogroup" accessibilityLabel={t("m.social.edit.kind")} style={{ gap: 6 }}>
                  {r.fits.map((f) => {
                    const on = r.family === f;
                    return (
                      <Pressable
                        key={f}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        testID={`contact-family-${i}-${f}`}
                        onPress={() => update(r.key, { family: f })}
                        style={{ borderWidth: on ? 2 : 1, borderColor: on ? theme.c.accent : theme.c.border, borderRadius: theme.r.md, padding: 10 }}
                      >
                        <T style={{ fontWeight: on ? "600" : "400" }}>{familyName(f)}</T>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
            <Field label={t("m.social.edit.label")} placeholder={t("m.social.edit.labelPlaceholder")} value={r.label} maxLength={40} onChangeText={(v) => update(r.key, { label: v })} />
            {rows.length > 1 && (
              <Button variant="ghost" block accessibilityLabel={t("m.social.edit.removeAddress", { n: i + 1 })} onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                ✕
              </Button>
            )}
          </Card>
        ))}
        <Button variant="secondary" block disabled={rows.length >= 20} onPress={() => setRows((rs) => [...rs, row()])}>
          {t("m.social.edit.addAddress")}
        </Button>
      </View>

      <Field label={t("m.social.edit.notes")} value={notes} onChangeText={setNotes} multiline maxLength={500} style={{ minHeight: 72, textAlignVertical: "top" }} />
    </Screen>
  );
}
