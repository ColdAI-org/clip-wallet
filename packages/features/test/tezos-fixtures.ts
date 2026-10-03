import type { ChainContext, DappRequest, Network } from "@clip-wallet/core";
import { ProtocolsHash, TezosRpc, buildOperation, createTezosModule, parseForged, type PartialTezosOperation, type TezosOperation } from "@clip-wallet/chains-tezos";
import { expect } from "vitest";
import type { Route } from "./helpers.js";

/** Public "abandon … about" Tezos account (chains-tezos test/signatures.ts FIX). Public key only. */
export const TZ_ME = "tz1VQA4RP4fLjEEMW2FR4pE9kAg5abb5h5GL";
export const TZ_PUB = "370ffb098088e67f8284ca4938f8f1eac02c3e2ab150f29adc8a7075a5ce7e63";
export const TZ_EDPK = "edpku4US3ZykcZifjzSGFCmFr3zRgCKndE82estE4irj4d5oqDNDvf";
export const BRANCH = "BMKoX9sSJgN6nvfLK1j6dZpru7q49uyzWnSbCe8v4cYJXR59WVc";

export function tezosCtx(network: Network, fetchImpl: typeof fetch): ChainContext {
  return {
    network,
    account: { id: "tezos:0", family: "tezos", index: 0, curve: "ed25519", derivationPath: "m/44'/1729'/0'/0'", publicKey: TZ_PUB, address: TZ_ME },
    fetch: fetchImpl,
  };
}

/** Node routes a build needs (revealed account, counter, branch) plus TzKT defaults for decode lookups. */
export const NODE_ROUTES: Route[] = [
  [/\/blocks\/head~2\/hash$/, BRANCH],
  [new RegExp(`/contracts/${TZ_ME}/manager_key$`), TZ_EDPK],
  [new RegExp(`/contracts/${TZ_ME}/counter$`), "25155453"],
];
export const TZKT_DEFAULTS: Route[] = [
  [/\/v1\/tokens\?/, []],
  [/\/v1\/accounts\/[^/?]+$/, null],
];

export function operationsOf(r: DappRequest): PartialTezosOperation[] {
  expect(r).toMatchObject({ family: "tezos", method: "tezos_send", origin: "clip-wallet" });
  return (r.params as { operations: PartialTezosOperation[] }).operations;
}

/** Forge the request's operations with @taquito/local-forging (via chains-tezos) and parse the bytes back. */
export async function forgeAndParse(r: DappRequest, ctx: ChainContext): Promise<TezosOperation[]> {
  const built = await buildOperation(new TezosRpc(ctx.network.rpcUrls[0]!, ctx.fetch), operationsOf(r), {
    me: TZ_ME,
    publicKey: TZ_EDPK,
    chainId: ctx.network.id.replace(/^tezos:/, ""),
    simulate: false,
    protocol: ProtocolsHash.PsUshuai9,
  });
  const parsed = await parseForged(built.forged);
  expect(parsed.branch).toBe(BRANCH);
  for (const op of parsed.contents) expect(op.source).toBe(TZ_ME);
  return parsed.contents;
}

/** The chain module's own plain-language description (no simulation). */
export async function decodeTitle(r: DappRequest, ctx: ChainContext): Promise<{ title: string; blind: boolean; lines: { label: string; value: string }[] }> {
  const d = await createTezosModule({ simulate: false }).decode(r, ctx);
  return { title: d.title, blind: d.blind, lines: d.lines };
}
