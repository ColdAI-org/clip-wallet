/**
 * The wallet side shared by the dapp matrix (matrix.spec.ts) and the picker matrix (pickers.spec.ts,
 * hosted-dapps.spec.ts): import the matrix wallet, find approval windows and answer them.
 */
import type { BrowserContext } from "@playwright/test";
import { importWallet, openPage } from "../fixtures";

export const approvalPages = (context: BrowserContext) => context.pages().filter((p) => !p.isClosed() && p.url().includes("/approval.html"));

/** Clicks `button` in the approval window that offers it (polls: the previous window may still be closing). */
export async function answer(context: BrowserContext, button: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of approvalPages(context)) {
      try {
        const b = w.getByRole("button", { name: button, exact: true });
        if ((await b.count()) > 0 && (await b.isEnabled())) {
          await b.click({ timeout: 5_000 });
          return;
        }
      } catch {
        /* closed under us */
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No approval window offered "${button}"`);
}

/** Imports the matrix phrase through onboarding. Callers keep trace, screenshots and video off while it runs. */
export async function walletWithMatrixPhrase(context: BrowserContext, extensionId: string, phrase: string) {
  const page = await openPage(context, extensionId, "popup.html");
  await importWallet(page, phrase);
  return page;
}
