import { type ChainContext, ClipError, type Network, type Nft, type TokenBalance, say } from "@clip-wallet/core";
import { looksLikeSpam } from "@clip-wallet/chains-evm";
import { buildDissociate, mirrorFor, resolvePayer } from "@clip-wallet/chains-hedera";
import { formatUnits, queueSteps, type Step } from "@clip-wallet/features";
import { address, createNoopSigner } from "@solana/kit";
import { getBurnCheckedInstruction, getCloseAccountInstruction } from "@solana-program/token";
import type { SecurityHost } from "../host.js";
import { type ParsedTokenAccount, chunk, lamportsText, ownerTokenAccounts, solanaRequest } from "../solana.js";
import { shortAddress } from "../util.js";
import type { CleanupItemView, CleanupOverviewView, CleanupSummaryView, SecurityRunResult, Unavailable } from "../views.js";

/**
 * Spam cleanup.
 *
 * Solana: every token account holds a rent-exempt deposit (≈0.00204 SOL for a 165-byte SPL account; more for
 * Token-2022 accounts with extensions). `CloseAccount` sends it back to you, but only when the balance is
 * zero, so spam is first destroyed with `BurnChecked` (the owner may always burn their own tokens), then
 * closed. Frozen accounts (e.g. programmable NFTs) can be neither burned nor closed by the token program;
 * they are hidden instead. Burning a Metaplex NFT this way leaves its metadata accounts (and their deposit)
 * behind; only Metaplex's own burn returns those, and that instruction would be unreadable on the approval
 * screen, so we don't use it. Sources: github.com/solana-program/token (CloseAccount, BurnChecked),
 * solana.com/docs/core/accounts (rent). Batches: 8 closes or 4 burn+close pairs per transaction.
 *
 * Hedera: `TokenDissociate` removes a token from your account and frees its association slot. The network
 * refuses it while you still hold any of an active token (TRANSACTION_REQUIRES_ZERO_TOKEN_BALANCES /
 * ACCOUNT_STILL_OWNS_NFTS), or when the relation is frozen, but allows it for a deleted token
 * (hiero-consensus-node TokenDissociateFromAccountHandler). So: unused (zero-balance) tokens and deleted
 * spam tokens can be removed; spam you still hold is hidden. We never send spam back to its treasury: HTS
 * custom fees can make that transfer cost you. Batches of 10 tokens per transaction (our own conservative
 * choice).
 *
 * Everything else (EVM, …): you can't destroy someone else's token safely. "Burning" means calling the spam
 * contract, which is exactly what scammers want you to do. Spam is hidden on this device only.
 */
const CLOSE_PER_TX = 8;
const BURN_PER_TX = 4;
const DISSOCIATE_PER_TX = 10;
const HIDDEN_KEY = "security/hidden";

interface Item {
  view: CleanupItemView;
  solana?: ParsedTokenAccount;
  hedera?: { tokenId: string };
}

export const HIDE_NOTE =
  "On Ethereum and similar networks, spam tokens can only be hidden. Getting rid of them would mean calling the spam token's own contract, which is what the scammers want, so Clip Wallet never does that.";

import { hideKey } from "../hide.js";
export { hideKey };

/** A URL, a domain-like ending or a Telegram link in a token's name or symbol (audit SEC-04). */
const LINK_IN_NAME = /https?:\/\/|\bwww\.|t\.me\/|\.(com|io|org|net|xyz|app|site|top|gift|claims?|vip|cc|me|link|pro|live)\b/i;

export class CleanupService {
  private last = new Map<string, Item>();

  constructor(private readonly host: SecurityHost) {}

  /** Ids hidden on this device. The portfolio and collectibles views filter these out. */
  async hidden(): Promise<Set<string>> {
    return new Set((await this.host.kv.get<string[]>(HIDDEN_KEY)) ?? []);
  }

  async unhide(ids: string[]): Promise<void> {
    const h = await this.hidden();
    for (const id of ids) h.delete(id);
    await this.host.kv.set(HIDDEN_KEY, [...h]);
  }

