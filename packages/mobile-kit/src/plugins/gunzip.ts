/// <reference path="./pako.d.ts" />
/**
 * gunzip for plugin installs on React Native: Hermes has no DecompressionStream, so @clip-wallet/plugins takes this
 * through `NpmOptions.gunzip`. pako 2.2.0 `Inflate` (windowBits 16+15 = gzip wrapper), stopping as soon as the
 * output passes `maxBytes` (a 5 MB tarball could otherwise inflate to gigabytes).
 */
import { Inflate } from "pako";
import { InstallError } from "@clip-wallet/plugins";

export function gunzipCapped(bytes: Uint8Array, maxBytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const inf = new Inflate({ windowBits: 16 + 15 });
  inf.onData = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > maxBytes) throw new InstallError("too-large", "That plugin is too large.");
    parts.push(chunk.slice());
  };
  inf.push(bytes, true);
  if (inf.err || !inf.ended) throw new InstallError("bad-package", "That plugin package is damaged.");
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
