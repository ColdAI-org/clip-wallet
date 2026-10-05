/**
 * EIP-5792 Wallet Call API on the injected EVM provider (router side). Only active when the host passes
 * `calls` to createOneMaskRouter; without it these methods stay "unsupported" (4200) exactly as before.
 *
 *   wallet_getCapabilities  connected sites only (4100 otherwise); `atomic: unsupported` per chain (EOA) and
 *                           ERC-7682 `auxiliaryFunds` where the host can bring in money.
 *   wallet_sendCalls        validated here, then ONE approval through the normal path (`handle`, method
 *                           "wallet_sendCalls" on the request's chain); the host decodes every call.
 *   wallet_getCallsStatus   / wallet_showCallsStatus: the host's record, per origin (5730 for anything else).
 */
import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { rpcError } from "../shared/errors.js";
import { evmChainId, findEvmNetwork, parseChainId, toHexChainId } from "../shared/networks.js";
import {
  CallsErrorCode,
  callsError,
  chainCapabilities,
  parseSendCalls,
  type CallsHost,
  type ChainCapabilities,
  type Hex,
  type SendCallsParams,
} from "../shared/calls.js";

export interface CallsRouterHelpers {
  permitted(origin: string, family: Family): Promise<boolean>;
  accounts(origin: string, family: Family): Promise<{ address: string }[]>;
  approve(req: DappRequest): Promise<unknown>;
  makeReq(origin: string, family: Family, net: Network, method: string, params: unknown): DappRequest;
  candidates(family: Family): Network[];
}

export function createCallsDispatch(h: CallsRouterHelpers, host: CallsHost) {
  const own = async (origin: string, address: unknown): Promise<string> => {
    if (!(await h.permitted(origin, "evm"))) throw rpcError.unauthorized();
    const list = await h.accounts(origin, "evm");
    if (address === undefined) {
      const first = list[0]?.address;
      if (!first) throw rpcError.unauthorized();
      return first;
    }
    const hit = typeof address === "string" ? list.find((a) => a.address.toLowerCase() === address.toLowerCase()) : undefined;
    if (!hit) throw rpcError.unauthorized("That account is not connected to this site.");
    return hit.address;
  };

  const idParam = (params: unknown[]): string => {
    const id = params[0];
    if (typeof id !== "string" || id.length === 0 || id.length > 8194) throw rpcError.invalidParams("Expected [batch id].");
    return id;
  };

  return async (origin: string, method: string, params: unknown[]): Promise<unknown> => {
    switch (method) {
      case "wallet_getCapabilities": {
        await own(origin, params[0]);
        const wanted = params[1];
        if (wanted !== undefined && !Array.isArray(wanted)) throw rpcError.invalidParams("Expected [address, [chainId, ...]].");
        const all = h.candidates("evm");
        // Chains the wallet doesn't have are left out, never an error (EIP-5792).
        const nets = wanted === undefined ? all : wanted.map((c) => (parseChainId(c) ? findEvmNetwork(all, parseChainId(c)!) : undefined)).filter((n): n is Network => !!n);
        const aux = await host.auxiliaryFunds(nets.map((n) => n.id));
        const out: Record<string, ChainCapabilities> = {};
        for (const n of nets) out[toHexChainId(evmChainId(n)!)] = chainCapabilities(aux[n.id]);
        return out;
      }
      case "wallet_sendCalls": {
        const raw = params[0] as { chainId?: unknown } | undefined;
        if (!(await h.permitted(origin, "evm"))) throw rpcError.unauthorized();
        const chainId = parseChainId(raw?.chainId);
        const net = chainId !== undefined ? findEvmNetwork(h.candidates("evm"), chainId) : undefined;
        if (chainId !== undefined && !net) throw callsError(CallsErrorCode.UnsupportedChain, `Clip Wallet does not support chain ${String(raw?.chainId).slice(0, 20)}.`);
        const aux = net ? (await host.auxiliaryFunds([net.id]))[net.id] : undefined;
        const p = parseSendCalls(raw, { auxiliaryFunds: !!aux?.supported });
        if (!net) throw rpcError.invalidParams("chainId must be a hex string like 0x1.");
        const from = (await own(origin, p.from)) as Hex;
        // EOA accounts: no atomicity guarantee to offer, and no upgrade path (`atomic: unsupported`).
        if (p.atomicRequired) throw callsError(CallsErrorCode.AtomicityNotSupported, "Clip Wallet can't run these calls as one all-or-nothing transaction.");
        const normalized: SendCallsParams = { ...p, from, chainId: toHexChainId(chainId!) as Hex };
        return h.approve(h.makeReq(origin, "evm", net, "wallet_sendCalls", [normalized]));
      }
      case "wallet_getCallsStatus": {
        const status = await host.status(origin, idParam(params));
        if (!status) throw callsError(CallsErrorCode.UnknownBundle, "Clip Wallet doesn't know that batch.");
        return status;
      }
      case "wallet_showCallsStatus": {
        if (!(await host.show(origin, idParam(params)))) throw callsError(CallsErrorCode.UnknownBundle, "Clip Wallet doesn't know that batch.");
        return null;
      }
    }
    throw rpcError.unsupportedMethod(method);
  };
}
