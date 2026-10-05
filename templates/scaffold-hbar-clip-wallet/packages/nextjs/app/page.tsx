"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HederaPortalFaucet } from "@scaffold-hbar-ui/components";
import type { NextPage } from "next";
import { formatEther, parseEther, verifyMessage } from "viem";
import { hederaTestnet } from "viem/chains";
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  useSendTransaction,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from "wagmi";
import { BugAntIcon, CheckCircleIcon, PuzzlePieceIcon } from "@heroicons/react/24/outline";
import { HederaAddress } from "~~/components/scaffold-hbar";
import { WALLET_NAME, WALLET_RDNS, findWallet } from "~~/utils/wallet";

const HASHSCAN_TX = "https://hashscan.io/testnet/transaction/";

/** One step of the demo: a numbered card with a title, a sentence and its controls. */
const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <div className="bg-base-100 rounded-2xl shadow-md p-6 border border-base-300">
    <div className="flex items-start gap-3">
      <span className="font-bold text-primary text-lg leading-none mt-1">{n}</span>
      <div className="flex flex-col gap-3 grow min-w-0">
        <h3 className="font-bold text-lg m-0">{title}</h3>
        {children}
      </div>
    </div>
  </div>
);

const Home: NextPage = () => {
  const { address, chainId, connector: active, status } = useAccount();
  const { connectors, connect, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { data: balance, refetch: refetchBalance } = useBalance({ address, chainId: hederaTestnet.id });
  const { signMessageAsync, isPending: signing } = useSignMessage();
  const { sendTransaction, data: txHash, isPending: sending, error: sendError } = useSendTransaction();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash, chainId: hederaTestnet.id });

  // wagmi turns every EIP-6963 announcement into a connector whose id is the wallet's rdns.
  const connector = useMemo(() => connectors.find(c => c.id === WALLET_RDNS), [connectors]);
  const [announced, setAnnounced] = useState<boolean | null>(null);
  useEffect(() => {
    findWallet().then(d => setAnnounced(!!d));
  }, []);
  const detected = !!connector || announced === true;

  const usingWallet = status === "connected" && active?.id === WALLET_RDNS;
  const onHedera = chainId === hederaTestnet.id;

  const [signed, setSigned] = useState<{ message: string; signature: string; valid: boolean } | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  useEffect(() => {
    if (txConfirmed) refetchBalance();
  }, [txConfirmed, refetchBalance]);

  const sign = async () => {
    if (!address) return;
    setSignError(null);
    const message = `Sign in to ${window.location.host} with ${WALLET_NAME}.\nNonce: ${crypto.randomUUID()}`;
    try {
      const signature = await signMessageAsync({ message });
      setSigned({ message, signature, valid: await verifyMessage({ address, message, signature }) });
    } catch (e) {
      setSignError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }
  };

  return (
    <div className="flex items-center flex-col grow">
      <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full py-14 px-5">
        <div className="flex flex-col items-center max-w-2xl mx-auto text-center gap-3">
          <span className="text-sm font-medium tracking-widest uppercase text-white/80">
            Scaffold-HBAR · Clip Wallet kit
          </span>
          <h1 className="text-4xl font-bold text-white m-0">{WALLET_NAME}</h1>
          <p className="text-white/80 m-0">
            Your wallet, connected to a Hedera testnet dapp through 1Mask. Every request below opens {WALLET_NAME}
            &apos;s approval window, decoded in plain words before you approve.
          </p>
        </div>
      </div>

      <div className="w-full max-w-3xl mx-auto px-5 -mt-6 pb-16 flex flex-col gap-5">
        <Step n={1} title={`Load ${WALLET_NAME}`}>
          {detected ? (
            <p className="m-0 flex items-center gap-2 text-success">
              <CheckCircleIcon className="h-5 w-5" /> {WALLET_NAME} is installed and announced itself as{" "}
              <code className="text-xs bg-base-200 px-2 py-1 rounded">{WALLET_RDNS}</code>.
            </p>
          ) : (
            <div className="text-sm flex flex-col gap-2">
              <p className="m-0">
                {announced === null
                  ? "Looking for the extension…"
                  : `${WALLET_NAME} isn't installed in this browser yet.`}
              </p>
              <ol className="list-decimal ml-5 m-0">
                <li>
                  <code className="text-xs bg-base-200 px-2 py-1 rounded">pnpm extension:build</code>
                </li>
                <li>
                  Open <code className="text-xs bg-base-200 px-2 py-1 rounded">chrome://extensions</code>, turn on
                  Developer mode, choose <b>Load unpacked</b> and pick{" "}
                  <code className="text-xs bg-base-200 px-2 py-1 rounded">packages/extension/.output/chrome-mv3</code>.
                </li>
                <li>Create or import a wallet in it, then reload this page.</li>
              </ol>
            </div>
          )}
        </Step>

        <Step n={2} title="Connect">
          {usingWallet && address ? (
            <div className="flex flex-col gap-2">
              <HederaAddress address={address} chain={hederaTestnet} />
              <p className="m-0 text-sm">
                Balance: <b>{balance ? `${Number(formatEther(balance.value)).toFixed(4)} HBAR` : "…"}</b>
              </p>
              {!onHedera && (
                <button
                  className="btn btn-sm btn-warning w-fit"
                  disabled={switching}
                  onClick={() => switchChain({ chainId: hederaTestnet.id })}
                >
                  Switch to Hedera testnet
                </button>
              )}
              <button className="btn btn-sm btn-ghost w-fit" onClick={() => disconnect()}>
                Disconnect
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                className="btn btn-primary btn-sm w-fit"
                disabled={!connector || connecting}
                onClick={() => connector && connect({ connector, chainId: hederaTestnet.id })}
              >
                {connecting ? "Waiting for approval…" : `Connect ${WALLET_NAME}`}
              </button>
              {connectError && <p className="m-0 text-sm text-error">{connectError.message.split("\n")[0]}</p>}
              <p className="m-0 text-xs text-base-content/60">
                The Connect Wallet button in the header lists {WALLET_NAME} too (EIP-6963), next to MetaMask and
                WalletConnect.
              </p>
            </div>
          )}
        </Step>

        <Step n={3} title="Sign a message">
          <p className="m-0 text-sm">A sign-in message (EIP-191). The approval shows the text and the site asking.</p>
          <button className="btn btn-primary btn-sm w-fit" disabled={!usingWallet || signing} onClick={sign}>
            {signing ? "Waiting for approval…" : "Sign"}
          </button>
          {signed && (
            <p className="m-0 text-sm break-all">
              {signed.valid ? "Valid signature" : "Signature did NOT verify"}:{" "}
              <code className="text-xs">{signed.signature.slice(0, 42)}…</code>
            </p>
          )}
          {signError && <p className="m-0 text-sm text-error">{signError}</p>}
        </Step>

        <Step n={4} title="Send 0.1 HBAR to yourself">
          <p className="m-0 text-sm">
            A real testnet transaction. Need HBAR?{" "}
            <HederaPortalFaucet variant="link" label="Hedera faucet" showIcon={false} />
          </p>
          <button
            className="btn btn-primary btn-sm w-fit"
            disabled={!usingWallet || !onHedera || sending || !address}
            onClick={() =>
              address && sendTransaction({ to: address, value: parseEther("0.1"), chainId: hederaTestnet.id })
            }
          >
            {sending ? "Waiting for approval…" : "Send"}
          </button>
          {txHash && (
            <p className="m-0 text-sm break-all">
              {txConfirmed ? "Confirmed" : "Sent"}:{" "}
              <a className="link" href={`${HASHSCAN_TX}${txHash}`} target="_blank" rel="noreferrer">
                {txHash.slice(0, 18)}… on HashScan
              </a>
            </p>
          )}
          {sendError && <p className="m-0 text-sm text-error">{sendError.message.split("\n")[0]}</p>}
        </Step>

        <Step n={5} title="Call a Hedera system contract">
          <p className="m-0 text-sm">
            The Scaffold-HBAR debug page lists Hedera&apos;s PRNG (0x169) and exchange-rate (0x168) system contracts.
            Calling one sends a contract call through {WALLET_NAME}.
          </p>
          <Link href="/debug" className="btn btn-primary btn-sm w-fit gap-2">
            <BugAntIcon className="h-4 w-4" /> Open Debug Contracts
          </Link>
        </Step>

        <div className="text-xs text-base-content/60 flex items-start gap-2">
          <PuzzlePieceIcon className="h-4 w-4 shrink-0" />
          <span>
            The wallet is <code>packages/extension</code> (clip.config.ts, wallet.identity.json); this dapp is{" "}
            <code>packages/nextjs</code>. Both run on Hedera testnet only until the wallet&apos;s mainnet checklist is
            done.
          </span>
        </div>
      </div>
    </div>
  );
};

export default Home;
