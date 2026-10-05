import { msg, titleMsgOf, type Msg } from "./msg.js";

/**
 * The activity entry's Msg for an approved request, mirroring how the background words the English title
 * ("Paid {app} …", "Sent …", "Signed in to …", "Approved: …"). `english` is that English title (the fallback).
 * Undefined when the request's title has no Msg (the entry then stays English).
 */
export function activityTitleMsg(decoded: { title: string; titleMsg?: Msg }, app: { name: string }, english: string): Msg | undefined {
  const t = titleMsgOf(decoded);
  if (!t) return undefined;
  const v = t.values ?? {};
  if (t.id === "bg.req.pay" && v.amount !== undefined) return msg("bg.act.paid", { app: app.name, amount: v.amount }, english);
  if (t.id === "bg.req.sendTo" && v.amount !== undefined && v.to !== undefined) return msg("bg.act.sent", { amount: v.amount, to: v.to }, english);
  if (t.id === "bg.req.sendSymbolTo" && v.amount !== undefined && v.symbol !== undefined && v.to !== undefined)
    return msg("bg.act.sent", { amount: `${typeof v.amount === "object" ? v.amount.fallback : v.amount} ${typeof v.symbol === "object" ? v.symbol.fallback : v.symbol}`, to: v.to }, english);
  if (t.id === "bg.req.signIn" && v.domain !== undefined) return msg("bg.act.signedIn", { domain: v.domain }, english);
  return msg("bg.act.approved", { what: t }, english);
}

/** "Connected to {app}". */
export function connectedMsg(app: string): Msg {
  return msg("bg.act.connected", { app });
}
