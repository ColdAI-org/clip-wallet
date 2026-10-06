// Tezos: Beacon finds Clip Wallet by its postMessage ping. See the guide for the listing caveat.
import { DAppClient, NetworkType } from "@airgap/beacon-dapp";

export const client = new DAppClient({ name: "Example app", network: { type: NetworkType.SHADOWNET } });

export async function connectTezos() {
  const permissions = await client.requestPermissions(); // Beacon's pairing modal
  return permissions.address; // tz1…
}
