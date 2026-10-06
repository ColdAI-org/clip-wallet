import { makeSignDoc, serializeSignDoc as cosmjsSerialize } from "@cosmjs/amino";
import { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys";
import { MsgWithdrawDelegatorReward } from "cosmjs-types/cosmos/distribution/v1beta1/tx";
import { MsgBeginRedelegate, MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx";
import { AuthInfo, SignDoc, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing";
import { MsgGrant } from "cosmjs-types/cosmos/authz/v1beta1/tx";
import { GenericAuthorization } from "cosmjs-types/cosmos/authz/v1beta1/authz";
import { MsgGrantAllowance } from "cosmjs-types/cosmos/feegrant/v1beta1/tx";
import { BasicAllowance } from "cosmjs-types/cosmos/feegrant/v1beta1/feegrant";
import { MsgExecuteContract } from "cosmjs-types/cosmwasm/wasm/v1/tx";
import { MsgTransfer } from "cosmjs-types/ibc/applications/transfer/v1/tx";
import { describe, expect, it } from "vitest";
import { makeAdr36SignDoc, serializeSignDoc } from "../src/amino.js";
import { fromAmino, fromAny } from "../src/msgs.js";
import {
  ProtoError,
  SIGN_MODE_DIRECT,
  TYPE,
  decodeAuthInfo,
  decodeThorMsgSend,
  decodeTxBody,
  decodeTxRaw,
  encodeAuthInfo,
  encodeMsgSend,
  encodePubKey,
  encodeSignDoc,
  encodeThorMsgSend,
  encodeTxBody,
  encodeTxRaw,
  readFields,
} from "../src/proto.js";
import { fromHex, hex, utf8 } from "../src/util.js";
import { PUB } from "./helpers.js";

/** Every hand-written encoding is checked byte for byte against cosmjs-types (ts-proto, the cosmjs encoder). */

const ME = "osmo19rl4cm2hmr8afy4kldpxz3fka4jguq0a5m7df8";
const BOB = "osmo1jrkmdcwgq94uaamx6zax2luewlhf7u4k5r4pqs";
const pub = fromHex(PUB.cosmos);

describe("protobuf against cosmjs-types", () => {
  it("TxBody, AuthInfo, SignDoc and TxRaw encode identically", () => {
    const send = { fromAddress: ME, toAddress: BOB, amount: [{ denom: "uosmo", amount: "1500000" }] };
    const mine = encodeTxBody({ messages: [{ typeUrl: TYPE.msgSend, value: encodeMsgSend(send) }], memo: "hi <&>", timeoutHeight: 99n });
    const theirs = TxBody.encode(
      TxBody.fromPartial({ messages: [{ typeUrl: TYPE.msgSend, value: MsgSend.encode(MsgSend.fromPartial(send)).finish() }], memo: "hi <&>", timeoutHeight: 99n }),
    ).finish();
    expect(hex(mine)).toBe(hex(theirs));

    const pk = { typeUrl: "/cosmos.crypto.secp256k1.PubKey", value: PubKey.encode({ key: pub }).finish() };
    expect(hex(encodePubKey(pub))).toBe(hex(pk.value));
    const auth = encodeAuthInfo({ signerInfos: [{ publicKey: pk, mode: SIGN_MODE_DIRECT, sequence: 7n }], fee: { amount: [{ denom: "uosmo", amount: "3750" }], gasLimit: 150000n } });
    const authTheirs = AuthInfo.encode(
      AuthInfo.fromPartial({
        signerInfos: [{ publicKey: pk, modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } }, sequence: 7n }],
        fee: { amount: [{ denom: "uosmo", amount: "3750" }], gasLimit: 150000n },
      }),
    ).finish();
    expect(hex(auth)).toBe(hex(authTheirs));

    // Sequence 0 (a first transaction) and an empty fee still encode the same.
    const auth0 = encodeAuthInfo({ signerInfos: [{ publicKey: pk, mode: SIGN_MODE_DIRECT, sequence: 0n }], fee: { amount: [], gasLimit: 0n } });
    const auth0Theirs = AuthInfo.encode(AuthInfo.fromPartial({ signerInfos: [{ publicKey: pk, modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } }, sequence: 0n }], fee: {} })).finish();
    expect(hex(auth0)).toBe(hex(auth0Theirs));

    const doc = encodeSignDoc({ bodyBytes: mine, authInfoBytes: auth, chainId: "osmo-test-5", accountNumber: 12345n });
    expect(hex(doc)).toBe(hex(SignDoc.encode({ bodyBytes: mine, authInfoBytes: auth, chainId: "osmo-test-5", accountNumber: 12345n }).finish()));
    const doc0 = encodeSignDoc({ bodyBytes: mine, authInfoBytes: auth, chainId: "osmo-test-5", accountNumber: 0n });
    expect(hex(doc0)).toBe(hex(SignDoc.encode({ bodyBytes: mine, authInfoBytes: auth, chainId: "osmo-test-5", accountNumber: 0n }).finish()));

    const sig = new Uint8Array(64).fill(7);
    const raw = encodeTxRaw({ bodyBytes: mine, authInfoBytes: auth, signatures: [sig] });
    expect(hex(raw)).toBe(hex(TxRaw.encode({ bodyBytes: mine, authInfoBytes: auth, signatures: [sig] }).finish()));
    expect(decodeTxRaw(raw).signatures[0]).toEqual(sig);

    const body = decodeTxBody(theirs);
    expect(body.memo).toBe("hi <&>");
    expect(body.timeoutHeight).toBe(99n);
    expect(fromAny(body.messages[0]!, "osmo")).toEqual({ kind: "send", from: ME, to: BOB, amount: [{ denom: "uosmo", amount: "1500000" }] });
    const a = decodeAuthInfo(authTheirs);
    expect(a.signerInfos[0]).toMatchObject({ mode: SIGN_MODE_DIRECT, sequence: 7n, multi: false });
    expect(a.fee).toEqual({ amount: [{ denom: "uosmo", amount: "3750" }], gasLimit: 150000n, payer: "", granter: "" });
  });

  it("decodes the messages Clip explains", () => {
    const any = (typeUrl: string, value: Uint8Array) => ({ typeUrl, value });
    const transfer = MsgTransfer.fromPartial({
      sourcePort: "transfer",
      sourceChannel: "channel-0",
      token: Coin.fromPartial({ denom: "uosmo", amount: "5" }),
      sender: ME,
      receiver: "cosmos1jrkmdcwgq94uaamx6zax2luewlhf7u4kucx3kz",
      timeoutHeight: { revisionNumber: 1n, revisionHeight: 2n },
      timeoutTimestamp: 1700000000000000000n,
      memo: "m",
    });
    expect(fromAny(any(TYPE.msgTransfer, MsgTransfer.encode(transfer).finish()), "osmo")).toEqual({
      kind: "ibc-transfer",
      sender: ME,
      receiver: "cosmos1jrkmdcwgq94uaamx6zax2luewlhf7u4kucx3kz",
      token: { denom: "uosmo", amount: "5" },
      port: "transfer",
      channel: "channel-0",
      memo: "m",
      timeoutTimestamp: 1700000000000000000n,
    });
    const del = MsgDelegate.fromPartial({ delegatorAddress: ME, validatorAddress: "osmovaloper1x", amount: { denom: "uosmo", amount: "9" } });
    expect(fromAny(any(TYPE.msgDelegate, MsgDelegate.encode(del).finish()), "osmo")).toEqual({ kind: "delegate", delegator: ME, validator: "osmovaloper1x", amount: [{ denom: "uosmo", amount: "9" }] });
    expect(fromAny(any(TYPE.msgUndelegate, MsgDelegate.encode(del).finish()), "osmo")).toMatchObject({ kind: "undelegate" });
    const red = MsgBeginRedelegate.fromPartial({ delegatorAddress: ME, validatorSrcAddress: "a", validatorDstAddress: "b", amount: { denom: "uosmo", amount: "3" } });
    expect(fromAny(any(TYPE.msgBeginRedelegate, MsgBeginRedelegate.encode(red).finish()), "osmo")).toEqual({ kind: "redelegate", delegator: ME, from: "a", to: "b", amount: [{ denom: "uosmo", amount: "3" }] });
    const wd = MsgWithdrawDelegatorReward.fromPartial({ delegatorAddress: ME, validatorAddress: "v" });
    expect(fromAny(any(TYPE.msgWithdrawReward, MsgWithdrawDelegatorReward.encode(wd).finish()), "osmo")).toEqual({ kind: "withdraw-rewards", delegator: ME, validator: "v" });
    const ex = MsgExecuteContract.fromPartial({ sender: ME, contract: "osmo1contract", msg: utf8('{"swap":{"min":"1"}}'), funds: [{ denom: "uosmo", amount: "4" }] });
    expect(fromAny(any(TYPE.msgExecuteContract, MsgExecuteContract.encode(ex).finish()), "osmo")).toMatchObject({ kind: "execute", contract: "osmo1contract", msg: { swap: { min: "1" } }, funds: [{ denom: "uosmo", amount: "4" }] });
    const grant = MsgGrant.fromPartial({
      granter: ME,
      grantee: BOB,
      grant: { authorization: { typeUrl: TYPE.genericAuthorization, value: GenericAuthorization.encode({ msg: TYPE.msgSend }).finish() }, expiration: { seconds: 1800000000n, nanos: 0 } },
    });
    expect(fromAny(any(TYPE.msgGrant, MsgGrant.encode(grant).finish()), "osmo")).toEqual({ kind: "authz-grant", granter: ME, grantee: BOB, authorization: TYPE.msgSend, expiration: 1800000000n });
    const fg = MsgGrantAllowance.fromPartial({ granter: ME, grantee: BOB, allowance: { typeUrl: TYPE.basicAllowance, value: BasicAllowance.encode({ spendLimit: [{ denom: "uosmo", amount: "100" }] }).finish() } });
    expect(fromAny(any(TYPE.msgGrantAllowance, MsgGrantAllowance.encode(fg).finish()), "osmo")).toEqual({ kind: "feegrant", granter: ME, grantee: BOB, allowance: TYPE.basicAllowance, spendLimit: [{ denom: "uosmo", amount: "100" }] });
    expect(fromAny(any("/osmosis.gamm.v1beta1.MsgSwapExactAmountIn", new Uint8Array([10, 1, 65])), "osmo")).toEqual({ kind: "unknown", type: "/osmosis.gamm.v1beta1.MsgSwapExactAmountIn" });
    // A malformed known message is unknown (blind), never half-read.
    expect(fromAny(any(TYPE.msgSend, new Uint8Array([10, 50, 1])), "osmo")).toEqual({ kind: "unknown", type: TYPE.msgSend });
  });

  it("THORChain types.MsgSend carries raw address bytes (thornode msg_send.proto)", () => {
    const from = new Uint8Array(20).fill(1);
    const to = new Uint8Array(20).fill(2);
    const b = encodeThorMsgSend({ fromAddress: from, toAddress: to, amount: [{ denom: "rune", amount: "100" }] });
    // Field 1 / 2 are bytes (0x0a 0x14 …, 0x12 0x14 …), field 3 a cosmos Coin, as in thornode's generated Go struct.
    expect(hex(b.subarray(0, 2))).toBe("0a14");
    expect(hex(b.subarray(22, 24))).toBe("1214");
    expect(decodeThorMsgSend(b)).toEqual({ fromAddress: from, toAddress: to, amount: [{ denom: "rune", amount: "100" }] });
    expect(fromAny({ typeUrl: TYPE.thorMsgSend, value: b }, "thor")).toMatchObject({ kind: "send", amount: [{ denom: "rune", amount: "100" }] });
  });

  it("rejects malformed protobuf", () => {
    expect(() => readFields(new Uint8Array([0x0a, 0x05, 1]))).toThrow(ProtoError);
    expect(() => readFields(new Uint8Array([0x0b]))).toThrow(ProtoError); // group (wire 3)
    expect(() => decodeTxBody(new Uint8Array([0x22, 0x00, 0x9a, 0x01, 0x00]))).toThrow(ProtoError); // unknown field 19
  });
});

