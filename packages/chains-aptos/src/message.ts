/**
 * AIP-62 `aptos:signMessage`. The standard fixes the output fields (prefix "APTOS", address, application, chainId,
 * message, nonce, fullMessage) but not the layout of fullMessage. Wallets in the wild build it as below (Trust Wallet's
 * AptosProvider, Petra's docs show the same prefix and "key: value" lines): the prefix, then each optional field the
 * dapp asked for, then message and nonce, joined by "\n". The ed25519 signature covers the UTF-8 bytes of fullMessage.
 */
export interface SignMessageInput {
  message: string;
  nonce: string;
  address?: boolean;
  application?: boolean;
  chainId?: boolean;
}

export interface SignMessageFields {
  address?: string;
  application?: string;
  chainId?: number;
  fullMessage: string;
  message: string;
  nonce: string;
  prefix: "APTOS";
}

export function buildFullMessage(input: SignMessageInput, ctx: { address: string; application: string; chainId: number | null }): SignMessageFields {
  const out: SignMessageFields = { fullMessage: "", message: input.message, nonce: input.nonce, prefix: "APTOS" };
  let full = "APTOS";
  if (input.address) {
    out.address = ctx.address;
    full += `\naddress: ${ctx.address}`;
  }
  if (input.application) {
    out.application = ctx.application;
    full += `\napplication: ${ctx.application}`;
  }
  if (input.chainId && ctx.chainId != null) {
    out.chainId = ctx.chainId;
    full += `\nchainId: ${ctx.chainId}`;
  }
  full += `\nmessage: ${input.message}\nnonce: ${input.nonce}`;
  out.fullMessage = full;
  return out;
}