  async scan(): Promise<CleanupOverviewView> {
    const [balances, nfts, hidden] = await Promise.all([this.host.balances().catch(() => [] as TokenBalance[]), this.host.nfts?.().catch(() => [] as Nft[]) ?? [], this.hidden()]);
    const items: Item[] = [];
    const notes = new Map<string, string>();
    const partial: Unavailable[] = [];
    await Promise.all(
      this.host.networks().map(async (n) => {
        try {
          if (n.family === "solana") items.push(...(await this.solana(await this.host.ctx(n.id), balances, nfts)));
          else if (n.family === "hedera") items.push(...(await this.hedera(await this.host.ctx(n.id), balances)));
          else {
            const hides = this.hideOnly(n, balances, nfts);
            if (hides.length && n.family === "evm") notes.set("hide-only:evm", HIDE_NOTE);
            else if (hides.length) notes.set("hide-only:other", "On this network spam can only be hidden from your wallet.");
            items.push(...hides);
          }
        } catch {
          partial.push({ code: "cleanup/unreachable", network: n.name, message: say("bg.security.couldntCheck", { name: n.name }) });
        }
      }),
    );
    for (const it of items) {
      if (hidden.has(it.view.id)) {
        it.view.hidden = true;
        it.view.preselected = false;
      }
    }
    // Already-hidden "hide" items are done; keep them out of the list.
    const live = items.filter((i) => !(i.view.hidden && i.view.action === "hide"));
    this.last = new Map(live.map((i) => [i.view.id, i]));
    return { items: live.map((i) => i.view), notes: [...notes.values()], noteCodes: [...notes.keys()], partial };
  }

  private spam(networkId: string, addr: string, balances: TokenBalance[], symbol: string, name: string): boolean {
    const b = balances.find((x) => x.asset.networkId === networkId && x.asset.address === addr);
    if (b?.asset.spam) return true;
    return looksLikeSpam(b?.asset.symbol ?? symbol, b?.asset.name ?? name);
  }

  private async solana(ctx: ChainContext, balances: TokenBalance[], nfts: Nft[]): Promise<Item[]> {
    const accounts = await ownerTokenAccounts(ctx);
    const out: Item[] = [];
    for (const a of accounts) {
      if (a.isNative) continue;
      const asset = balances.find((x) => x.asset.networkId === ctx.network.id && x.asset.address === a.mint)?.asset;
      const nft = nfts.find((x) => x.networkId === ctx.network.id && x.tokenId === a.mint);
      const isNft = !!nft || (a.decimals === 0 && a.amount === "1");
      const symbol = asset?.symbol ?? nft?.name ?? shortAddress(a.mint);
      const name = asset?.name ?? nft?.collection.name ?? "Unknown token";
      const reclaim = { amount: String(a.lamports), display: `≈${lamportsText(a.lamports)}` };
      // Network actions are per token account (you can hold several for one mint); hiding is per mint.
      const base = { id: `${ctx.network.id}|${a.pubkey}`, family: "solana" as const, kind: isNft ? ("nft" as const) : ("token" as const), symbol, name, networkId: ctx.network.id };
      const frozen = a.state === "frozen";
      if (BigInt(a.amount) === 0n) {
        if (frozen) continue;
        out.push({ solana: a, view: { ...base, balance: "0", reasonCode: "empty-account", action: "close", reason: `Empty ${symbol} account. Closing it gives you back its ${reclaim.display} deposit.`, spam: false, preselected: true, reclaim } });
        continue;
      }
      // Audit SEC-04: a name that merely looks spammy (non-Latin text, "reward", a URL) is set by whoever created
      // the token, so it can make a real asset look like spam. Destroying is preselected only on a verdict from the
      // wallet's token data (indexer/list flags) and never for anything with a price; heuristics only list it.
      const flagged = !!nft?.spam || !!asset?.spam;
      const spam = flagged || this.spam(ctx.network.id, a.mint, balances, symbol, name);
      if (!spam) continue;
      const priced = balances.some((x) => x.asset.networkId === ctx.network.id && x.asset.address === a.mint && (x.fiatValue ?? 0) > 0);
      // A link in the name ("claim at x.com", t.me/…) is what spam tokens exist to advertise; other heuristics
      // (non-Latin text, "reward", "free") also match real assets, so they never preselect a burn.
      const advertises = LINK_IN_NAME.test(`${symbol} ${name}`);
      const preselectBurn = (flagged || advertises) && !priced;
      const balance = isNft ? "1 NFT" : `${formatUnits(a.amount, a.decimals)} ${symbol}`;
      if (frozen) {
        out.push({ solana: a, view: { ...base, id: hideKey(ctx.network.id, a.mint), balance, reasonCode: "spam-locked", action: "hide", reason: "Spam that can't be destroyed (it's locked by its creator), so Clip Wallet hides it.", spam, preselected: true } });
      } else {
        out.push({ solana: a, view: { ...base, balance, reasonCode: "spam-burn", action: "burn-close", reason: `Spam. Destroying it and closing its account gives you back ${reclaim.display}.`, spam, preselected: preselectBurn, reclaim } });
      }
    }
    return out;
  }