describe("amino JSON against @cosmjs/amino", () => {
  it("serializes sign docs exactly as cosmjs (sorted keys, HTML escaping)", () => {
    const msgs = [{ type: "cosmos-sdk/MsgSend", value: { from_address: ME, to_address: BOB, amount: [{ denom: "uosmo", amount: "1" }] } }];
    const fee = { amount: [{ denom: "uosmo", amount: "2500" }], gas: "100000" };
    const doc = makeSignDoc(msgs, fee, "osmo-test-5", "a <b> & c", 12, 3);
    expect(new TextDecoder().decode(serializeSignDoc(doc))).toBe(new TextDecoder().decode(cosmjsSerialize(doc)));
    expect(new TextDecoder().decode(serializeSignDoc(doc))).toContain("a \\u003cb\\u003e \\u0026 c");
  });

  it("builds ADR-36 docs as Keplr's makeADR36AminoSignDoc", () => {
    const doc = makeAdr36SignDoc(ME, btoa("hello"));
    expect(new TextDecoder().decode(serializeSignDoc(doc))).toBe(
      `{"account_number":"0","chain_id":"","fee":{"amount":[],"gas":"0"},"memo":"","msgs":[{"type":"sign/MsgSignData","value":{"data":"aGVsbG8=","signer":"${ME}"}}],"sequence":"0"}`,
    );
  });

  it("reads amino messages", () => {
    expect(fromAmino({ type: "cosmos-sdk/MsgSend", value: { from_address: ME, to_address: BOB, amount: [{ denom: "uosmo", amount: "1" }] } })).toEqual({
      kind: "send",
      from: ME,
      to: BOB,
      amount: [{ denom: "uosmo", amount: "1" }],
    });
    expect(fromAmino({ type: "wasm/MsgExecuteContract", value: { sender: ME, contract: "c", msg: { a: 1 }, funds: [] } })).toMatchObject({ kind: "execute", msg: { a: 1 } });
    expect(fromAmino({ type: "cosmos-sdk/MsgSend", value: { from_address: ME, to_address: BOB, amount: [{ denom: "uosmo", amount: "-1" }] } })).toEqual({ kind: "unknown", type: "cosmos-sdk/MsgSend" });
    expect(fromAmino({ type: "osmosis/gamm/swap-exact-amount-in", value: {} })).toEqual({ kind: "unknown", type: "osmosis/gamm/swap-exact-amount-in" });
  });
});
