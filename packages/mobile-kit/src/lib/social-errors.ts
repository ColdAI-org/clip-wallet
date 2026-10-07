/** Background error codes from the social stream, shown in the user's language (others: the English userMessage). */
import { userMessageOf } from "@clip-wallet/ui";
import type { MobileMessageId } from "../i18n";

const BY_CODE: Record<string, MobileMessageId> = {
  "contacts/name": "m.social.err.name",
  "contacts/no-address": "m.social.err.noAddress",
  "contacts/bad-address": "m.social.err.badAddress",
  "contacts/address-taken": "m.social.err.addressTaken",
  "contacts/duplicate-name": "m.social.err.duplicateName",
  "contacts/family": "m.social.err.family",
  "contacts/full": "m.social.err.full",
  "contacts/unreadable": "m.social.err.unreadable",
  "handles/invalid": "m.social.err.handleRules",
  "handles/taken": "m.social.err.handleTaken",
  "handles/not-yours": "m.social.err.notYours",
  "names/clip-off": "m.social.err.handleOff",
  "names/clip-unavailable": "m.social.err.handleUnreachable",
  "hedera/account-not-created": "m.social.err.needHedera",
  "alerts/asset": "m.social.err.alertAsset",
};

export function socialErrorText(e: unknown, t: (id: MobileMessageId) => string): string {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  const id = BY_CODE[code];
  return id ? t(id) : userMessageOf(e);
}