  private async hedera(ctx: ChainContext, balances: TokenBalance[]): Promise<Item[]> {
    const mirror = mirrorFor(ctx);
    let payer: string;
    try {
      payer = await resolvePayer(ctx, mirror);
    } catch {
      return [];
    }
    const rels = await mirror.tokenRelationships(payer);
    const out: Item[] = [];
    for (const r of rels) {
      const info = (await mirror.token(r.token_id).catch(() => null)) as (Awaited<ReturnType<typeof mirror.token>> & { deleted?: boolean; treasury_account_id?: string }) | null;
      if (info?.treasury_account_id === payer || r.freeze_status === "FROZEN") continue;
      const symbol = info?.symbol || r.token_id;
      const name = info?.name || "Token";
      const isNft = info?.type === "NON_FUNGIBLE_UNIQUE";
      const spam = this.spam(ctx.network.id, r.token_id, balances, symbol, name);
      const base = { id: hideKey(ctx.network.id, r.token_id), family: "hedera" as const, kind: isNft ? ("nft" as const) : ("token" as const), symbol, name, networkId: ctx.network.id };
      if (BigInt(r.balance) === 0n) {
        out.push({
          hedera: { tokenId: r.token_id },
          view: { ...base, id: `${base.id}|dissociate`, balance: "0", action: "dissociate", reasonCode: spam ? "spam-gone" : "unused-token", reason: spam ? "Spam you don't hold any more. Removing it frees a token slot." : "You don't hold any. Removing it frees a token slot; you can add it back any time.", spam, preselected: spam },
        });
        continue;
      }
      if (!spam) continue;
      const balance = isNft ? `${r.balance} NFT${r.balance === 1 ? "" : "s"}` : `${formatUnits(String(r.balance), Number(info?.decimals ?? r.decimals ?? 0))} ${symbol}`;
      if (info?.deleted) {
        out.push({ hedera: { tokenId: r.token_id }, view: { ...base, id: `${base.id}|dissociate`, balance, action: "dissociate", reasonCode: "spam-deleted", reason: "Spam whose creator deleted it. Removing it clears it from your account.", spam, preselected: true } });
      } else {
        out.push({
          hedera: { tokenId: r.token_id },
          view: { ...base, balance, reasonCode: "spam-held-hedera", action: "hide", reason: "Spam you still hold. Hedera only removes tokens you hold none of, and sending it back can cost fees, so Clip Wallet hides it.", spam, preselected: true },
        });
      }
    }
    return out;
  }

  private hideOnly(n: Network, balances: TokenBalance[], nfts: Nft[]): Item[] {
    const out: Item[] = [];
    for (const b of balances) {
      if (b.asset.networkId !== n.id || !b.asset.address || !b.asset.spam || BigInt(b.amount) === 0n) continue;
      out.push({
        view: {
          id: hideKey(n.id, b.asset.address),
          family: n.family,
          kind: "token",
          symbol: b.asset.symbol,
          name: b.asset.name,
          balance: `${formatUnits(b.amount, b.asset.decimals)} ${b.asset.symbol}`,
          action: "hide",
          reasonCode: "spam-hide", reason: "Spam. Hidden from your wallet; nothing happens on the network.",
          spam: true,
          preselected: true,
          networkId: n.id,
        },
      });
    }
    for (const t of nfts) {
      if (t.networkId !== n.id || !t.spam) continue;
      out.push({
        view: {
          id: hideKey(n.id, t.collection.address, t.tokenId),
          family: n.family,
          kind: "nft",
          symbol: t.name ?? t.collection.name,
          name: t.collection.name,
          balance: "1 NFT",
          action: "hide",
          reasonCode: "spam-nft-hide", reason: "Spam NFT. Hidden from your wallet; nothing happens on the network. Don't open its links.",
          spam: true,
          preselected: true,
          networkId: n.id,
        },
      });
    }
    return out;
  }

  private chosen(ids: string[]): Item[] {
    const items = ids.map((id) => this.last.get(id)).filter((i): i is Item => !!i);
    if (!items.length) throw new ClipError("Pick at least one item to clean up.", "cleanup/none");
    return items;
  }

