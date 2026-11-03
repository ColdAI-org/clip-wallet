/** "Ethereum-style (ETH, USDC, Base, Arbitrum…)", in the user's language; bare network names stay as they are. */
import type { Family } from "@coldai/clip-wallet-core";
import { FAMILY_LABEL } from "@coldai/clip-wallet-ui";
import type { MobileMessageId } from "../i18n";

const IDS: Partial<Record<Family, MobileMessageId>> = {
  evm: "m.accounts.family.evm",
  hedera: "m.accounts.family.hedera",
  solana: "m.accounts.family.solana",
  bitcoin: "m.accounts.family.bitcoin",
};

export function familyLabel(f: Family, t: (id: MobileMessageId) => string): string {
  const id = IDS[f];
  return id ? t(id) : (FAMILY_LABEL[f] ?? f);
}
