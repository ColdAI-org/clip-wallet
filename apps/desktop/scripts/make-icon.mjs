// Renders icon.svg to build/icon.png (1024×1024, transparent corners) with the bundled Electron, for electron-builder
// (it derives .icns / .ico / Linux sizes from it). Run: node_modules/.bin/electron scripts/make-icon.mjs
import { app, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "icon.svg"), "utf8").replace('width="128" height="128"', 'width="1024" height="1024"');
// macOS icons sit in an 824px rounded square inside the 1024 canvas (Apple HIG grid); other platforms use it as is.
const html = `<html><body style="margin:0;background:transparent;width:1024px;height:1024px;display:grid;place-items:center">
<div style="width:824px;height:824px">${svg.replace('width="1024" height="1024"', 'width="824" height="824"')}</div></body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  mkdirSync(join(root, "build"), { recursive: true });
  writeFileSync(join(root, "build/icon.png"), img.resize({ width: 1024, height: 1024 }).toPNG());
  app.quit();
});
