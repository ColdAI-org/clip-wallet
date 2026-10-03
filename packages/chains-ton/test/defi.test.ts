import "../src/buffer.js";
import { Address, beginCell } from "@ton/core";
import { describe, expect, it } from "vitest";
import {
  DEFI_OP,
  addressCellHex,
  addressFromCellHex,
  cellFromBase64,
  cellToB64,
  jettonBurnBody,
  parseJettonBurn,
  parseJettonTransferFull,
  parsePtonTransfer,
  parseStonfiSwapPayload,
  parseTonstakersDeposit,
  ptonTransferBody,
  stonfiSwapPayload,
  tonstakersDepositBody,
} from "../src/index.js";
import { jettonTransferBody } from "../src/payload.js";

const A = (b: number) => new Address(0, Buffer.alloc(32, b)).toRawString();

describe("DeFi message bodies", () => {
  it("STON.fi v2 swap payload matches the SDK's createSwapBody layout bit for bit", () => {
    const p = { askJettonWallet: A(1), receiver: A(2), refund: A(2), minOut: 12345n, deadline: 1_790_000_900 };
    // Reference: ston-fi/sdk BaseRouterV2_1.createSwapBody with defaults (no referral, no custom payloads).
    const ref = beginCell()
      .storeUint(0x6664de2a, 32)
      .storeAddress(Address.parse(A(1)))
      .storeAddress(Address.parse(A(2)))
      .storeAddress(Address.parse(A(2)))
      .storeUint(p.deadline, 64)
      .storeRef(beginCell().storeCoins(12345n).storeAddress(Address.parse(A(2))).storeCoins(0n).storeMaybeRef(null).storeCoins(0n).storeMaybeRef(null).storeUint(10, 16).storeAddress(null).endCell())
      .endCell();
    const c = stonfiSwapPayload(p);
    expect(c.hash().equals(ref.hash())).toBe(true);
    expect(parseStonfiSwapPayload(c)).toEqual({ askJettonWallet: A(1), refund: A(2), excesses: A(2), deadline: p.deadline, minOut: 12345n, receiver: A(2), referral: null, hasCustomPayloads: false });
  });

  it("pTON ton_transfer round-trips and carries the swap payload by reference", () => {
    const fwd = stonfiSwapPayload({ askJettonWallet: A(1), receiver: A(2), refund: A(2), minOut: 1n, deadline: 1 });
    const c = cellFromBase64(cellToB64(ptonTransferBody({ tonAmount: 10n ** 9n, refund: A(2), forwardPayload: fwd })));
    const t = parsePtonTransfer(c);
    expect(t).toMatchObject({ queryId: 0n, tonAmount: 10n ** 9n, refund: A(2) });
    expect(t.forwardPayload!.hash().equals(fwd.hash())).toBe(true);
  });

  it("jetton transfer with a forward payload parses back in full", () => {
    const fwd = beginCell().storeUint(7, 32).endCell();
    const c = jettonTransferBody({ amount: 5n, destination: Address.parse(A(3)), responseDestination: Address.parse(A(2)), forwardTon: 240_000_000n, forwardPayload: fwd });
    const j = parseJettonTransferFull(c);
    expect(j).toMatchObject({ amount: 5n, destination: A(3), responseDestination: A(2), forwardTon: 240_000_000n, hasCustomPayload: false });
    expect(j.forwardPayload!.hash().equals(fwd.hash())).toBe(true);
  });

  it("Tonstakers deposit and tsTON burn use the pool's op codes", () => {
    const d = tonstakersDepositBody();
    expect(d.beginParse().preloadUint(32)).toBe(0x47d54391);
    expect(parseTonstakersDeposit(d).queryId).toBe(1n);
    const b = jettonBurnBody({ amount: 99n, responseDestination: A(2) });
    expect(b.beginParse().preloadUint(32)).toBe(DEFI_OP.jettonBurn);
    expect(parseJettonBurn(b)).toEqual({ queryId: 0n, amount: 99n, responseDestination: A(2), waitTillRoundEnd: false, fillOrKill: false });
    expect(parseJettonBurn(jettonBurnBody({ amount: 1n, responseDestination: A(2), waitTillRoundEnd: true })).waitTillRoundEnd).toBe(true);
  });

  it("address cells round-trip through hex BoC", () => {
    expect(addressFromCellHex(addressCellHex(A(9)))).toBe(A(9));
  });
});
