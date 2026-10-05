/**
 * One browser per spec file for the picker matrix: the real build loaded as the only extension, the matrix wallet
 * imported once through onboarding (trace, screenshots and video stay off for it), then every picker page runs on
 * its own origin in the same browser. Also: the icon check and the results file.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { REAL_BUILD } from "../fixtures";
import { matrixPhrase, walletConnectProjectId } from "../matrix/env";
import { walletWithMatrixPhrase } from "../matrix/wallet";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PICKER_SHOTS = path.join(here, "../shots/pickers");
export const EXT = process.env.MATRIX_EXTENSION ? path.resolve(process.env.MATRIX_EXTENSION) : REAL_BUILD;
export const PHRASE_MISSING = "No DAPP_MATRIX_MNEMONIC: create .env.dapp-matrix (see docs/r1/dapp-matrix.md).";

export interface Walleted {
  context: BrowserContext;
  extensionId: string;
  /** The icon every connector announces (identity.icon), read from the page's EIP-6963 announcement. */
  icon: string;
}

export async function launchWithMatrixWallet(): Promise<Walleted> {
  const phrase = matrixPhrase();
  if (!phrase) throw new Error(PHRASE_MISSING);
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  const extensionId = new URL(sw.url()).host;
  const popup = await walletWithMatrixPhrase(context, extensionId, phrase);
  await popup.close();
  return { context, extensionId, icon: "" };
}

/** identity.icon as 1Mask announces it over EIP-6963 on `page` (an https page where 1Mask is injected). */
export async function announcedIcon(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const on = (e: Event) => {
          const d = (e as CustomEvent<{ info: { rdns: string; icon: string } }>).detail;
          if (d?.info?.rdns === "org.coldai.clipwallet") resolve(d.info.icon);
        };
        window.addEventListener("eip6963:announceProvider", on);
        window.dispatchEvent(new Event("eip6963:requestProvider"));
        setTimeout(() => resolve(""), 5000);
      }),
  );
}

export interface IconCheck {
  ok: boolean;
  loaded: boolean;
  /** The element's image source equals the icon the extension announces. */
  sameAsAnnounced: boolean;
  /** Share of the rendered icon's pixels in Clip orange (#FF3C00): the mark is an orange tile with a white clip. */
  orange: number;
  src: string;
  size: string;
}

/**
 * The icon in a picker entry: it has loaded (complete, natural size > 0), and it is the Clip icon: either its source
 * is exactly the announced data URI, or (pickers that re-host or re-encode icons) what is drawn on screen is the Clip
 * mark, judged by the share of Clip-orange pixels in a screenshot of the element.
 */
export async function checkIcon(context: BrowserContext, img: Locator, announced: string): Promise<IconCheck> {
  const present = await img.waitFor({ state: "attached", timeout: 10_000 }).then(() => true, () => false);
  if (!present) return { ok: false, loaded: false, sameAsAnnounced: false, orange: 0, src: "(no icon element in the entry)", size: "" };
  await img.scrollIntoViewIfNeeded().catch(() => undefined);
  const info = await img.evaluate(async (el) => {
    const i = el as HTMLImageElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "img" && !i.complete) await Promise.race([new Promise((r) => i.addEventListener("load", r, { once: true })), new Promise((r) => setTimeout(r, 5000))]);
    const box = el.getBoundingClientRect();
    const bg = getComputedStyle(el).backgroundImage;
    const src = tag === "img" ? i.currentSrc || i.src : tag === "image" ? (el.getAttribute("href") ?? "") : tag === "svg" ? "(inline svg)" : bg === "none" ? "" : bg.replace(/^url\(["']?|["']?\)$/g, "");
    const loaded = tag === "img" ? i.complete && i.naturalWidth > 0 : !!src && box.width > 0;
    return { src, loaded, size: tag === "img" ? `${i.naturalWidth}x${i.naturalHeight}` : `${box.width}x${box.height}` };
  });
  const png = await img.screenshot();
  const scratch = await context.newPage();
  const orange = await scratch.evaluate(async (b64) => {
    const im = new Image();
    im.src = `data:image/png;base64,${b64}`;
    await im.decode();
    const c = document.createElement("canvas");
    c.width = im.width;
    c.height = im.height;
    const x = c.getContext("2d")!;
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let hit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 215 && d[i + 1]! > 25 && d[i + 1]! < 110 && d[i + 2]! < 60) hit++;
    return hit / (d.length / 4);
  }, png.toString("base64"));
  await scratch.close();
  const sameAsAnnounced = !!announced && info.src === announced;
  return { ok: info.loaded && (sameAsAnnounced || orange > 0.25), loaded: info.loaded, sameAsAnnounced, orange: Math.round(orange * 100) / 100, src: info.src.length > 80 ? `${info.src.slice(0, 60)}…(${info.src.length} chars)` : info.src, size: info.size };
}

export type Status = "pass" | "fail" | "skip" | "n/a" | "expected-no";
export interface Row {
  id: string;
  ecosystem: string;
  picker: string;
  kind: "stock-ui" | "hosted-dapp";
  url?: string;
  listed?: Status;
  icon?: Status;
  connects?: Status;
  reconnect?: Status;
  reload?: Status;
  signed?: Status;
  notes: string[];
  detail?: Record<string, unknown>;
  shots: string[];
  at: string;
}

export function saveRow(file: string, r: Row) {
  mkdirSync(PICKER_SHOTS, { recursive: true });
  const p = path.join(PICKER_SHOTS, file);
  const all: Record<string, Row> = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
  all[r.id] = r;
  writeFileSync(p, `${JSON.stringify(all, null, 2)}\n`);
}

/** Why the Hedera WalletConnect picker can't run: no project id in .env.dapp-matrix, or a wallet built without it. */
export function walletConnectSkip(): string | null {
  const id = walletConnectProjectId();
  if (!id) return "WALLETCONNECT_PROJECT_ID is not set in .env.dapp-matrix: the Hedera DAppConnector / HashConnect path needs a real WalletConnect project id (then run `pnpm --filter @clip-wallet/extension pickers`, which builds the wallet with it).";
  const bundles = readdirSync(EXT, { recursive: true }).filter((f) => String(f).endsWith(".js"));
  const built = bundles.some((f) => readFileSync(path.join(EXT, String(f)), "utf8").includes(id));
  return built ? null : `This build (${EXT}) has WalletConnect off: rebuild with \`pnpm --filter @clip-wallet/extension pickers\` so CLIP_WALLETCONNECT_PROJECT_ID is set.`;
}
