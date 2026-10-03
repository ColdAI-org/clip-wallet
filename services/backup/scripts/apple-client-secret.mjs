#!/usr/bin/env node
/**
 * Mints the Sign in with Apple client secret (an ES256 JWT, valid at most 6 months) from the .p8 key you
 * downloaded from Apple, and writes it to STDOUT only, so it can be piped straight into wrangler:
 *
 *   node scripts/apple-client-secret.mjs --key ./AuthKey_ABC123DEFG.p8 --key-id ABC123DEFG --team-id TEAM123456 \
 *     --client-id org.example.clip.backup | npx wrangler secret put APPLE_CLIENT_SECRET
 *
 * Claims per https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret:
 * header { alg: ES256, kid }, payload { iss: team id, iat, exp ≤ iat + 15777000, aud: https://appleid.apple.com,
 * sub: client id }. The .p8 never leaves your machine and is never sent to the Worker. Re-run before `exp`.
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
for (const k of ["key", "key-id", "team-id", "client-id"]) {
  if (!args[k]) {
    process.stderr.write(`missing --${k}\n`);
    process.exit(2);
  }
}
const days = Math.min(Number(args.days ?? 180), 182);
const b64u = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const iat = Math.floor(Date.now() / 1000);
const exp = Math.min(iat + days * 86400, iat + 15777000);
const input = `${b64u({ alg: "ES256", kid: args["key-id"] })}.${b64u({ iss: args["team-id"], iat, exp, aud: "https://appleid.apple.com", sub: args["client-id"] })}`;
const key = createPrivateKey(readFileSync(args.key));
const sig = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
process.stdout.write(`${input}.${sig.toString("base64url")}`);
process.stderr.write(`Apple client secret expires ${new Date(exp * 1000).toISOString().slice(0, 10)}; re-run before then.\n`);
