// Names to addresses: ENS, SNS, Hedera names, Clip handles, and names a Clip Plugin resolves. Read-only.
import { createNameResolver, looksLikeName } from "@clip-wallet/names";

const resolver = createNameResolver();

export async function recipientFor(input: string) {
  if (!looksLikeName(input)) return { address: input };
  const hit = await resolver.resolve(input); // null when nothing is found
  if (!hit) throw new Error(`We couldn't find ${input}.`);
  // `networkIds` narrows Send's "Where should it arrive?" question to the networks the name points at.
  return { address: hit.address, family: hit.family, networkIds: hit.networkIds };
}
