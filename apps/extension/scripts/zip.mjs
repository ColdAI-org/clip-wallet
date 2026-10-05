/**
 * Deterministic ZIP writer (no dependencies). Same input tree → same bytes: entries sorted by path, one fixed
 * timestamp (SOURCE_DATE_EPOCH, clamped to the DOS epoch 1980-01-01), fixed permissions (0644), no extra fields,
 * no directory entries, DEFLATE at level 9 through Node's bundled zlib.
 *
 * Format: PKWARE APPNOTE.TXT 6.3.10 (https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), sections 4.3.7
 * (local file header), 4.3.12 (central directory header) and 4.3.16 (end of central directory record).
 *
 * The bytes depend on zlib's implementation: two builds on the same Node version and CPU architecture match
 * byte for byte (scripts/repro-check.sh). Across architectures compare `treeDigest` instead, which hashes the
 * unpacked files only.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

/** Every regular file under `dir`, as forward-slash paths relative to `dir`, sorted bytewise. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort((a, b) => (Buffer.from(a) < Buffer.from(b) ? -1 : Buffer.from(a) > Buffer.from(b) ? 1 : 0));
}

function dosDateTime(epochSeconds) {
  const d = new Date(Math.max(epochSeconds, 315532800) * 1000); // 1980-01-01T00:00:00Z
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

/**
 * @param {string} dir directory to pack
 * @param {{ epoch?: number }} [opts] timestamp for every entry (default SOURCE_DATE_EPOCH or 1980-01-01)
 * @returns {Buffer}
 */
export function zipDirectory(dir, opts = {}) {
  const epoch = opts.epoch ?? Number(process.env.SOURCE_DATE_EPOCH ?? 0);
  const { time, date } = dosDateTime(epoch);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const path of listFiles(dir)) {
    const data = readFileSync(join(dir, path));
    const name = Buffer.from(path, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = centrals.length / 2;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** SHA-256 over "<sha256(file)>  <path>\n" for every file, sorted: the content of a build, independent of zlib. */
export function treeDigest(dir) {
  const lines = listFiles(dir).map((p) => `${createHash("sha256").update(readFileSync(join(dir, p))).digest("hex")}  ${p}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}
