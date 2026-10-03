import type { Family } from "@clip-wallet/core";
import { useAsync } from "../context";
import { IconAlert } from "../components/icons";
import { useUiT } from "../i18n";
import { ContactAvatar } from "./Contacts";
import { useSocialOptional } from "./context";

/**
 * On a send approval: "Sending to Alex" when the recipient is a saved contact, or a danger notice when it looks
 * like a contact's address but isn't (address poisoning: same first and last characters, different middle).
 */
export function RecipientCheck(props: { address: string; family: Family }) {
  const t = useUiT();
  const social = useSocialOptional();
  const { data } = useAsync(async () => (social ? social.checkAddress({ address: props.address, family: props.family }) : null), [social, props.address, props.family]);
  if (!data) return null;
  if (data.contact) {
    const c = data.contact;
    return (
      <div className="clip-recipient" data-testid="recipient-contact">
        <ContactAvatar contact={c.contact} size={28} />
        <span>
          {t("social.recipient.contact", { name: c.contact.name })}
          {c.entry.label ? <span className="clip-hint"> · {c.entry.label}</span> : null}
        </span>
      </div>
    );
  }
  const l = data.lookalikes[0];
  if (!l) return null;
  return (
    <div className="clip-notice clip-notice--danger" role="alert" data-testid="recipient-lookalike">
      <IconAlert />
      <div>
        <strong>{t("social.recipient.lookalikeTitle")}</strong>
        <p>{t("social.recipient.lookalike", { name: l.contact.name })}</p>
        <p className="clip-mono">{t("social.recipient.saved", { address: l.entry.address })}</p>
        <p className="clip-mono">{t("social.recipient.this", { address: props.address })}</p>
      </div>
    </div>
  );
}
