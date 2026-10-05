# Integration: settle on Hedera, end to end (branch `r1/settle-e2e`)

Approving a payment on network X with the money on network Y now pays through a bonded Connector
("settle on Hedera", CLPRouter `docs/settle-on-hedera.md`) instead of only describing the quote in Details.
Builds on `settle-client.md` (the `SettleClient`); this file lists what is wired and where.

## Flow

1. **Plan** (`RoutePlannerAdapter.plan`, both copies: `packages/engine/src/adapters.ts`,
   `apps/extension/src/background/real.ts`). When the payment has exactly one shortfall that the same asset on
   another EVM network can cover, `SettleFunding.plan` (`packages/route/src/settle-funding.ts`) asks the
   Connectors, keeps the verified quote and returns `plan.funding` (`SettleFundingView`, numbers and names only,
   no English). Approve is no longer blocked by "Moving money … isn't switched on" in that case.
2. **One approval** (`SettleFundingRun`, `packages/engine/src/settle-funding.ts`, export
   `@clip-wallet/engine/settle-funding`). The first Approve builds the exact-amount `approve` + `SettleDeposit.deposit`
   requests (`SettleFunding.order` → `SettleClient.createOrder`) and sends each through the host's normal path
   (`sendInternal`: chain-module decode must be readable with no danger warning, `prepare`, vault
   `registerApproval` under `<approvalId>:settle:<n>`, sign, `finalize`). The approve must be mined before the
   deposit is decoded/simulated (`waitMined`, `eth_getTransactionReceipt`). The approval stays open.
3. **Follow** (every 5 s; 300 ms in fixture builds): Hedera's mirror node through `SettleClient.getOrder`
   (waiting → opened → closed, or late) and the balance of the needed asset on X (delivered). When the money is on
   X, the plan is recomputed and the screen shows "{amount} arrived. Approve to finish."; that Approve signs the
   app's original request the normal way.
4. **Late**: stage `late`; the screen says "Your payment didn't arrive in time — you've been paid back {amount} on
   Hedera" and Approve becomes the one-tap claim (`claimDefault`, or `withdrawOwed` when the order book could only
   credit the payout) on Hedera's EVM (`eip155:296`, a request-only network). The approval closes, the app's request
   is rejected (`settle/late`) and Activity records "Paid back {amount} on Hedera".
5. Reject is refused while the money is in flight (`settle/in-flight`); a 1Mask timeout ends only the app's request
   (`appGone`), the order stays on screen until it arrives (then "Close") or is claimed.

## Shared files touched (additive)

| File | Change |
| --- | --- |
| `packages/engine/src/engine.ts`, `apps/extension/src/background/service.ts` | `Pending.settle`; Approve → `SettleFundingRun.approve()` when `plan.funding`; Reject/cancel guards; `settleRun`, `sendInternal`, `waitMined`, `closeSettled` (same code in both) |
| `packages/engine/src/{types,wiring}.ts`, `apps/extension/src/background/wiring.ts` | `Dependencies.settleFunding` (the planner's `SettleFunding` instance) |
| `packages/ui/src/client.ts` | `ApprovalPlan.funding?: SettleFundingView`; simulator kinds `settle`, `settle-late` |
| `packages/ui/src/screens/Approval.tsx`, `apps/mobile/src/screens/Approval.tsx` | Connector steps in Details, "From", progress / claim via `SettleFunding.tsx` |
| `apps/mobile/src/App.tsx` | closing the sheet while money is in flight hides it instead of failing |
| `apps/extension/src/shared/messages.ts`, `packages/ui/src/screens/Settings.tsx` | simulator kinds |
| `packages/chains-evm/src/selectors.ts` | `deposit(Quote,bytes)` "Pay a Connector", `claimDefault` "Claim a late payment back", `withdrawOwed` "Collect a payout" (so the wallet-built requests are readable) |
| `apps/{extension,mobile}/clip.config.ts` | `route.settleOnHedera: !MAINNET` |
| `apps/extension/wxt.config.ts` | host permission for the Connectors' quote APIs (testnet builds with the switch on) |

Strings: namespace `settle` (`packages/ui/src/i18n/*/settle.ts`) and `m.settle` (`apps/mobile/src/i18n/*/settle.ts`),
all 12 languages, Arabic values in FSI/PDI isolates.

## Testnet defaults

`SETTLE_DEPLOYMENTS` (`packages/route/src/phase3.ts`): order book `0xB7C875E6EB4a9D470BBccFecbA6256342676e895`
(Hedera testnet, chain 296), `SettleDeposit` `0x249f83524D0827840237e751981B804D99bB5bD6` on Sepolia, Connector
`0x316323692104293b58366e6Bc66a796B919108E7` ("Clip testnet Connector") at `http://127.0.0.1:8787` (the reference
service, CLPRouter `script/deploy/settle-connector.sh serve`). Addresses and transactions: CLPRouter
`deployments/README.md`, "Settle on Hedera (testnet)".

Checked live (2026-10-05): `SettleClient` reads the bond (5 HBAR, all free) from the mirror node, and verifies the
running service's signed quote (order id, signer, owed-on-default, capacity) up to the source check, where it drops
it with "payments on the source network can't be proven to Hedera yet": the Sepolia source becomes active
2026-10-06 06:20 UTC.

## Fixture mode

`apps/extension/src/background/mocks/mock-settle.ts`: a mock Connector + order book on a timeline (opened 0.6 s after
the deposit, money on Base 1.5 s, closed 2.6 s; or late at 1.5 s). Settings → simulator → `settle` / `settle-late`
runs the real host flow with the real vault. e2e: `apps/extension/e2e/settle.spec.ts`.

## Gaps

- **No real order yet**: the Sepolia source activates a day after it was proposed, the settle CLPR connector is not
  registered on Sepolia (budget), and the Sepolia → Hedera Channel needs its committee rotation (CLPRouter README).
  The demo deployment pays and delivers on Sepolia (X = Y); the wallet only offers a Connector when X ≠ Y, so the
  wallet path is exercised by fixtures and unit tests, not on testnet.
- One shortfall per payment, EVM networks only; hardware-wallet accounts are refused (`settle/hardware`).
- Orders are followed in memory: an MV3 service worker that is stopped mid-order (or an app restart) loses the
  screen; the order itself is safe on Hedera and the claim is anyone-callable, but the wallet doesn't list it again
  yet (`SettleClient.listOrders` exists for that).
- Claiming on Hedera needs HBAR for the fee in the same EVM account.
- The testnet Connector runs on 127.0.0.1: the extension reaches it on the machine that runs the service; a phone
  doesn't.
