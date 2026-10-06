import { decode, encode, encodeForSigning } from "ripple-binary-codec";
import { hashes } from "xrpl";
import { describe, expect, it } from "vitest";
import { UnsupportedField, derSignature, serializeObject, signingPayload, txHash, vlPrefix } from "../src/codec.js";
import { decodeXAddress, encodeXAddress, isClassicAddress } from "../src/address.js";
import { fromHex, hex } from "../src/util.js";

const ME = "rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3";
const BOB = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const RLUSD = "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV";
const PUB = "031D68BC1A142E6766B2BDFB006CCFE135EF2E0E2E94ABB5CF5C9AB6104776FBAE";
const base = { Account: ME, Fee: "12", Sequence: 7, LastLedgerSequence: 21322700, SigningPubKey: PUB, Flags: 0 };

/** The same JSON both ways: ripple-binary-codec (xrpl.js) and this package must produce identical bytes. */
const CASES: Record<string, Record<string, unknown>>[] = [
  { xrpPayment: { ...base, TransactionType: "Payment", Destination: BOB, Amount: "1500000", DestinationTag: 42 } },
  { iouPayment: { ...base, TransactionType: "Payment", Destination: BOB, Amount: { currency: "524C555344000000000000000000000000000000", issuer: RLUSD, value: "2.5" }, Memos: [{ Memo: { MemoType: "746578742F706C61696E", MemoData: "68656C6C6F" } }, { Memo: { MemoData: "00" } }] } },
  { partial: { ...base, TransactionType: "Payment", Flags: 131072, Destination: BOB, Amount: { currency: "USD", issuer: RLUSD, value: "1000000" }, SendMax: "1000000000", DeliverMin: { currency: "USD", issuer: RLUSD, value: "1e-7" }, Paths: [[{ currency: "USD", issuer: RLUSD }], [{ account: BOB }, { currency: "XRP" }]] } },
  { trust: { ...base, TransactionType: "TrustSet", Flags: 131072, LimitAmount: { currency: "USD", issuer: RLUSD, value: "1000000000" }, QualityIn: 0 } },
  { offer: { ...base, TransactionType: "OfferCreate", TakerGets: "15000000", TakerPays: { currency: "USD", issuer: RLUSD, value: "-0.001234567890123456" }, Expiration: 800000000 } },
  { cancel: { ...base, TransactionType: "OfferCancel", OfferSequence: 5 } },
  { accountSet: { ...base, TransactionType: "AccountSet", SetFlag: 8, Domain: "6578616D706C652E636F6D", TransferRate: 1002000000, TickSize: 5, EmailHash: "98B4375E1D753E5B91627516F6D70977" } },
  { regularKey: { ...base, TransactionType: "SetRegularKey", RegularKey: BOB } },
  { signerList: { ...base, TransactionType: "SignerListSet", SignerQuorum: 2, SignerEntries: [{ SignerEntry: { Account: BOB, SignerWeight: 1 } }, { SignerEntry: { Account: RLUSD, SignerWeight: 1 } }] } },
  { del: { ...base, Fee: "200000", TransactionType: "AccountDelete", Destination: BOB, DestinationTag: 13 } },
  { mint: { ...base, TransactionType: "NFTokenMint", NFTokenTaxon: 0, Flags: 8, TransferFee: 500, URI: "697066733A2F2F62616679" } },
  { nftOffer: { ...base, TransactionType: "NFTokenCreateOffer", NFTokenID: "000B013A95F14B0044F78A264E41713C64B5F89242540EE208C3098E00000D65", Amount: "1000000", Flags: 1 } },
  { nftAccept: { ...base, TransactionType: "NFTokenAcceptOffer", NFTokenSellOffer: "68CD1F6F906494EA08C9CB5CAFA64DFA90D4E834B7151899B73231DE5A0C3B77" } },
  { nftCancel: { ...base, TransactionType: "NFTokenCancelOffer", NFTokenOffers: ["68CD1F6F906494EA08C9CB5CAFA64DFA90D4E834B7151899B73231DE5A0C3B77"] } },
  { escrow: { ...base, TransactionType: "EscrowCreate", Destination: BOB, Amount: "10000", FinishAfter: 800000000, CancelAfter: 800086400, Condition: "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100" } },
  { amm: { ...base, TransactionType: "AMMDeposit", Flags: 1048576, Asset: { currency: "XRP" }, Asset2: { currency: "USD", issuer: RLUSD }, Amount: "1000", Amount2: { currency: "USD", issuer: RLUSD, value: "0.5" } } },
  { signed: { ...base, TransactionType: "Payment", Destination: BOB, Amount: "1", TxnSignature: "3045022100AB", NetworkID: 21338 } },
];

