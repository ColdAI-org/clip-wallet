/**
 * EIP-5792 Wallet Call API + ERC-7682 auxiliary funds, background side (the CallsHost 1Mask and WalletConnect ask).
 * The batch logic itself is shared with the mobile engine (@clip-wallet/engine/calls-batch); this file binds it to
 * the extension: storage, RPC receipts, the vault-signing send the service provides, Activity and the wallet UI.
 */
import type { AssetRef, DappRequest, DecodedRequest, Network, NetworkId } from "@clip-wallet/core";
import { msg } from "@clip-wallet/core";
import type { ActivityEntry } from "@clip-wallet/ui";
import type { AuxiliaryFundsCapability, CallsHost, CallsReceipt, CallsStatus, SendCallsResult } from "@clip-wallet/1mask";
import { auxiliaryFundsFor } from "@clip-wallet/route";
import { CallsBatchRun, CallsBatchStore, callsReceipt, type BatchRecord, type BatchStoreKV } from "@clip-wallet/engine/calls-batch";

export interface BackgroundCallsOptions {
  kv: BatchStoreKV;
  /** Fixture builds: receipts are made up (mock chains broadcast nothing). */
  mocks: boolean;
  networks: () => Network[];
  assets: () => AssetRef[];
  /** Networks auxiliary funds can come from (settle on Hedera's deposit networks); [] = capability off. */
  sources: () => NetworkId[];
  rpc(networkId: NetworkId, method: string, params: unknown): Promise<unknown>;
  /** Prepare, sign under `approvalId` (vault) and broadcast one call of an approved batch; resolves with its hash. */
  sendCall(call: DappRequest, approvalId: string): Promise<string>;
  activity(e: ActivityEntry): Promise<void>;
  openActivity(): Promise<void>;
  pollMs?: number;
}

const mockReceipt = (hash: string): CallsReceipt => ({
  logs: [],
  status: "0x1",
  blockHash: `0x${"0b".repeat(32)}`,
  blockNumber: "0x1",
  gasUsed: "0x5208",
  transactionHash: hash as `0x${string}`,
});

export class BackgroundCalls implements CallsHost {
  readonly store: CallsBatchStore;
  private readonly run: CallsBatchRun;

  constructor(private readonly o: BackgroundCallsOptions) {
    this.store = new CallsBatchStore(o.kv);
    this.run = new CallsBatchRun(this.store, {
      send: (call, approvalId) => o.sendCall(call, approvalId),
      waitReceipt: (n, h) => this.waitReceipt(n, h),
      done: () => undefined,
    });
  }

  auxiliaryFunds(networkIds: NetworkId[]): Record<NetworkId, AuxiliaryFundsCapability | undefined> {
    return auxiliaryFundsFor({ networkIds, networks: this.o.networks(), assets: this.o.assets(), sources: this.o.sources() });
  }

  status(origin: string, id: string): Promise<CallsStatus | undefined> {
    return this.store.status(origin, id, (n, h) => this.receipt(n, h));
  }

  async show(origin: string, id: string): Promise<boolean> {
    if (!(await this.store.get(origin, id))) return false;
    await this.o.openActivity().catch(() => undefined);
    return true;
  }

  private async receipt(networkId: NetworkId, hash: string): Promise<CallsReceipt | null> {
    if (this.o.mocks) return mockReceipt(hash);
    const r = (await this.o.rpc(networkId, "eth_getTransactionReceipt", [hash]).catch(() => null)) as Record<string, unknown> | null;
    return r && typeof r.status === "string" ? callsReceipt(r) : null;
  }

  private async waitReceipt(networkId: NetworkId, hash: string): Promise<CallsReceipt | null> {
    const pollMs = this.o.pollMs ?? (this.o.mocks ? 200 : 2000);
    for (let i = 0; i < (this.o.mocks ? 1 : 90); i++) {
      await new Promise((r) => setTimeout(r, pollMs));
      const got = await this.receipt(networkId, hash);
      if (got) return got;
    }
    return null;
  }

  /** Runs an approved batch (`calls` = each call's decoded request, for Activity). */
  start(req: DappRequest, approvalId: string, calls: DecodedRequest[], app: { name: string; origin: string }): Promise<SendCallsResult> {
    return this.run.start(req, approvalId, {
      walletConnect: req.via === "walletconnect",
      done: (rec) => this.o.activity(activityOf(rec, calls, app)),
    });
  }
}

/** One Activity entry for a finished (or stopped) batch, with one leg per call. */
export function activityOf(rec: BatchRecord, calls: DecodedRequest[], app: { name: string; origin: string }): ActivityEntry {
  const stoppedAt = rec.calls.findIndex((c) => c.state !== "sent" || (c.receipt && c.receipt.status !== "0x1"));
  const title = stoppedAt < 0 ? msg("bg.act.batch", { count: rec.calls.length, app: app.name }) : msg("bg.act.batchStopped", { count: rec.calls.length, app: app.name, n: stoppedAt + 1 });
  return {
    id: rec.id,
    title: title.fallback,
    titleMsg: title,
    kind: "sign",
    app,
    timestamp: Date.now(),
    status: stoppedAt < 0 ? "done" : "failed",
    legs: rec.calls.map((c, i) => ({
      title: calls[i]?.title ?? "",
      ...(calls[i]?.titleMsg ? { titleMsg: calls[i]!.titleMsg } : {}),
      networkId: rec.networkId,
      status: c.receipt ? (c.receipt.status === "0x1" ? "done" : "failed") : c.state === "sent" ? "pending" : "failed",
      ...(c.hash ? { txHash: c.hash } : {}),
    })),
  };
}
