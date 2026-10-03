/**
 * Hardware routing in the background, end to end with a recorded Ledger session (APDU replay from
 * packages/hardware/test/fixtures): the account picked for EVM is the Ledger one, approve() hands the
 * device the raw transaction, and the signature comes back through finalize(). No keys, no device.
 */
import { describe, expect, it, vi } from "vitest";
import type { ChainModule, DappRequest, Signature } from "@clip-wallet/core";
import { assertVerifies } from "@clip-wallet/hardware";
import { readFileSync } from "node:fs";
import { keyringWith, replay } from "../../../packages/hardware/test/helpers";
import * as I from "../../../packages/hardware/test/inputs";
import { PASSWORD, makeService } from "./helpers";

const ACCOUNTS = JSON.parse(readFileSync(new URL("../../../packages/hardware/test/fixtures/accounts.json", import.meta.url), "utf8"));
const LEDGER_EVM = ACCOUNTS.evm.accounts[0];
const SEPOLIA = "eip155:11155111";

describe("hardware accounts in the background", () => {
  it("signs an approved EVM transaction on the Ledger and finalizes with its signature", async () => {
    const { service, deps, env } = makeService();
    await service.handle({ type: "createWallet", password: PASSWORD });

    const { signer, store } = replay("evm-sign-tx");
    deps.hardware = await keyringWith(signer, [LEDGER_EVM]);
    const tx = I.evmTx();
    let finalized: Signature[] = [];
    const mock = deps.chains.evm!;
    const evm: ChainModule = {
      ...mock,
      decode: async (r) => ({ requestId: r.id, title: "Send 0.01 ETH", lines: [], balanceChanges: [], simulated: false, blind: false, warnings: [], networkId: r.networkId }),
      prepare: async (_r, ctx, approvalId) => [{ accountId: ctx.account.id, scheme: "ecdsa-secp256k1", bytes: tx.digest, approvalId, raw: { format: "evm-tx", bytes: tx.raw, chainId: 11155111 } }],
      finalize: async (_r, sigs) => {
        finalized = sigs;
        return { txHash: "0xabc" };
      },
    };
    deps.chains.evm = evm;

    await service.handle({ type: "hwSetActive", family: "evm", accountId: LEDGER_EVM.id });
    expect(service.cachedAccount("evm")?.id).toBe(LEDGER_EVM.id);
    expect(await service.handle({ type: "hwListAccounts" })).toEqual([expect.objectContaining({ id: LEDGER_EVM.id, active: true })]);

    const req: DappRequest = { id: "r1", origin: "wallet", via: "injected", family: "evm", networkId: SEPOLIA, method: "eth_sendTransaction", params: [] };
    const done = service.request(req);
    await vi.waitFor(() => expect(env.opened).toHaveLength(1));
    await service.handle({ type: "approve", id: env.opened[0]! });
    await expect(done).resolves.toEqual({ txHash: "0xabc" });
    store.ensureQueueEmpty();

    // The device's signature verifies against the Ledger account's key over the approved digest.
    expect(finalized).toHaveLength(1);
    expect(() => assertVerifies(finalized[0]!, { accountId: LEDGER_EVM.id, scheme: "ecdsa-secp256k1", bytes: tx.digest, approvalId: "x" }, LEDGER_EVM.publicKey)).not.toThrow();

    // Back to the phrase account.
    await service.handle({ type: "hwSetActive", family: "evm", accountId: null });
    expect(service.cachedAccount("evm")?.id).toBe("evm:0");
  });
});
