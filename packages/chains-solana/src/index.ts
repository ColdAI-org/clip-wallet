export { type Described, MEMO_PROGRAMS, TOKEN_ACCOUNT_RENT_LAMPORTS, describeTransaction, plainSolanaError, simulate } from "./describe.js";
export * from "./module.js";
export * from "./networks.js";
export { RpcError, SolanaRpc } from "./rpc.js";
export { type SignInInput, createSignInMessageText } from "./siws.js";
export { METADATA_PROGRAM, TOKEN_2022_PROGRAM, clearTokenCache, metadataPda, parseMetaplexMetadata } from "./tokens.js";
export { looksLikeTransaction, parseTransaction } from "./tx.js";

import { createSolanaModule } from "./module.js";
export const solanaModule = createSolanaModule();
