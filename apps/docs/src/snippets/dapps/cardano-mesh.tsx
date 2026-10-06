// Mesh's CardanoWallet lists every CIP-30 wallet, Clip Wallet included.
import "@meshsdk/react/styles.css";
import { CardanoWallet, MeshProvider, useWallet } from "@meshsdk/react";

function Status() {
  const { connected, address } = useWallet();
  return <p>{connected ? `Connected: ${address}` : "Not connected"}</p>;
}

export function App() {
  return (
    <MeshProvider>
      <CardanoWallet persist />
      <Status />
    </MeshProvider>
  );
}