  async preview(ids: string[]): Promise<CleanupSummaryView> {
    if (!this.last.size) await this.scan();
    const items = this.chosen(ids);
    const count = (a: string) => items.filter((i) => i.view.action === a);
    const close = count("close");
    const burn = count("burn-close");
    const diss = count("dissociate");
    const hide = count("hide");
    const lamports = [...close, ...burn].reduce((s, i) => s + BigInt(i.view.reclaim?.amount ?? "0"), 0n);
    const lines: string[] = [];
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    if (close.length) lines.push(`Close ${plural(close.length, "empty account", "empty accounts")}`);
    if (burn.length) lines.push(`Destroy and close ${plural(burn.length, "spam token", "spam tokens")}`);
    if (diss.length) lines.push(`Remove ${plural(diss.length, "token", "tokens")} from your Hedera account`);
    if (hide.length) lines.push(`Hide ${plural(hide.length, "item", "items")} (only on this device)`);
    // Per network: one transaction per batch.
    let approvals = 0;
    for (const net of new Set(items.map((i) => i.view.networkId))) {
      const on = (xs: Item[]) => xs.filter((x) => x.view.networkId === net).length;
      approvals += Math.ceil(on(close) / CLOSE_PER_TX) + Math.ceil(on(burn) / BURN_PER_TX) + Math.ceil(on(diss) / DISSOCIATE_PER_TX);
    }
    return {
      headline: lamports > 0n ? `Get back ~${lamportsText(lamports)}` : hide.length === items.length ? "Tidy up your wallet" : "Clean up your wallet",
      lines,
      approvals,
      reclaimLamports: lamports.toString(),
      counts: { close: close.length, "burn-close": burn.length, dissociate: diss.length, hide: hide.length },
    };
  }

  /** Hide right away; queue every network action on the normal approval path. */
  async run(ids: string[]): Promise<SecurityRunResult> {
    if (!this.last.size) await this.scan();
    const items = this.chosen(ids);
    const hides = items.filter((i) => i.view.action === "hide");
    if (hides.length) {
      const h = await this.hidden();
      for (const i of hides) h.add(i.view.id);
      await this.host.kv.set(HIDDEN_KEY, [...h]);
    }
    const steps: Step[] = [];
    const byNet = new Map<string, Item[]>();
    for (const i of items.filter((x) => x.view.action !== "hide")) byNet.set(i.view.networkId, [...(byNet.get(i.view.networkId) ?? []), i]);
    for (const [networkId, group] of byNet) {
      const ctx = await this.host.ctx(networkId);
      if (ctx.network.family === "solana") steps.push(...this.solanaSteps(group, ctx));
      if (ctx.network.family === "hedera") {
        const tokenIds = group.filter((g) => g.view.action === "dissociate").map((g) => g.hedera!.tokenId);
        for (const batch of chunk(tokenIds, DISSOCIATE_PER_TX)) {
          steps.push({ title: batch.length === 1 ? "Remove 1 token from your account" : `Remove ${batch.length} tokens from your account`, request: () => buildDissociate(batch, ctx) });
        }
      }
    }
    if (!steps.length) return { hidden: hides.length };
    const queued = await queueSteps(this.host, steps, "Clip Wallet", () => this.last.clear());
    return { queued, hidden: hides.length };
  }

  private solanaSteps(group: Item[], ctx: ChainContext): Step[] {
    const me = address(ctx.account.address);
    const signer = createNoopSigner(me);
    const steps: Step[] = [];
    const closeIx = (a: ParsedTokenAccount) => getCloseAccountInstruction({ account: address(a.pubkey), destination: me, owner: signer }, { programAddress: address(a.program) });
    const closes = group.filter((g) => g.view.action === "close").map((g) => g.solana!);
    for (const batch of chunk(closes, CLOSE_PER_TX)) {
      const back = batch.reduce((s, a) => s + BigInt(a.lamports), 0n);
      steps.push({
        title: batch.length === 1 ? "Close 1 empty token account" : `Close ${batch.length} empty token accounts`,
        lines: [{ label: "You get back", value: `≈${lamportsText(back)}` }],
        request: () => solanaRequest(batch.map(closeIx), ctx),
      });
    }
    const burns = group.filter((g) => g.view.action === "burn-close").map((g) => g.solana!);
    for (const batch of chunk(burns, BURN_PER_TX)) {
      const back = batch.reduce((s, a) => s + BigInt(a.lamports), 0n);
      steps.push({
        title: batch.length === 1 ? "Destroy 1 spam token and close its account" : `Destroy ${batch.length} spam tokens and close their accounts`,
        lines: [{ label: "You get back", value: `≈${lamportsText(back)}` }],
        request: () =>
          solanaRequest(
            batch.flatMap((a) => [
              getBurnCheckedInstruction(
                { account: address(a.pubkey), mint: address(a.mint), authority: signer, amount: BigInt(a.amount), decimals: a.decimals },
                { programAddress: address(a.program) },
              ),
              closeIx(a),
            ]),
            ctx,
          ),
      });
    }
    return steps;
  }
}
