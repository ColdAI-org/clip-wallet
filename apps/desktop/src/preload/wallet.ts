/**
 * Preload of the wallet, approval and browser-toolbar windows (sandboxed, isolated world). It exposes one small,
 * typed bridge object; the renderer never gets ipcRenderer itself. Every call is checked again in the main
 * process (schema, then sender: ipc-guard.ts).
 */
import { contextBridge, ipcRenderer } from "electron";
import { CH, type ChromeCall, type ChromeState, type DesktopCall, type HidJob, type HidReply } from "../shared/ipc";

const api = {
  platform: process.platform,
  /** Wallet / features / social / security / hardware message → Envelope. */
  call: (msg: unknown): Promise<unknown> => ipcRenderer.invoke(CH.walletCall, msg),
  /** Desktop-only calls → Envelope. */
  desktop: (msg: DesktopCall): Promise<unknown> => ipcRenderer.invoke(CH.desktopCall, msg),
  onChange(cb: () => void): () => void {
    const h = () => cb();
    ipcRenderer.on(CH.walletChanged, h);
    return () => void ipcRenderer.removeListener(CH.walletChanged, h);
  },
  /** Ledger APDU jobs (the WebHID half of hid.ts). */
  onHidJob(handler: (job: HidJob) => Promise<HidReply>): void {
    ipcRenderer.on(CH.hidJob, (_e, job: HidJob) => {
      void handler(job).then(
        (r) => ipcRenderer.send(CH.hidReply, r),
        (e: unknown) => ipcRenderer.send(CH.hidReply, { id: job.id, ok: false, name: "Error", message: String((e as Error)?.message ?? e).slice(0, 500) }),
      );
    });
  },
  /** Browser toolbar only. */
  chrome: (msg: ChromeCall): Promise<unknown> => ipcRenderer.invoke(CH.chromeCall, msg),
  onChromeState(cb: (s: ChromeState) => void): () => void {
    const h = (_e: unknown, s: ChromeState) => cb(s);
    ipcRenderer.on(CH.chromeState, h);
    return () => void ipcRenderer.removeListener(CH.chromeState, h);
  },
};

export type ClipDesktopApi = typeof api;

contextBridge.exposeInMainWorld("clipDesktop", api);
