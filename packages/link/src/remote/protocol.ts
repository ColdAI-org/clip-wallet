/**
 * Remote-signer messages, sent inside a SecureSession (already encrypted and authenticated). The device holding
 * the keys (desktop app, phone) still validates every message: being paired doesn't make a peer's input safe.
 *
 *   extension → signer   accounts | connect | request | cancel | handoff | ping
 *   signer → extension   accounts | decoded | result | handoff | pong
 */
import { z } from "zod";
import { FAMILIES } from "@clip-wallet/core";

const family = z.enum(FAMILIES as unknown as [string, ...string[]]);
const origin = z.string().url().max(500).refine((o) => /^https?:\/\//.test(o), "http(s) origin");
const id = z.string().min(1).max(200);

export const DappRequestWire = z.object({
  id,
  origin,
  via: z.enum(["injected", "walletconnect"]),
  family,
  networkId: z.string().min(1).max(200),
  method: z.string().min(1).max(200),
  params: z.unknown(),
});

export const Handoff = z.object({ t: z.literal("handoff"), url: z.string().url().max(2000).startsWith("https://"), token: z.string().max(4000).optional() });

export const ToSigner = z.discriminatedUnion("t", [
  z.object({ t: z.literal("accounts") }),
  z.object({
    t: z.literal("connect"),
    id,
    origin,
    family,
    networkId: z.string().min(1).max(200),
    name: z.string().max(100).optional(),
    iconUrl: z.string().max(500).optional(),
  }),
  z.object({ t: z.literal("request"), id, request: DappRequestWire, dapp: z.object({ name: z.string().max(100).optional(), iconUrl: z.string().max(500).optional() }).optional() }),
  z.object({ t: z.literal("cancel"), id }),
  z.object({ t: z.literal("ping") }),
  Handoff,
]);
export type ToSigner = z.infer<typeof ToSigner>;

export interface PublicAccount {
  id: string;
  family: string;
  address: string;
  publicKey: string;
  index: number;
  curve: string;
  derivationPath: string;
  hederaAccountId?: string;
}

const publicAccount = z.object({
  id: z.string().max(100),
  family,
  address: z.string().max(200),
  publicKey: z.string().max(300),
  index: z.number().int().min(0),
  curve: z.string().max(40),
  derivationPath: z.string().max(200),
  hederaAccountId: z.string().max(40).optional(),
});

export const FromSigner = z.discriminatedUnion("t", [
  z.object({ t: z.literal("accounts"), accounts: z.array(publicAccount).max(200) }),
  z.object({
    t: z.literal("decoded"),
    id,
    title: z.string().max(300),
    lines: z.array(z.object({ label: z.string().max(100), value: z.string().max(500) })).max(40),
    blind: z.boolean(),
  }),
  z.object({
    t: z.literal("result"),
    id,
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.object({ userMessage: z.string().max(500), code: z.string().max(100) }).optional(),
  }),
  z.object({ t: z.literal("pong") }),
  Handoff,
]);
export type FromSigner = z.infer<typeof FromSigner>;

/** Only the public parts of an account cross the link. */
export function toPublicAccount(a: PublicAccount & Record<string, unknown>): PublicAccount {
  return {
    id: a.id,
    family: a.family,
    address: a.address,
    publicKey: a.publicKey,
    index: a.index,
    curve: a.curve,
    derivationPath: a.derivationPath,
    ...(a.hederaAccountId ? { hederaAccountId: a.hederaAccountId } : {}),
  };
}
