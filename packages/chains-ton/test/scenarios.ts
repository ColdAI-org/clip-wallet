import { commentCell } from "../src/index.js";
import { BOB, JETTON_MASTER, NFT_ITEM, addr, req } from "./helpers.js";

/** Requests whose signing payloads are precomputed in signatures.ts (shared with the offline generator). */
export const scenarios = (meRaw: string) => ({
  /** Active wallet, seqno 5: 1.5 GRAM with a comment + 0.2 GRAM to a bounceable contract address. */
  send: req("sendTransaction", [JSON.stringify({
    valid_until: 1_790_000_100,
    network: "-3",
    from: meRaw,
    messages: [
      { address: BOB, amount: "1500000000", payload: commentCell("thanks!").toBoc().toString("base64") },
      { address: addr(0xc0, true), amount: "200000000" },
    ],
  })], "send"),
  /** Uninitialized wallet (seqno 0, StateInit attached): 0.5 GRAM. */
  firstUse: req("sendTransaction", { network: "-3", messages: [{ address: BOB, amount: "500000000" }] }, "first"),
  /** Structured items: a jetton transfer and an NFT transfer. */
  items: req("sendTransaction", {
    network: "-3",
    items: [
      { type: "jetton", master: JETTON_MASTER, destination: BOB, amount: "2500000" },
      { type: "nft", nftAddress: NFT_ITEM, newOwner: BOB },
    ],
  }, "items"),
  signText: req("signData", [JSON.stringify({ type: "text", text: "Sign in to app.example", network: "-3", from: meRaw })], "sd-text"),
  signBinary: req("signData", { type: "binary", bytes: "AQID" }, "sd-bin"),
  signCell: req("signData", { type: "cell", schema: "message#_ text:^Cell = InMsgBody;", cell: commentCell("cell!").toBoc().toString("base64") }, "sd-cell"),
  proof: req("ton_proof", { payload: "nonce-123" }, "proof"),
});
