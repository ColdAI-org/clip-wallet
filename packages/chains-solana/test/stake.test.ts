import type { DappRequest } from "@clip-wallet/core";
import {
  type Instruction,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createAddressWithSeed,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getCreateAccountWithSeedInstruction } from "@solana-program/system";
import { STAKE_PROGRAM_ADDRESS, getDeactivateInstruction, getDelegateStakeInstruction, getInitializeInstruction, getWithdrawInstruction } from "@solana-program/stake";
import { describe, expect, it } from "vitest";
import { SOLANA_DEVNET, createSolanaModule, solAsset } from "../src/index.js";
import { b64encode } from "../src/util.js";
import { ctxFor, makeAccount, mockSolana } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = address(FIX.me);
const BOB = address(FIX.bob);
const VOTE = getAddressDecoder().decode(new Uint8Array(32).fill(77));
const me = createNoopSigner(ME);
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const HISTORY = "SysvarStakeHistory1111111111111111111111111";
const CONFIG = "StakeConfig11111111111111111111111111111111";

function wire(ixs: Instruction[]): string {
  const m = pipe(
    createTransactionMessage({ version: 0 }),
    (x) => setTransactionMessageFeePayer(ME, x),
    (x) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: FIX.blockhash as never, lastValidBlockHeight: 100n }, x),
    (x) => appendTransactionMessageInstructions(ixs, x),
  );
  return b64encode(new Uint8Array(getTransactionEncoder().encode(compileTransaction(m))));
}
const req = (tx: string): DappRequest => ({
  id: "r",
  origin: "wallet",
  via: "injected",
  family: "solana",
  networkId: SOLANA_DEVNET.id,
  method: "solana:signTransaction",
  params: { inputs: [{ account: FIX.me, transaction: tx, chain: "solana:devnet" }] },
});
const decode = (ixs: Instruction[]) =>
  createSolanaModule({ simulate: false }).decode(req(wire(ixs)), ctxFor(makeAccount(FIX.me), mockSolana({ getMultipleAccounts: (p) => ({ context: { slot: 1 }, value: (p[0] as string[]).map(() => null) }) }).fetch));

const stakeAccount = () => createAddressWithSeed({ baseAddress: ME, programAddress: STAKE_PROGRAM_ADDRESS, seed: "clip-stake-0" });
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

describe("native staking (as packages/features builds it)", () => {
  it("CreateAccountWithSeed + Initialize + DelegateStake → 'Stake 2 SOL with validator …'", async () => {
    const stake = await stakeAccount();
    const rent = 2_282_880n;
    const d = await decode([
      getCreateAccountWithSeedInstruction({ payer: me, newAccount: stake, base: ME, seed: "clip-stake-0", amount: 2_000_000_000n + rent, space: 200n, programAddress: STAKE_PROGRAM_ADDRESS }),
      getInitializeInstruction({ stake, arg0: { staker: ME, withdrawer: ME }, arg1: { unixTimestamp: 0, epoch: 0, custodian: address("11111111111111111111111111111111") } }),
      getDelegateStakeInstruction({ stake, vote: VOTE, stakeAuthority: me }),
    ]);
    expect(d.blind).toBe(false);
    expect(d.title).toBe(`Stake 2 SOL with validator ${short(VOTE)}`);
    expect(d.lines).toEqual(expect.arrayContaining([{ label: "Validator", value: VOTE }, { label: "Stake account", value: stake }, { label: "Opening cost", value: "≈0.00228288 SOL, returned when you withdraw" }]));
    expect(d.balanceChanges).toEqual([{ asset: solAsset(SOLANA_DEVNET.id), delta: (-(2_000_000_000n + rent)).toString() }]);
    expect(d.warnings.map((w) => w.code)).not.toContain("blind-signing");
  });

  it("legacy layout with sysvar / config accounts decodes the same", async () => {
    const stake = await stakeAccount();
    const delegate: Instruction = {
      programAddress: STAKE_PROGRAM_ADDRESS,
      accounts: [stake, VOTE, CLOCK, HISTORY, CONFIG].map((a, i) => ({ address: address(a), role: i === 0 ? 1 : 0 })).concat([{ address: ME, role: 2 }]),
      data: new Uint8Array([2, 0, 0, 0]),
    };
    const d = await decode([delegate]);
    expect(d.title).toBe(`Stake with validator ${short(VOTE)}`);
  });

  it("Deactivate → 'Stop staking'", async () => {
    const d = await decode([getDeactivateInstruction({ stake: await stakeAccount(), stakeAuthority: me })]);
    expect(d.blind).toBe(false);
    expect(d.title).toBe("Stop staking");
  });

  it("Withdraw to me → 'Withdraw 2 SOL from staking', SOL comes back", async () => {
    const d = await decode([getWithdrawInstruction({ stake: await stakeAccount(), recipient: ME, withdrawAuthority: me, args: 2_000_000_000n })]);
    expect(d.title).toBe("Withdraw 2 SOL from staking");
    expect(d.balanceChanges).toEqual([{ asset: solAsset(SOLANA_DEVNET.id), delta: "2000000000" }]);
  });

  it("Withdraw to someone else → danger", async () => {
    const d = await decode([getWithdrawInstruction({ stake: await stakeAccount(), recipient: BOB, withdrawAuthority: me, args: 1n })]);
    expect(d.title).toBe(`Withdraw 0.000000001 SOL from staking to ${short(BOB)}`);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "new-recipient" }));
  });

  it("Initialize handing withdraw authority to someone else → danger; lockup → caution", async () => {
    const stake = await stakeAccount();
    const d = await decode([
      getCreateAccountWithSeedInstruction({ payer: me, newAccount: stake, base: ME, seed: "clip-stake-0", amount: 3_000_000_000n, space: 200n, programAddress: STAKE_PROGRAM_ADDRESS }),
      getInitializeInstruction({ stake, arg0: { staker: ME, withdrawer: BOB }, arg1: { unixTimestamp: 2_000_000_000, epoch: 0, custodian: BOB } }),
      getDelegateStakeInstruction({ stake, vote: VOTE, stakeAuthority: me }),
    ]);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "new-recipient" }));
    expect(d.lines).toContainEqual({ label: "Stake controlled by", value: BOB });
    expect(d.lines).toContainEqual({ label: "Locked", value: "Can't be withdrawn before 2033-05-18" });
  });

  it("acting on a stake account someone else controls is blind; other stake instructions too", async () => {
    const stake = await stakeAccount();
    const other = createNoopSigner(BOB);
    expect((await decode([getDeactivateInstruction({ stake, stakeAuthority: other })])).blind).toBe(true);
    const merge: Instruction = { programAddress: STAKE_PROGRAM_ADDRESS, accounts: [{ address: stake, role: 1 }, { address: ME, role: 2 }], data: new Uint8Array([7, 0, 0, 0]) };
    expect((await decode([merge])).blind).toBe(true);
  });
});
