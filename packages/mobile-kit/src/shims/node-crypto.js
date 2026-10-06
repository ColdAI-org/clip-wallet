// Stand-in for Node's `crypto`, which `hdkey` (via @keystonehq/bc-ur-registry-eth, pulled in by the Keystone
// SDK) requires at load time. The wallet's Keystone code derives public keys itself (@clip-wallet/hardware's
// bip32pub), so this is only here so Metro can bundle; the few calls hdkey can make are backed by @noble/hashes
// so they give correct answers instead of crashing. Public-key math only: nothing here sees a private key.
const { sha256, sha512 } = require("@noble/hashes/sha2.js");
const { ripemd160 } = require("@noble/hashes/legacy.js");
const { hmac } = require("@noble/hashes/hmac.js");

const HASHES = { sha256, sha512, rmd160: ripemd160, ripemd160 };

function pick(name) {
  const h = HASHES[String(name).toLowerCase()];
  if (!h) throw new Error(`crypto: ${name} is not available in this app`);
  return h;
}

function bytes(data, enc) {
  if (typeof data === "string") return Uint8Array.from(Buffer.from(data, enc || "utf8"));
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function digester(run) {
  const parts = [];
  const self = {
    update(data, enc) {
      parts.push(bytes(data, enc));
      return self;
    },
    digest(enc) {
      const all = Buffer.concat(parts.map((p) => Buffer.from(p)));
      const out = Buffer.from(run(Uint8Array.from(all)));
      return enc ? out.toString(enc) : out;
    },
  };
  return self;
}

module.exports = {
  createHash: (name) => digester((m) => pick(name)(m)),
  createHmac: (name, key) => digester((m) => hmac(pick(name), bytes(key), m)),
  randomBytes: (n) => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))),
};
