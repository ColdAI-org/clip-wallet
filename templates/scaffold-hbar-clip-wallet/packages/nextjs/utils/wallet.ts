/**
 * The wallet this dapp is built to show off: the identity in the project's wallet.identity.json (written by
 * `pnpm wallet:identity`, read by clip.config.ts), so the dapp and the wallet always agree on the name and the
 * EIP-6963 rdns.
 */
import identity from "../../../wallet.identity.json";

export const WALLET_NAME: string = identity.name;
/** EIP-6963 reverse-DNS id the extension announces (also the wagmi connector id). */
export const WALLET_RDNS: string = identity.rdns;

export type Eip6963Detail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
};

/**
 * Ask every installed wallet to announce itself (EIP-6963) and resolve with this wallet's announcement, or null if it
 * didn't answer within `timeoutMs` (extension not installed, or disabled on this site).
 */
export function findWallet(timeoutMs = 1500): Promise<Eip6963Detail | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return new Promise(resolve => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (detail?.info?.rdns === WALLET_RDNS) {
        window.removeEventListener("eip6963:announceProvider", onAnnounce);
        resolve(detail);
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(null);
    }, timeoutMs);
  });
}
