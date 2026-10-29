import { ClipError, type Family, say } from "@clip-wallet/core";
import { queueSteps, type Step } from "@clip-wallet/features";
import type { SecurityConfig, SecurityHost } from "../host.js";
import type { ApprovalsOverviewView, Unavailable } from "../views.js";
import { EvmApprovals } from "./evm.js";
import { HederaApprovals } from "./hedera.js";
import { SolanaApprovals } from "./solana.js";
import type { ApprovalScanner, Grant } from "./types.js";

/**
 * Families with no standing-permission concept to list, in plain words. Checked 2026-10-03:
 *  - Aptos: the Fungible Asset standard (aptos.dev/build/smart-contracts/fungible-asset) and the legacy Coin
 *    standard have no approve/allowance; only the owner's signer can withdraw. AIP-103 "permissioned signer"
 *    was removed from the framework before it shipped to users.
 *  - Sui: objects are moved only by their owner's transaction (docs.sui.io/concepts/object-ownership); there
 *    is no allowance to revoke.
 *  - Bitcoin: UTXOs have no allowances.
 * Checked 2026-10-30:
 *  - Cardano: native tokens sit in UTXOs only the owner's key can spend; the ledger has no approve or allowance.
 *    Stake-pool and DRep delegation lend stake and votes, never the funds.
 *  - Fuel: native assets are UTXO coins spent only with the owner's signature; no allowance standard.
 *  - Bitcoin Cash: UTXOs (CashTokens included) have no allowances.
 */
const NO_PERMISSIONS: Partial<Record<Family, string>> = {
  aptos: "Aptos tokens can't be spent by an app unless you sign each time, so there's nothing to remove there.",
  sui: "Sui coins and objects can only be moved by you, so there's nothing to remove there.",
  bitcoin: "Bitcoin has no spending permissions to remove.",
  cardano: "Cardano tokens can only be moved with your signature each time, so there's nothing to remove there.",
  fuel: "Fuel coins can only be moved with your signature each time, so there's nothing to remove there.",
  bitcoincash: "Bitcoin Cash has no spending permissions to remove.",
};

/**
 * Families that do have permissions this build can't list yet (gaps, said plainly). Every family without a scanner
 * is here or above, so none is left out of the screen in silence.
 */
const NOT_YET: Partial<Record<Family, string>> = {
  starknet: "Starknet tokens can have spending permissions too. This wallet can't list them yet.",
  tezos: "Tezos tokens can have operators (apps allowed to move them). This wallet can't list them yet.",
  substrate: "Polkadot Asset Hub tokens can have spending permissions and proxies. This wallet can't list them yet.",
  stellar: "Stellar smart-contract tokens can have spending permissions. This wallet can't list them yet.",
  tron: "TRON tokens can have spending permissions, as on Ethereum, and an account can give other keys control of it. This wallet can't list them yet.",
  ton: "TON wallets can have extensions or plugins (apps allowed to send from your wallet). This wallet can't list them yet.",
  near: "NEAR apps can hold access keys to your account. This wallet can't list them yet.",
  icp: "Internet Computer tokens can have spending permissions (ICRC-2). This wallet can't list them yet.",
  cosmos: "Cosmos accounts can let another account act for them or pay fees from their balance (authz and fee grants). This wallet can't list them yet.",
  provenance: "Provenance accounts can let another account act for them or pay fees from their balance (authz and fee grants). This wallet can't list them yet.",
  initia: "Initia accounts can let another account act for them or pay fees from their balance (authz and fee grants). This wallet can't list them yet.",
  thorchain: "This wallet doesn't check THORChain for permissions yet.",
  xrpl: "XRP Ledger accounts can have a regular key, other signers, or checks someone else can cash. This wallet can't list them yet.",
  antelope: "Antelope accounts (Vaulta, Telos, XPR Network and others) can give other keys and contracts permission to act for them. This wallet can't list them yet.",
  algorand: "Algorand app tokens (ARC-200) can have spending permissions, and an account can be handed to another key (rekeyed). This wallet can't list them yet.",
  stacks: "Stacks accounts can let a stacking pool lock their STX. This wallet can't list those delegations yet.",
  multiversx: "MultiversX accounts can have a guardian that must co-sign their transactions. This wallet can't list it yet.",
};

