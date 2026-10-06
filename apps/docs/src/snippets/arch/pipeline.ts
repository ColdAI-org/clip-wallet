// The path every request takes in the background, reduced to its steps. The real code is WalletService in
// @clip-wallet/extension-kit (and WalletEngine in @clip-wallet/engine), which also adds security checks, plugin
// notes, route planning and hardware wallets.
import { ClipError, decodeFailureReason, sanitizeDecoded, type ChainContext, type ChainModule, type DappRequest, type DecodedRequest } from "@clip-wallet/core";
// Type-only: only the background, the mobile and desktop hosts and onboarding may import the vault's code.
import type { ClipVault, hashSignablePayload } from "@clip-wallet/vault";

export async function handle(
  request: DappRequest,
  module: ChainModule,
  ctx: ChainContext,
  vault: ClipVault,
  hash: typeof hashSignablePayload,
  ask: (decoded: DecodedRequest) => Promise<boolean>,
): Promise<unknown> {
  // 1. Decode into plain words. A module that can't read the request makes it blind, with its reason attached.
  let decoded: DecodedRequest;
  try {
    decoded = await module.decode(request, ctx);
  } catch (e) {
    decoded = {
      requestId: request.id,
      title: "Unreadable request",
      lines: [],
      balanceChanges: [],
      simulated: false,
      blind: true,
      warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this request." }, ...decodeFailureReason(e)],
      networkId: ctx.network.id,
    };
  }

  // 2. Strip invisible and direction-changing characters from everything the screen will show.
  decoded = sanitizeDecoded(decoded);

  // 3. Ask the person. Blind requests are refused unless Advanced mode is on and they override it.
  if (decoded.blind) throw new ClipError("This request can't be read, so it was blocked.", "approval/blind-blocked");
  if (!(await ask(decoded))) throw new ClipError("You declined this request.", "user-rejected");

  // 4. Build what must be signed, then bind the vault to exactly those payloads, once, for two minutes.
  const approvalId = crypto.randomUUID();
  const payloads = await module.prepare(request, ctx, approvalId);
  vault.registerApproval(approvalId, payloads.map((p) => hash(p)), 2 * 60_000);
  try {
    const signatures = [];
    for (const payload of payloads) signatures.push(await vault.sign(payload)); // each hash signs once
    // 5. Assemble, broadcast if the method asks for it, and answer the dapp.
    return await module.finalize(request, signatures, ctx);
  } catch (e) {
    vault.revokeApproval(approvalId);
    throw e;
  }
}
