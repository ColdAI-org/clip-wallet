import { userMessageOf } from "../client";
import type { UiMessageId } from "../i18n";

/** Background error codes this stream knows, shown in the user's language (others fall back to the English userMessage). */
const BY_CODE: Record<string, UiMessageId> = {
  "contacts/name": "social.err.name",
  "contacts/no-address": "social.err.noAddress",
  "contacts/bad-address": "social.err.badAddress",
  "contacts/address-taken": "social.err.addressTaken",
  "contacts/duplicate-name": "social.err.duplicateName",
  "contacts/family": "social.err.family",
  "contacts/full": "social.err.full",
  "contacts/unreadable": "social.err.unreadable",
  "handles/invalid": "social.handle.rules",
  "handles/taken": "social.err.handleTaken",
  "handles/not-yours": "social.err.notYours",
  "names/clip-off": "social.handle.off",
  "names/clip-unavailable": "social.err.handleUnreachable",
  "hedera/account-not-created": "social.handle.needHedera",
  "alerts/asset": "social.err.alertAsset",
};

export function socialErrorText(e: unknown, t: (id: UiMessageId) => string): string {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  const id = BY_CODE[code];
  return id ? t(id) : userMessageOf(e);
}