/** Every note code a scan can give, for screens that say the notes in the user's language. */
export const APPROVAL_NOTE_CODES: readonly string[] = [
  ...Object.keys(NO_PERMISSIONS).map((f) => `no-permissions:${f}`),
  ...Object.keys(NOT_YET).map((f) => `not-yet:${f}`),
];

const DEFAULTS = { lookbackBlocks: 200_000, maxBlockRange: 10_000, oldAfterDays: 180 };

export class ApprovalsService {
  private readonly scanners: Map<Family, ApprovalScanner>;
  private last = new Map<string, Grant>();

  constructor(
    private readonly host: SecurityHost,
    private readonly config: SecurityConfig = { testnet: true },
    private readonly isFlagged: (address: string) => boolean = () => false,
    scanners?: ApprovalScanner[],
  ) {
    const list = scanners ?? [new EvmApprovals(() => host.assets()), new SolanaApprovals(() => host.assets()), new HederaApprovals()];
    this.scanners = new Map(list.map((s) => [s.family as Family, s]));
  }

  async scan(): Promise<ApprovalsOverviewView> {
    const now = this.host.now?.() ?? Date.now();
    const a = { ...DEFAULTS, ...this.config.approvals };
    const opts = { now, oldAfterDays: a.oldAfterDays, isFlagged: this.isFlagged, evm: { lookbackBlocks: a.lookbackBlocks, maxBlockRange: a.maxBlockRange } };
    const partial: Unavailable[] = [];
    const notes = new Map<string, string>();
    const grants: Grant[] = [];
    await Promise.all(
      this.host.networks().map(async (n) => {
        const scanner = this.scanners.get(n.family);
        if (!scanner) {
          const none = NO_PERMISSIONS[n.family];
          const notYet = NOT_YET[n.family];
          if (none) notes.set(`no-permissions:${n.family}`, none);
          else if (notYet) notes.set(`not-yet:${n.family}`, notYet);
          return;
        }
        try {
          const r = await scanner.scan(await this.host.ctx(n.id), opts);
          grants.push(...r.grants);
          partial.push(...r.partial);
        } catch {
          partial.push({ code: "approvals/unreachable", network: n.name, message: say("bg.security.couldntCheck", { name: n.name }) });
        }
      }),
    );
    const order = { high: 0, medium: 1, low: 2 } as const;
    grants.sort((x, y) => order[x.view.riskLevel] - order[y.view.riskLevel] || x.view.title.localeCompare(y.view.title));
    this.last = new Map(grants.map((g) => [g.view.id, g]));
    return { grants: grants.map((g) => g.view), notes: [...notes.values()], noteCodes: [...notes.keys()], partial, scannedAt: now };
  }

  /** Steps that revoke the chosen grants, grouped per network (batched where the network allows). */
  async steps(ids: string[]): Promise<Step[]> {
    if (!this.last.size) await this.scan();
    const chosen = ids.map((id) => this.last.get(id)).filter((g): g is Grant => !!g);
    if (!chosen.length) throw new ClipError("Those permissions are already gone. Pull to refresh.", "approvals/none");
    const byNetwork = new Map<string, Grant[]>();
    for (const g of chosen) byNetwork.set(g.view.networkId, [...(byNetwork.get(g.view.networkId) ?? []), g]);
    const steps: Step[] = [];
    for (const [networkId, gs] of byNetwork) {
      const scanner = this.scanners.get(gs[0]!.view.family);
      if (!scanner) continue;
      steps.push(...(await scanner.revoke(gs, await this.host.ctx(networkId))));
    }
    return steps;
  }

  /** One tap: queue every revoke on the normal approval path. You confirm each transaction there. */
  async revoke(ids: string[]) {
    const steps = await this.steps(ids);
    const queued = await queueSteps(this.host, steps, "Clip Wallet", () => {
      this.last.clear();
    });
    return queued;
  }
}
