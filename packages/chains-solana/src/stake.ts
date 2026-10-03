/**
 * Native Stake program (`Stake11111111111111111111111111111111111111`) and the System CreateAccountWithSeed that
 * funds a stake account, so "Stake 2 SOL with <validator>", "Stop staking" and "Withdraw 2 SOL from staking"
 * aren't blind.
 *
 * Layouts: @solana-program/stake 0.10 (generated from github.com/solana-program/stake): u32 discriminator
 * (Initialize 0, DelegateStake 2, Withdraw 4 + u64 lamports, Deactivate 5); its builders omit the sysvar /
 * stake-config accounts, which the current program no longer requires, while older builders (web3.js
 * StakeProgram, most dapps) still pass them in between. We drop known sysvar/config addresses first, then read
 * accounts by position: Initialize [stake], DelegateStake [stake, vote, stakeAuthority], Deactivate
 * [stake, stakeAuthority], Withdraw [stake, recipient, withdrawAuthority, lockupAuthority?].
 * CreateAccountWithSeed: @solana-program/system `getCreateAccountWithSeedInstructionDataDecoder`
 * (base, seed, amount, space, programAddress).
 */
import type { Instruction, ReadonlyUint8Array } from "@solana/kit";
import {
  STAKE_PROGRAM_ADDRESS,
  StakeInstruction,
  getInitializeInstructionDataDecoder,
  getWithdrawInstructionDataDecoder,
  identifyStakeInstruction,
} from "@solana-program/stake";
import { getCreateAccountWithSeedInstructionDataDecoder } from "@solana-program/system";

export const STAKE_PROGRAM = String(STAKE_PROGRAM_ADDRESS);

const SYSVAR_LIKE = new Set([
  "SysvarC1ock11111111111111111111111111111111",
  "SysvarStakeHistory1111111111111111111111111",
  "SysvarRent111111111111111111111111111111111",
  "StakeConfig11111111111111111111111111111111",
]);

export type StakeAction =
  | { kind: "initialize"; stake: string; staker: string; withdrawer: string; lockedUntil: { unix: bigint; epoch: bigint; custodian: string } | null }
  | { kind: "delegate"; stake: string; vote: string; authority: string }
  | { kind: "deactivate"; stake: string; authority: string }
  | { kind: "withdraw"; stake: string; recipient: string; authority: string; lamports: bigint };

/** Decodes the stake instructions the wallet understands; null for anything else (→ blind). */
export function decodeStake(ix: Instruction): StakeAction | null {
  if (String(ix.programAddress) !== STAKE_PROGRAM || !ix.data) return null;
  const accts = (ix.accounts ?? []).map((a) => String(a.address)).filter((a) => !SYSVAR_LIKE.has(a));
  try {
    switch (identifyStakeInstruction(ix.data)) {
      case StakeInstruction.Initialize: {
        if (accts.length < 1) return null;
        const d = getInitializeInstructionDataDecoder().decode(ix.data);
        const l = d.arg1;
        const locked = l.unixTimestamp !== 0n || l.epoch !== 0n;
        return {
          kind: "initialize",
          stake: accts[0]!,
          staker: String(d.arg0.staker),
          withdrawer: String(d.arg0.withdrawer),
          lockedUntil: locked ? { unix: l.unixTimestamp, epoch: l.epoch, custodian: String(l.custodian) } : null,
        };
      }
      case StakeInstruction.DelegateStake:
        return accts.length >= 3 ? { kind: "delegate", stake: accts[0]!, vote: accts[1]!, authority: accts[2]! } : null;
      case StakeInstruction.Deactivate:
        return accts.length >= 2 ? { kind: "deactivate", stake: accts[0]!, authority: accts[1]! } : null;
      case StakeInstruction.Withdraw: {
        if (accts.length < 3) return null;
        const d = getWithdrawInstructionDataDecoder().decode(ix.data);
        return { kind: "withdraw", stake: accts[0]!, recipient: accts[1]!, authority: accts[2]!, lamports: d.args };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** System CreateAccountWithSeed whose new account belongs to the Stake program (funding a stake account). */
export function decodeStakeAccountFunding(data: ReadonlyUint8Array): { base: string; seed: string; lamports: bigint } | null {
  try {
    const d = getCreateAccountWithSeedInstructionDataDecoder().decode(data);
    if (String(d.programAddress) !== STAKE_PROGRAM) return null;
    return { base: String(d.base), seed: d.seed, lamports: d.amount };
  } catch {
    return null;
  }
}
