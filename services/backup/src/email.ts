/**
 * Pluggable email delivery. The deployed default refuses to send (503), so nobody can sign in until an
 * operator sets RESEND_API_KEY + EMAIL_FROM (src/index.ts picks ResendEmailSender) or passes another sender to
 * createApp(). The message carries only the sign-in link.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

export class EmailUnavailableError extends Error {}

/** Default: no provider configured. */
export class UnconfiguredEmailSender implements EmailSender {
  async send(): Promise<void> {
    throw new EmailUnavailableError("No email provider is configured for this deployment.");
  }
}

/**
 * Resend (https://resend.com/docs/api-reference/emails/send-email): POST https://api.resend.com/emails with
 * `Authorization: Bearer <key>` and { from, to, subject, text }; 200 { id } on success. `from` must be on a domain
 * verified in Resend. Any non-2xx is reported as a send failure (502) without echoing the provider's body.
 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  async send(msg: EmailMessage): Promise<void> {
    const res = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Resend answered ${res.status}`);
  }
}

/** Test/dev sender: keeps messages in memory (never use in production: it would hold live sign-in links). */
export class MemoryEmailSender implements EmailSender {
  readonly outbox: EmailMessage[] = [];
  async send(msg: EmailMessage): Promise<void> {
    this.outbox.push(msg);
  }
}

export function signInEmail(to: string, link: string, walletName = "Clip Wallet"): EmailMessage {
  return {
    to,
    subject: `Sign in to ${walletName} backups`,
    text: [
      `Someone (hopefully you) asked to sign in to ${walletName} backups with this email address.`,
      "",
      "Open this link on the same device, or paste it into the wallet. It works once, for 15 minutes:",
      link,
      "",
      "If you didn't ask for this, ignore this email. Nobody can use the link without the device that asked for it.",
      `${walletName} will never ask you for your recovery phrase by email.`,
    ].join("\n"),
  };
}
