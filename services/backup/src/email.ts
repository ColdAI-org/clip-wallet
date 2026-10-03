/**
 * Pluggable email delivery. No provider is wired: the deployed default refuses to send (503), so nobody can
 * sign in until an operator plugs in a real sender (Cloudflare Email Service, SES, Postmark, …) by passing it
 * to createApp(). The message carries only the sign-in link.
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
