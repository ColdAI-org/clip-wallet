"use client";

/**
 * Clip Connect demo (@clip-wallet/connect): one connect() that prefers this project's wallet and falls back to any
 * other wallet, accounts as CAIP-10, EIP-5792 capabilities, balances by asset key and pay() that uses the wallet's
 * auxiliary funds (ERC-7682) when it has them. The app never picks a network: pay() does.
 */
import { useState } from "react";
import { ClipConnectProvider, useBalances, useClipConnect, usePay } from "@clip-wallet/connect/react";
import type { NextPage } from "next";
import { hederaTestnet } from "viem/chains";
import scaffoldConfig from "~~/scaffold.config";
import { WALLET_NAME, WALLET_RDNS } from "~~/utils/wallet";

/** Hedera testnet (this template's network) plus two EVM testnets the wallet also speaks, for capabilities and balances. */
const CHAINS = [hederaTestnet.id, 84532, 11155111];

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="bg-base-100 rounded-2xl shadow-md p-6 border border-base-300 flex flex-col gap-3">
    <h3 className="font-bold text-lg m-0">{title}</h3>
    {children}
  </div>
);

function Demo() {
  const { connection, status, error, connect, disconnect } = useClipConnect();
  const { balances, refresh } = useBalances();
  const { pay, result, error: payError, pending } = usePay();
  const [caps, setCaps] = useState<string>("");
  const [asset, setAsset] = useState("hbar");
  const [amount, setAmount] = useState("1");
  const [to, setTo] = useState("");

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl px-5 py-10">
      <h1 className="text-3xl font-bold m-0">Clip Connect</h1>
      <p className="m-0">
        Works with {WALLET_NAME} first and any other wallet after it. Dapps that don&apos;t use Clip Connect keep working
        with {WALLET_NAME} exactly as before.
      </p>

      <Card title="1. Connect">
        {connection ? (
          <>
            <p className="m-0" data-testid="cc-wallet">
              Connected to <b>{connection.wallet.name}</b> ({connection.wallet.via}
              {connection.wallet.preferred ? ", preferred" : ""})
            </p>
            <ul className="m-0 text-sm font-mono break-all">
              {connection.accounts.map(a => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <button className="btn btn-sm btn-outline w-fit" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </>
        ) : (
          <button className="btn btn-primary w-fit" disabled={status === "connecting"} onClick={() => void connect()}>
            {status === "connecting" ? "Connecting…" : `Connect ${WALLET_NAME}`}
          </button>
        )}
        {error && <p className="text-error m-0">{error.message}</p>}
      </Card>

      {connection && (
        <>
          <Card title="2. What the wallet can do (EIP-5792 / ERC-7682)">
            <button
              className="btn btn-sm w-fit"
              onClick={async () => setCaps(JSON.stringify(await connection.capabilities(), null, 2) ?? "null")}
            >
              Ask the wallet
            </button>
            {caps && (
              <pre className="text-xs bg-base-200 p-3 rounded-lg overflow-auto m-0" data-testid="cc-capabilities">
                {caps === "null" ? "This wallet doesn't speak EIP-5792: pay() will send a plain transfer." : caps}
              </pre>
            )}
          </Card>

          <Card title="3. Balances by asset">
            <button className="btn btn-sm w-fit" onClick={() => void refresh()}>
              Refresh
            </button>
            <ul className="m-0">
              {Object.values(balances).map(b => (
                <li key={b.key}>
                  {b.formatted} {b.symbol}
                </li>
              ))}
              {Object.keys(balances).length === 0 && <li>Nothing yet. Get testnet HBAR from the faucet on Home.</li>}
            </ul>
          </Card>

          <Card title="4. Pay">
            <div className="flex flex-wrap gap-2 items-center">
              <input className="input input-bordered input-sm w-24" value={amount} onChange={e => setAmount(e.target.value)} aria-label="Amount" />
              <select className="select select-bordered select-sm" value={asset} onChange={e => setAsset(e.target.value)} aria-label="Asset">
                <option value="hbar">HBAR</option>
                <option value="usdc">USDC</option>
                <option value="eth">ETH</option>
              </select>
              <input className="input input-bordered input-sm grow font-mono" placeholder="0x… recipient" value={to} onChange={e => setTo(e.target.value)} aria-label="Recipient" />
              <button className="btn btn-primary btn-sm" disabled={pending || !/^0x[0-9a-fA-F]{40}$/.test(to)} onClick={() => void pay({ asset, amount, to }).catch(() => undefined)}>
                {pending ? "Paying…" : "Pay"}
              </button>
            </div>
            {result && (
              <p className="m-0 text-sm" data-testid="cc-pay-result">
                Sent with <code>{result.method}</code>
                {result.auxiliaryFunds
                  ? ` — ${WALLET_NAME} can bring in money from your other balances if this network is short.`
                  : result.fallback === "no-eip5792"
                    ? " — a plain transfer: this wallet can't bring in money, so the balance on this network had to cover it."
                    : " — paid from the balance on this network."}
              </p>
            )}
            {payError && <p className="text-error m-0">{payError.message.split("\n")[0]}</p>}
          </Card>
        </>
      )}
    </div>
  );
}

const ClipConnectPage: NextPage = () => (
  <div className="flex items-center flex-col grow">
    <ClipConnectProvider
      options={{
        prefer: { rdns: WALLET_RDNS, name: WALLET_NAME },
        chains: CHAINS,
        rpc: { [hederaTestnet.id]: scaffoldConfig.rpcOverrides[hederaTestnet.id] },
        walletConnect: { projectId: scaffoldConfig.walletConnectProjectId, load: () => import("@walletconnect/ethereum-provider") },
      }}
    >
      <Demo />
    </ClipConnectProvider>
  </div>
);

export default ClipConnectPage;
