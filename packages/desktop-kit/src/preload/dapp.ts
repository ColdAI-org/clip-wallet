/**
 * Preload of every dapp tab (sandboxed, isolated world; the page cannot see this script or anything it holds).
 *
 *   1. Asks the main process for the 1Mask boot config. The main process answers only for the top frame of a
 *      dapp tab on an http(s) origin; preloads don't run in iframes at all (no nodeIntegrationInSubFrames).
 *   2. Runs the 1Mask inpage providers in the page's MAIN world, synchronously, before any page script.
 *   3. Runs 1Mask's content bridge here, in the ISOLATED world: it accepts only same-window postMessages on the
 *      run's channel that pass the strict schema, and relays them to the main process over IPC. The main process
 *      replaces the origin with the frame's committed origin (onemask-relay.ts).
 *
 * Nothing is exposed to the page: no contextBridge.exposeInMainWorld, so window.require, ipcRenderer, process and
 * electron stay out of its reach.
 *
 * @module
 */
import { contextBridge, ipcRenderer } from "electron";
import { createContentBridge, type RuntimePort } from "@clip-wallet/1mask/content";
import { CH, type OneMaskBoot } from "../shared/ipc";
import { inpageMain } from "./inpage.generated";

function start() {
  if (location.protocol !== "https:" && location.protocol !== "http:") return;
  let boot: OneMaskBoot | null = null;
  try {
    boot = ipcRenderer.sendSync(CH.onemaskBoot) as OneMaskBoot | null;
  } catch {
    boot = null;
  }
  if (!boot || typeof boot.channel !== "string") return;

  contextBridge.executeInMainWorld({ func: inpageMain, args: [boot] });

  const messageListeners = new Set<(m: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  ipcRenderer.on(CH.onemaskToPage, (_e, msg: unknown) => {
    for (const l of messageListeners) l(msg);
  });
  const port: RuntimePort = {
    postMessage: (message) => ipcRenderer.send(CH.onemaskToMain, message),
    onMessage: { addListener: (cb) => void messageListeners.add(cb) },
    onDisconnect: { addListener: (cb) => void disconnectListeners.add(cb) },
    disconnect: () => undefined,
  };
  createContentBridge({ channel: boot.channel, connect: () => port });
}

start();
