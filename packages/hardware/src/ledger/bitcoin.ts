/**
 * Ledger Bitcoin app 2.x (ledger-bitcoin, the app-bitcoin-new client). Signs whole PSBTs against a
 * standard single-sig wallet policy `wpkh(@0/**)` with key `[fingerprint/84'/coin'/account']xpub`,
 * which is exactly the vault's BIP-84 account (address i = .../0/i). Default policies need no
 * registration. Taproot (tr(@0/**)) is left for later: see README.
 */
import type Transport from "@ledgerhq/hw-transport";
import { AppClient, DefaultWalletPolicy } from "ledger-bitcoin";
import type { SignablePayload, Signature } from "@clip-wallet/core";
import { derToCompact, withDerivations } from "../bitcoin.js";
import { HardwareErrors } from "../errors.js";
import type { HardwareAccount } from "../types.js";
import { ecdsaSignature } from "../verify.js";

export async function btcMasterFingerprint(t: Transport): Promise<string> {
  return (await new AppClient(t).getMasterFingerprint()).toLowerCase();
}

export async function btcAccountXpub(t: Transport, accountPath: string): Promise<string> {
  return new AppClient(t).getExtendedPubkey(accountPath, false);
}

/** Signs the PSBT once; returns compact signatures by input index for this account's inputs. */
export async function btcSignPsbt(t: Transport, psbt: Uint8Array, account: HardwareAccount): Promise<Map<number, Uint8Array>> {
  const hw = account.hardware;
  if (!hw.accountXpub || !hw.accountPath) throw HardwareErrors.unknownAccount();
  const { bytes } = withDerivations(psbt, account);
  const policy = new DefaultWalletPolicy("wpkh(@0/**)", `[${hw.fingerprint}${hw.accountPath.replace(/^m/, "")}]${hw.accountXpub}`);
  const parts = await new AppClient(t).signPsbt(Buffer.from(bytes), policy, null);
  const out = new Map<number, Uint8Array>();
  for (const [index, part] of parts) {
    if (part.pubkey.toString("hex") !== account.publicKey.toLowerCase()) continue;
    out.set(index, derToCompact(new Uint8Array(part.signature)));
  }
  return out;
}

/** BIP-137 message signature (the app's SIGN_MESSAGE). Returns a signature over the approved digest. */
export async function btcSignMessage(t: Transport, path: string, payload: SignablePayload, publicKey: string): Promise<Signature> {
  if (payload.raw?.format !== "bitcoin-message") throw HardwareErrors.needsDeviceView("this Bitcoin message");
  const b64 = await new AppClient(t).signMessage(Buffer.from(payload.raw.bytes), path);
  const sig = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (sig.length !== 65) throw HardwareErrors.badSignature("message signature length");
  return ecdsaSignature(sig.subarray(1), payload.bytes, publicKey);
}
