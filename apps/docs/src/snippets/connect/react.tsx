import { ClipConnectProvider, useBalances, useClipConnect, usePay } from "@clip-wallet/connect/react";

function Checkout() {
  const { connection, connect, status, error } = useClipConnect();
  const { pay, pending, result } = usePay();
  const { balances } = useBalances();

  if (!connection) {
    return (
      <button type="button" disabled={status === "connecting"} onClick={() => void connect()}>
        {status === "error" ? `Try again (${error?.message})` : "Connect wallet"}
      </button>
    );
  }
  return (
    <>
      <p>
        {connection.wallet.name}: {balances.usdc?.formatted ?? "0"} USDC
      </p>
      <button type="button" disabled={pending} onClick={() => void pay({ asset: "usdc", amount: "25", to: "0x000000000000000000000000000000000000dEaD" })}>
        Pay 25 USDC
      </button>
      {result?.fallback === "no-eip5792" && <p>Paid from your balance on {result.chain}.</p>}
    </>
  );
}

export function App() {
  return (
    <ClipConnectProvider options={{ chains: [84532, 11155111] }}>
      <Checkout />
    </ClipConnectProvider>
  );
}
