import type { ChainContext } from "@clip-wallet/core";
import { freezeNew, mirrorFor, requestFor, resolvePayer } from "@clip-wallet/chains-hedera";
import { formatUnits, type Step } from "@clip-wallet/features";
import { AccountAllowanceApproveTransaction, AccountId, Hbar } from "@hiero-ledger/sdk";
import { spenderName } from "../labels.js";
import { chunk } from "../solana.js";
import { type ApprovalScanner, type Grant, type RevokeSpec, type ScanOptions, type ScanResult, grantId, risksFor } from "./types.js";

/**
 * Hedera allowances (HIP-336): CryptoApproveAllowance grants HBAR, fungible-token and NFT allowances.
 * Listed by the mirror node (testnet OpenAPI, 2026-10-03):
 *   GET /api/v1/accounts/{id}/allowances/crypto  → { allowances: [{ owner, spender, amount, amount_granted, timestamp }] }
 *   GET /api/v1/accounts/{id}/allowances/tokens  → + token_id
 *   GET /api/v1/accounts/{id}/allowances/nfts    → { owner, spender, token_id, approved_for_all, timestamp }
 * `amount` is what's left, `amount_granted` what was approved.
 *
 * Revoke: an AccountAllowanceApproveTransaction setting HBAR/token allowances to 0 and
 * `deleteTokenNftAllowanceAllSerials` for approved-for-all NFTs. Up to 20 allowances per transaction:
 * `allowances.maxTransactionLimit` defaults to 20 in hiero-consensus-node HederaConfig.java. chains-hedera
 * describes these as "Remove X's permission to spend your …", never blind.
 *
 * Single-serial NFT allowances live on the NFT itself (`spender`) and are cleared when it moves; they are not
 * listed here.
 */
const HBAR_SUPPLY_TINYBARS = 50_000_000_000n * 100_000_000n;
const INT64_MAX = 2n ** 63n - 1n;
const PER_TX = 20;

interface MirrorAllowance {
  owner: string;
  spender: string;
  token_id?: string;
  amount?: number | string;
  amount_granted?: number | string;
  approved_for_all?: boolean;
  timestamp?: { from?: string };
}

const secondsToMs = (s?: string) => (s ? Math.floor(Number(s) * 1000) : undefined);

export class HederaApprovals implements ApprovalScanner {
  readonly family = "hedera" as const;

