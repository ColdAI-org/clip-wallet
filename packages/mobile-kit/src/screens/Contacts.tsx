/**
 * The address book (same behaviour as packages/ui/src/social/Contacts.tsx): avatar initials, names, how many
 * addresses; search filters as you type. Also the pieces Send and the approval sheet reuse: ContactAvatar,
 * ContactSuggestions and the plain-words family names.
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { Family } from "@clip-wallet/core";
import { FAMILY_LABEL, hueFor, shortAddress, type ContactView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Empty, ErrorNote, Field, Screen, Spinner, T } from "../ui/kit";
import { useMobileT, type MobileMessageId } from "../i18n";
import { socialErrorText } from "../lib/social-errors";

export function ContactAvatar(props: { contact: Pick<ContactView, "name" | "initial">; size?: number }) {
  const size = props.size ?? 36;
  const hue = hueFor(props.contact.name);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue}, 70%, 92%)`, alignItems: "center", justifyContent: "center" }}>
      <T color={`hsl(${hue}, 55%, 30%)`} style={{ fontWeight: "700", fontSize: size * 0.42 }}>
        {props.contact.initial}
      </T>
    </View>
  );
}

const FAMILY_ID: Partial<Record<Family, MobileMessageId>> = {
  evm: "m.social.family.evm",
  hedera: "m.social.family.hedera",
  solana: "m.social.family.solana",
  bitcoin: "m.social.family.bitcoin",
};

/** A family's plain-words name (bare network names stay untranslated). */
export function useFamilyName() {
  const t = useMobileT();
  return (f: Family) => {
    const id = FAMILY_ID[f];
    return id ? t(id) : (FAMILY_LABEL[f] ?? f);
  };
}

function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
}

export function Contacts() {
  const { wallet, navigate } = useWallet();
  const t = useMobileT();
  const { data, error } = useAsync(() => wallet.social.contacts(), [wallet]);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const all = data?.contacts ?? [];
    const f = fold(q.trim().replace(/^@/, ""));
    if (!f) return all;
    return all.filter((c) => fold(c.name).includes(f) || c.handle?.startsWith(f) || c.addresses.some((a) => fold(a.address).startsWith(f) || fold(a.address).endsWith(f)));
  }, [data, q]);
  const add = () => navigate({ name: "contact" });

  return (
    <Screen
      back
      title={t("m.social.contacts.title")}
      actions={
        <Button variant="ghost" style={{ flex: 0, paddingHorizontal: 10 }} onPress={add} testID="contact-add">
          {t("m.social.contacts.add")}
        </Button>
      }
    >
      <ErrorNote message={error ? socialErrorText(error, t) : null} />
      {!data && !error && <Spinner />}
      {data && data.contacts.length === 0 && (
        <>
          <Empty title={t("m.social.contacts.empty")}>{t("m.social.contacts.emptyHint")}</Empty>
          <Button block onPress={add}>
            {t("m.social.contacts.add")}
          </Button>
        </>
      )}
      {data && data.contacts.length > 0 && (
        <>
          <Field label={t("m.social.contacts.search")} placeholder={t("m.social.contacts.searchPlaceholder")} value={q} onChangeText={setQ} autoCapitalize="none" autoComplete="off" spellCheck={false} testID="contact-search" />
          {list.length === 0 && <T v="hint">{t("m.social.contacts.noMatch", { query: q })}</T>}
          {list.length > 0 && (
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {list.map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  testID={`contact-${c.id}`}
                  onPress={() => navigate({ name: "contact", id: c.id })}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}
                >
                  <ContactAvatar contact={c} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T style={{ fontWeight: "600" }}>{c.name}</T>
                    <T v="hint" numberOfLines={1}>
                      {`${c.handle ? `@${c.handle} · ` : ""}${c.addresses.length === 1 ? shortAddress(c.addresses[0]!.address) : t("m.social.contacts.addresses", { count: c.addresses.length })}`}
                    </T>
                  </View>
                </Pressable>
              ))}
            </Card>
          )}
        </>
      )}
      {data && !data.encrypted && <T v="hint">{t("m.social.contacts.plain")}</T>}
    </Screen>
  );
}

/** Used by Send: who to pay, from the address book, filtered to the asset's family. */
export function ContactSuggestions(props: { query: string; family?: Family; onPick: (address: string, name: string) => void }) {
  const { wallet, theme } = useWallet();
  const t = useMobileT();
  const { data } = useAsync(() => wallet.social.searchContacts({ query: props.query, ...(props.family ? { family: props.family } : {}) }), [wallet, props.query, props.family]);
  if (!data?.length) return null;
  return (
    <View accessibilityLabel={t("m.social.pick.title")} style={{ backgroundColor: theme.c.surface, borderRadius: theme.r.md, borderWidth: 1, borderColor: theme.c.border, paddingHorizontal: 12, paddingVertical: 4 }}>
      {data.map((m) => (
        <Pressable
          key={`${m.contact.id}:${m.entry.address}`}
          accessibilityRole="button"
          testID={`suggest-${m.contact.id}`}
          onPress={() => props.onPick(m.entry.address, m.contact.name)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}
        >
          <ContactAvatar contact={m.contact} size={28} />
          <View style={{ flex: 1, gap: 2 }}>
            <T style={{ fontWeight: "600" }}>{m.contact.name}</T>
            <T v="hint" numberOfLines={1}>{`${m.entry.label ? `${m.entry.label} · ` : ""}${shortAddress(m.entry.address, 6)}`}</T>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
