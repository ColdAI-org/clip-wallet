/**
 * React bindings for Clip Connect (react is an optional peer).
 *
 *   <ClipConnectProvider options={{ chains: [84532] }}>
 *     const { connection, connect, status } = useClipConnect();
 *     const { pay, result, error } = usePay();
 *     const { balances } = useBalances();
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { connect as connectWallet, type AssetBalance, type ClipConnection, type ConnectOptions, type PayRequest, type PayResult } from "./connect.js";

export type ConnectStatus = "idle" | "connecting" | "connected" | "error";

interface Ctx {
  connection: ClipConnection | null;
  status: ConnectStatus;
  error: Error | null;
  connect(): Promise<ClipConnection | null>;
  disconnect(): Promise<void>;
}

const ClipConnectContext = createContext<Ctx | null>(null);

export function ClipConnectProvider(props: { options?: ConnectOptions; children: ReactNode }) {
  const [connection, setConnection] = useState<ClipConnection | null>(null);
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const opts = useRef(props.options);
  opts.current = props.options;

  const connect = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    try {
      const c = await connectWallet(opts.current);
      setConnection(c);
      setStatus("connected");
      return c;
    } catch (e) {
      setError(e as Error);
      setStatus("error");
      return null;
    }
  }, []);

  const disconnect = useCallback(async () => {
    await connection?.disconnect();
    setConnection(null);
    setStatus("idle");
  }, [connection]);

  useEffect(() => {
    if (!connection) return;
    const off = connection.on("disconnect", () => {
      setConnection(null);
      setStatus("idle");
    });
    return off;
  }, [connection]);

  const value = useMemo(() => ({ connection, status, error, connect, disconnect }), [connection, status, error, connect, disconnect]);
  return <ClipConnectContext.Provider value={value}>{props.children}</ClipConnectContext.Provider>;
}

export function useClipConnect(): Ctx {
  const ctx = useContext(ClipConnectContext);
  if (!ctx) throw new Error("useClipConnect needs <ClipConnectProvider> above it.");
  return ctx;
}

/** Pay with auxiliary funds when the wallet offers them, else a plain transfer (`result.fallback` says which). */
export function usePay() {
  const { connection } = useClipConnect();
  const [result, setResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const pay = useCallback(
    async (p: PayRequest) => {
      if (!connection) throw new Error("Connect a wallet first.");
      setPending(true);
      setError(null);
      try {
        const r = await connection.pay(p);
        setResult(r);
        return r;
      } catch (e) {
        setError(e as Error);
        throw e;
      } finally {
        setPending(false);
      }
    },
    [connection],
  );
  return { pay, result, error, pending };
}

/** Balances by asset key; `refresh()` re-reads them. */
export function useBalances() {
  const { connection } = useClipConnect();
  const [balances, setBalances] = useState<Record<string, AssetBalance>>({});
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!connection) return;
    setLoading(true);
    try {
      setBalances(await connection.balances());
    } finally {
      setLoading(false);
    }
  }, [connection]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { balances, loading, refresh };
}
