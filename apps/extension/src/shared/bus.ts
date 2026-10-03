/** Page-side WalletClient over the message bus. */
import type { WalletClient } from "@clip-wallet/ui";
import { browser } from "wxt/browser";
import { CHANGE_EVENT, Envelope, type Request, type RequestType, type ResponseMap } from "./messages";

export type Transport = (msg: Request) => Promise<unknown>;

const runtimeTransport: Transport = (msg) => browser.runtime.sendMessage(msg);

export class BusError extends Error {
  constructor(
    public readonly userMessage: string,
    public readonly code: string,
  ) {
    super(`${code}: ${userMessage}`);
  }
}

export function createBusClient(transport: Transport = runtimeTransport, mocks = false): WalletClient {
  async function call<T extends RequestType>(msg: Extract<Request, { type: T }>): Promise<ResponseMap[T]> {
    let raw: unknown;
    try {
      raw = await transport(msg);
    } catch {
      throw new BusError("The wallet is waking up. Try again in a moment.", "bus/unavailable");
    }
    const env = Envelope.safeParse(raw);
    if (!env.success) throw new BusError("Something went wrong. Please try again.", "bus/bad-reply");
    if (!env.data.ok) throw new BusError(env.data.error.userMessage, env.data.error.code);
    return env.data.data as ResponseMap[T];
  }

  const client: WalletClient = {
    getState: () => call({ type: "getState" }),
    setPrefs: (patch) => call({ type: "setPrefs", patch }),
    createWallet: (password) => call({ type: "createWallet", password }),
    revealPhrase: (password) => call({ type: "revealPhrase", password }),
    importWallet: (phrase, password) => call({ type: "importWallet", phrase, password }),
    unlock: (password) => call({ type: "unlock", password }),
    lock: () => call({ type: "lock" }),
    passkeyBegin: (begin) => call({ type: "passkeyBegin", begin }),
    passkeyFinish: (result) => call({ type: "passkeyFinish", result }),
    passkeyRemove: () => call({ type: "passkeyRemove" }),
    getPortfolio: (o) => call({ type: "getPortfolio", refresh: o?.refresh }),
    getCollectibles: () => call({ type: "getCollectibles" }),
    getActivity: () => call({ type: "getActivity" }),
    resolveRecipient: (p) => call({ type: "resolveRecipient", ...p }),
    rememberRecipientNetwork: (p) => call({ type: "rememberRecipientNetwork", ...p }),
    send: (p) => call({ type: "send", ...p }),
    getReceiveTargets: (p) => call({ type: "getReceiveTargets", ...p }),
    listApprovals: () => call({ type: "listApprovals" }),
    getApproval: (id) => call({ type: "getApproval", id }),
    approve: (id, o) => call({ type: "approve", id, allowBlind: o?.allowBlind }),
    reject: (id) => call({ type: "reject", id }),
    listSessions: () => call({ type: "listSessions" }),
    disconnect: (id) => call({ type: "disconnect", id }),
    pairWalletConnect: (uri) => call({ type: "pairWalletConnect", uri }),
    openFullTab: (route) => call({ type: "openFullTab", route }),
    onChange: (cb) => {
      const on = (m: unknown) => {
        if (m && typeof m === "object" && (m as { event?: string }).event === CHANGE_EVENT) cb();
      };
      browser.runtime.onMessage.addListener(on);
      return () => browser.runtime.onMessage.removeListener(on);
    },
  };
  if (mocks) client.devSimulateRequest = (kind) => call({ type: "devSimulateRequest", kind });
  return client;
}
