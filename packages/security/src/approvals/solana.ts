import type { AssetRef, ChainContext } from "@clip-wallet/core";
import { formatUnits, type Step } from "@clip-wallet/features";
import { address, createNoopSigner } from "@solana/kit";
import { getRevokeInstruction } from "@solana-program/token";
import { spenderName } from "../labels.js";
import { chunk, ownerTokenAccounts, solanaRequest } from "../solana.js";
import { shortAddress } from "../util.js";
import { type ApprovalScanner, type Grant, type RevokeSpec, type ScanOptions, type ScanResult, grantId, risksFor } from "./types.js";

/**
 * Solana standing permissions: an SPL Token / Token-2022 `Approve` sets a `delegate` (and `delegatedAmount`)
 * on ONE token account; the delegate can move up to that amount without asking. Found with
 * getTokenAccountsByOwner (jsonParsed exposes `delegate` / `delegatedAmount`), revoked with the token
 * program's `Revoke` instruction (owner signs; https://github.com/solana-program/token). Revokes for one
 * network go into as few transactions as fit (8 per transaction, well under the 1232-byte limit).
 * The Solana module decodes Revoke in plain words, so these approvals are never blind.
 */
const UNLIMITED = 2n ** 63n;
const PER_TX = 8;

export class SolanaApprovals implements ApprovalScanner {
  readonly family = "solana" as const;

  constructor(private readonly assets: () => AssetRef[] = () => []) {}

  async scan(ctx: ChainContext, opts: ScanOptions): Promise<ScanResult> {
    const accounts = await ownerTokenAccounts(ctx);
    const grants: Grant[] = [];
    for (const a of accounts) {
      if (!a.delegate || !a.delegatedAmount || BigInt(a.delegatedAmount) === 0n) continue;
      const known = this.assets().find((x) => x.networkId === ctx.network.id && x.address === a.mint);
      const symbol = known?.symbol ?? shortAddress(a.mint);
      const delegated = BigInt(a.delegatedAmount);
      const unlimited = delegated >= UNLIMITED;
      const all = unlimited || delegated >= BigInt(a.amount);
      const name = spenderName("solana", a.delegate);
      const who = name ?? "An unknown app";
      const spec: RevokeSpec = { kind: "spl", tokenAccount: a.pubkey, programId: a.program };
      const amountText = unlimited ? `All your ${symbol}` : `Up to ${formatUnits(delegated, a.decimals)} ${symbol}`;
      grants.push({
        revoke: spec,
        view: {
          id: grantId(ctx.network.id, spec),
          kind: "spl-delegate",
          family: "solana",
          title: all ? `${who} can spend all your ${symbol}` : `${who} can spend up to ${formatUnits(delegated, a.decimals)} ${symbol}`,
          asset: { symbol, name: known?.name ?? "Token", address: a.mint },
          spender: { address: a.delegate, name, known: !!name },
          amount: amountText,
          unlimited,
          ...risksFor({ unlimited, spenderKnown: !!name, flagged: opts.isFlagged(a.delegate), now: opts.now, oldAfterDays: opts.oldAfterDays }),
          networkId: ctx.network.id,
        },
      });
    }
    return { grants, partial: [] };
  }

  async revoke(grants: Grant[], ctx: ChainContext): Promise<Step[]> {
    const me = createNoopSigner(address(ctx.account.address));
    const specs = grants.map((g) => g.revoke).filter((s): s is Extract<RevokeSpec, { kind: "spl" }> => s.kind === "spl");
    return chunk(specs, PER_TX).map((batch) => ({
      title: batch.length === 1 ? "Remove 1 spending permission" : `Remove ${batch.length} spending permissions`,
      lines: [{ label: "What happens", value: "The apps lose their permission. Nothing is moved." }],
      request: () =>
        solanaRequest(
          batch.map((s) => getRevokeInstruction({ source: address(s.tokenAccount), owner: me }, { programAddress: address(s.programId) })),
          ctx,
        ),
    }));
  }
}