describe("binary codec subset", () => {
  for (const c of CASES) {
    const [name, tx] = Object.entries(c)[0]!;
    it(`matches ripple-binary-codec: ${name}`, () => {
      expect(hex(serializeObject(tx)).toUpperCase()).toBe(encode(tx as never));
      expect(hex(signingPayload(tx)).toUpperCase()).toBe(encodeForSigning(tx as never));
    });
  }

  it("hashes signed blobs like xrpl.js", () => {
    const blob = encode({ ...base, TransactionType: "Payment", Destination: BOB, Amount: "1", TxnSignature: "3045022100AB" } as never);
    expect(txHash(fromHex(blob))).toBe(hashes.hashSignedTx(blob));
    expect(decode(blob).Destination).toBe(BOB);
  });

  it("writes VL lengths in 1, 2 and 3 bytes", () => {
    expect(hex(vlPrefix(192))).toBe("c0");
    expect(hex(vlPrefix(193))).toBe("c100");
    expect(hex(vlPrefix(12480))).toBe("f0ff");
    expect(hex(vlPrefix(12481))).toBe("f10000");
    const big = { ...base, TransactionType: "AccountSet", Domain: "AB".repeat(300) };
    expect(hex(serializeObject(big)).toUpperCase()).toBe(encode(big as never));
  });

  it("refuses what it can't serialise", () => {
    expect(() => serializeObject({ ...base, TransactionType: "Payment", Delegate: BOB })).toThrow(UnsupportedField);
    expect(() => serializeObject({ ...base, TransactionType: "CheckCreate" })).toThrow(UnsupportedField);
    expect(() => serializeObject({ ...base, TransactionType: "Payment", Amount: { mpt_issuance_id: "00", value: "1" } })).toThrow(UnsupportedField);
    expect(() => serializeObject({ ...base, TransactionType: "Payment", Amount: { currency: "USD", issuer: RLUSD, value: "1.23456789012345678" } })).toThrow(/significant/);
    expect(() => serializeObject({ ...base, TransactionType: "Payment", Amount: "-1" })).toThrow(UnsupportedField);
    expect(() => serializeObject({ ...base, Account: "X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ", TransactionType: "Payment" })).toThrow(UnsupportedField);
  });

  it("DER-encodes r||s", () => {
    const rs = new Uint8Array(64);
    rs[0] = 0x80;
    rs[32] = 0x00;
    rs[33] = 0x01;
    const der = derSignature(rs);
    expect(hex(der.subarray(0, 4))).toBe("30440221");
    expect(der[4]).toBe(0);
    expect(der.length).toBe(2 + 2 + 33 + 2 + 31);
  });
});

describe("addresses", () => {
  it("decodes and encodes X-addresses (ripple-address-codec vectors)", () => {
    // xrpaddress.info / ripple-address-codec test vectors.
    expect(decodeXAddress("X7AcgcsBL6XDcUb289X4mJ8djcdyKaB5hJDWMArnXr61cqZ")).toEqual({ classic: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59", tag: null, test: false });
    expect(decodeXAddress("X7AcgcsBL6XDcUb289X4mJ8djcdyKaGZMhc9YTE92ehJ2Fu")).toEqual({ classic: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59", tag: 1, test: false });
    expect(decodeXAddress("T719a5UwUCnEs54UsxG9CJYYDhwmFCqkr7wxCcNcfZ6p5GZ")).toEqual({ classic: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59", tag: null, test: true });
    expect(encodeXAddress("r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59", 1, false)).toBe("X7AcgcsBL6XDcUb289X4mJ8djcdyKaGZMhc9YTE92ehJ2Fu");
    expect(isClassicAddress(ME)).toBe(true);
    expect(isClassicAddress(`${ME.slice(0, -1)}4`)).toBe(false);
  });
});
