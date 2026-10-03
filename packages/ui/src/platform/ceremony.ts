import { PasskeyError, b64urlDecode, b64urlEncode, type CeremonyClient, type PasskeyCeremony, type PasskeyPrfFactory } from "../lib/passkey";

/**
 * Like runPasskeyCeremony, but the ceremony comes from any begin call (passkeyBackupBegin /
 * passkeyRestoreBegin). The page runs WebAuthn; only the PRF output goes back via passkeyFinish, and the
 * background (vault) finishes the backup or restore before passkeyFinish resolves.
 */
export async function runCeremony(client: Pick<CeremonyClient, "passkeyFinish">, factory: PasskeyPrfFactory, begin: () => Promise<PasskeyCeremony>): Promise<void> {
  const c = await begin();
  const prf = factory.create(c);
  let credentialId: string;
  let prfOutput: Uint8Array;
  try {
    if (c.op === "enroll") {
      const r = await prf.enroll(b64urlDecode(c.prfInput));
      credentialId = b64urlEncode(r.credentialId);
      prfOutput = r.prfOutput;
    } else {
      if (!c.credentialId) throw new PasskeyError("We couldn't tell which passkey made this backup.", "unsupported");
      credentialId = c.credentialId;
      prfOutput = await prf.evaluate(b64urlDecode(c.credentialId), b64urlDecode(c.prfInput));
    }
  } catch (e) {
    await client.passkeyFinish({ id: c.id, error: e instanceof PasskeyError ? e.code : "failed" }).catch(() => undefined);
    throw e;
  }
  const encoded = b64urlEncode(prfOutput);
  prfOutput.fill(0);
  await client.passkeyFinish({ id: c.id, credentialId, prfOutput: encoded });
}