  async scan(ctx: ChainContext, opts: ScanOptions): Promise<ScanResult> {
    const mirror = mirrorFor(ctx);
    let owner: string;
    try {
      owner = await resolvePayer(ctx, mirror);
    } catch {
      return { grants: [], partial: [] }; // no account yet: nothing granted
    }
    const [crypto, tokens, nfts] = await Promise.all([
      mirror.paged<MirrorAllowance>(`/api/v1/accounts/${owner}/allowances/crypto?limit=100`, "allowances"),
      mirror.paged<MirrorAllowance>(`/api/v1/accounts/${owner}/allowances/tokens?limit=100`, "allowances"),
      mirror.paged<MirrorAllowance>(`/api/v1/accounts/${owner}/allowances/nfts?limit=100`, "allowances"),
    ]);
    const grants: Grant[] = [];
    const base = (spender: string, grantedAt?: number) => {
      const name = spenderName("hedera", spender);
      return { name, who: name ?? "An unknown app", spender: { address: spender, name, known: !!name }, risk: { spenderKnown: !!name, flagged: opts.isFlagged(spender), grantedAt, now: opts.now, oldAfterDays: opts.oldAfterDays } };
    };

    for (const a of crypto) {
      const amount = BigInt(a.amount ?? 0);
      if (amount === 0n) continue;
      const granted = BigInt(a.amount_granted ?? amount);
      const at = secondsToMs(a.timestamp?.from);
      const b = base(a.spender, at);
      const unlimited = amount >= HBAR_SUPPLY_TINYBARS / 2n;
      const spec: RevokeSpec = { kind: "hedera-hbar", spender: a.spender };
      grants.push({
        revoke: spec,
        view: {
          id: grantId(ctx.network.id, spec),
          kind: "hbar-allowance",
          family: "hedera",
          title: unlimited ? `${b.who} can spend all your HBAR` : `${b.who} can spend up to ${formatUnits(amount, 8)} HBAR`,
          asset: { symbol: "HBAR", name: "HBAR" },
          spender: b.spender,
          amount: unlimited ? "All your HBAR" : `Up to ${formatUnits(amount, 8)} HBAR`,
          unlimited,
          grantedAt: at,
          ...risksFor({ ...b.risk, unlimited, unused: !unlimited && amount === granted }),
          networkId: ctx.network.id,
        },
      });
    }

    for (const a of tokens) {
      const amount = BigInt(a.amount ?? 0);
      if (amount === 0n || !a.token_id) continue;
      const granted = BigInt(a.amount_granted ?? amount);
      const info = await mirror.token(a.token_id).catch(() => null);
      const symbol = info?.symbol || a.token_id;
      const decimals = Number(info?.decimals ?? 0);
      const supply = info?.total_supply ? BigInt(info.total_supply) : 0n;
      const unlimited = amount >= INT64_MAX / 2n || (supply > 0n && amount >= supply);
      const at = secondsToMs(a.timestamp?.from);
      const b = base(a.spender, at);
      const spec: RevokeSpec = { kind: "hedera-token", tokenId: a.token_id, spender: a.spender };
      grants.push({
        revoke: spec,
        view: {
          id: grantId(ctx.network.id, spec),
          kind: "hts-allowance",
          family: "hedera",
          title: unlimited ? `${b.who} can spend all your ${symbol}` : `${b.who} can spend up to ${formatUnits(amount, decimals)} ${symbol}`,
          asset: { symbol, name: info?.name || symbol, address: a.token_id },
          spender: b.spender,
          amount: unlimited ? `All your ${symbol}` : `Up to ${formatUnits(amount, decimals)} ${symbol}`,
          unlimited,
          grantedAt: at,
          ...risksFor({ ...b.risk, unlimited, unused: !unlimited && amount === granted }),
          networkId: ctx.network.id,
        },
      });
    }

    for (const a of nfts) {
      if (!a.approved_for_all || !a.token_id) continue;
      const info = await mirror.token(a.token_id).catch(() => null);
      const coll = info?.name || a.token_id;
      const at = secondsToMs(a.timestamp?.from);
      const b = base(a.spender, at);
      const spec: RevokeSpec = { kind: "hedera-nft-all", tokenId: a.token_id, spender: a.spender };
      grants.push({
        revoke: spec,
        view: {
          id: grantId(ctx.network.id, spec),
          kind: "hts-nft-all",
          family: "hedera",
          title: `${b.who} can move every NFT you hold in ${coll}`,
          asset: { symbol: info?.symbol || coll, name: coll, address: a.token_id },
          spender: b.spender,
          amount: `Every NFT in ${coll}`,
          unlimited: true,
          grantedAt: at,
          ...risksFor({ ...b.risk, unlimited: true }),
          networkId: ctx.network.id,
        },
      });
    }
    return { grants, partial: [] };
  }

  async revoke(grants: Grant[], ctx: ChainContext): Promise<Step[]> {
    const specs = grants.map((g) => g.revoke).filter((s) => s.kind.startsWith("hedera-"));
    return chunk(specs, PER_TX).map((batch) => ({
      title: batch.length === 1 ? "Remove 1 spending permission" : `Remove ${batch.length} spending permissions`,
      lines: [{ label: "What happens", value: "The apps lose their permission. Nothing is moved." }],
      request: async () => {
        const payer = await resolvePayer(ctx);
        const tx = new AccountAllowanceApproveTransaction();
        for (const s of batch) {
          if (s.kind === "hedera-hbar") tx.approveHbarAllowance(payer, AccountId.fromString(s.spender), Hbar.fromTinybars(0));
          else if (s.kind === "hedera-token") tx.approveTokenAllowance(s.tokenId, payer, AccountId.fromString(s.spender), 0);
          else if (s.kind === "hedera-nft-all") tx.deleteTokenNftAllowanceAllSerials(s.tokenId, payer, AccountId.fromString(s.spender));
        }
        return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
      },
    }));
  }
}
