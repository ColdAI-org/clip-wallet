import { useMemo, useState } from "react";
import type { Family } from "@clip-wallet/core";
import { useAsync, useRouter } from "../context";
import { Button, Empty, ErrorNote, Field, Screen, Spinner } from "../components";
import { shortAddress } from "../lib/format";
import { hueFor } from "../lib/media";
import { useUiT } from "../i18n";
import { familyLabel } from "../platform/client";
import type { ContactView } from "./client";
import { useSocial } from "./context";
import { socialErrorText } from "./errors";

export function ContactAvatar(props: { contact: Pick<ContactView, "name" | "initial">; size?: number }) {
  const size = props.size ?? 36;
  const hue = hueFor(props.contact.name);
  return (
    <span className="clip-contact-avatar" aria-hidden style={{ width: size, height: size, background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 30%)` }}>
      {props.contact.initial}
    </span>
  );
}

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

/** The address book: avatar initials, names, how many addresses; search filters as you type. */
export function Contacts() {
  const t = useUiT();
  const social = useSocial();
  const { navigate } = useRouter();
  const { data, error } = useAsync(() => social.contacts(), [social]);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const all = data?.contacts ?? [];
    const f = fold(q.trim().replace(/^@/, ""));
    if (!f) return all;
    return all.filter((c) => fold(c.name).includes(f) || c.handle?.startsWith(f) || c.addresses.some((a) => fold(a.address).startsWith(f) || fold(a.address).endsWith(f)));
  }, [data, q]);

  return (
    <Screen
      back
      title={t("social.contacts.title")}
      actions={
        <Button variant="ghost" onClick={() => navigate("/contacts/new")}>
          {t("social.contacts.add")}
        </Button>
      }
    >
      <ErrorNote message={error ? socialErrorText(error, t) : null} />
      {!data && !error && <Spinner />}
      {data && data.contacts.length === 0 && (
        <Empty title={t("social.contacts.empty")}>
          <p>{t("social.contacts.emptyHint")}</p>
          <Button onClick={() => navigate("/contacts/new")}>{t("social.contacts.add")}</Button>
        </Empty>
      )}
      {data && data.contacts.length > 0 && (
        <>
          <Field label={t("social.contacts.search")} placeholder={t("social.contacts.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" spellCheck={false} />
          {list.length === 0 && <p className="clip-hint">{t("social.contacts.noMatch", { query: q })}</p>}
          <ul className="clip-list" aria-label={t("social.contacts.title")}>
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" className="clip-asset-row" onClick={() => navigate(`/contacts/${encodeURIComponent(c.id)}`)}>
                  <ContactAvatar contact={c} />
                  <span className="clip-asset-row__main">
                    <span className="clip-asset-row__symbol">{c.name}</span>
                    <span className="clip-asset-row__name">
                      {c.handle ? `@${c.handle} · ` : ""}
                      {c.addresses.length === 1 ? shortAddress(c.addresses[0]!.address) : t("social.contacts.addresses", { count: c.addresses.length })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {data && !data.encrypted && <p className="clip-hint">{t("social.contacts.plain")}</p>}
    </Screen>
  );
}

/** Family names for an address-kind picker. */
export function useFamilyName() {
  const t = useUiT();
  return (f: Family) => familyLabel(f, t);
}

/** Used by Send: who to pay, from the address book, filtered to the asset's family. */
export function ContactSuggestions(props: { query: string; family?: Family; onPick: (address: string, name: string) => void }) {
  const t = useUiT();
  const social = useSocial();
  const { data } = useAsync(() => social.searchContacts({ query: props.query, ...(props.family ? { family: props.family } : {}) }), [social, props.query, props.family]);
  if (!data?.length) return null;
  return (
    <ul className="clip-contact-suggest" aria-label={t("social.pick.title")}>
      {data.map((m) => (
        <li key={`${m.contact.id}:${m.entry.address}`}>
          <button type="button" className="clip-asset-row" onClick={() => props.onPick(m.entry.address, m.contact.name)}>
            <ContactAvatar contact={m.contact} size={28} />
            <span className="clip-asset-row__main">
              <span className="clip-asset-row__symbol">{m.contact.name}</span>
              <span className="clip-asset-row__name">{m.entry.label ? `${m.entry.label} · ` : ""}{shortAddress(m.entry.address, 6)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
