// Fuel: Clip announces a FuelConnector with the "FuelConnector" window event, so fuels-ts `new Fuel()` lists it.
// It is also at window.clipwallet.fuel, for `new Fuel({ connectors: [window.clipwallet.fuel] })`.
interface FuelConnectorLike {
  name: string;
  connect(): Promise<boolean>;
  accounts(): Promise<string[]>;
  signMessage(address: string, message: string): Promise<string>;
}

export async function connectFuel() {
  const fuel = (window as unknown as { clipwallet?: { fuel?: FuelConnectorLike } }).clipwallet?.fuel;
  if (!fuel) throw new Error("Clip Wallet isn't installed in this browser.");
  await fuel.connect();
  const [address] = await fuel.accounts(); // a 0x… b256 address
  const signature = await fuel.signMessage(address!, "Sign in to example.app"); // Signer.recoverAddress(hashMessage(…))
  return { address, signature };
}
