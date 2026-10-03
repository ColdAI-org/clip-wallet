import { describe, expect, it } from "vitest";
import {
  AptosConnectNamespace,
  AptosDisconnectNamespace,
  AptosSignAndSubmitTransactionNamespace,
  AptosSignMessageNamespace,
  AptosSignTransactionNamespace,
} from "@aptos-labs/wallet-standard";
import { SuiSignAndExecuteTransaction, SuiSignPersonalMessage, SuiSignTransaction } from "@mysten/wallet-standard";
import { APTOS_CONNECT_METHODS, APTOS_LOCAL_METHODS, APTOS_SIGNING_METHODS, SUI_SIGNING_METHODS } from "../src/shared/move-methods.js";

describe("Sui/Aptos method names the background allowlists", () => {
  it("match the wallet-standard libraries' constants", () => {
    expect(APTOS_CONNECT_METHODS).toEqual([AptosConnectNamespace]);
    expect(APTOS_LOCAL_METHODS.slice(-1)).toEqual([AptosDisconnectNamespace]);
    expect(APTOS_SIGNING_METHODS).toEqual([AptosSignTransactionNamespace, AptosSignAndSubmitTransactionNamespace, AptosSignMessageNamespace]);
    expect(SUI_SIGNING_METHODS).toEqual([SuiSignTransaction, SuiSignAndExecuteTransaction, SuiSignPersonalMessage]);
  });
});
