> **DRAFT — needs legal review.** Prepared by the engineering team as a starting point. It is not legal advice
> and has not been reviewed by counsel. Items in [brackets] are placeholders. Governing law, liability caps,
> consumer-law carve-outs and dispute resolution in particular must be settled by a lawyer for each market
> before publication.

# Clip Wallet terms of use

*Draft of 2026-10-05; fee clause (section 4) and swaps between networks (3.4) added 2026-11-02.*

These terms apply to the Clip Wallet browser extension, the Clip Wallet mobile app and the optional ColdAI
services they use (passkey backup and media proxy), together "Clip Wallet". Clip Wallet is published by ColdAI
([legal entity, address]) ("we"). By installing or using Clip Wallet you agree to these terms. The source code is
also available under the Apache License 2.0 (`LICENSE`, `NOTICE`); that licence governs the code, these terms govern your use of
the apps and services we publish.

## 1. What Clip Wallet is, and isn't

1.1 Clip Wallet is **non-custodial software**. It creates and stores your recovery phrase and private keys on
your device, encrypted with your password. We never have them, cannot see them, and cannot move, freeze,
reverse or recover your assets.

1.2 Clip Wallet is **not** a bank, exchange, broker, money transmitter, custodian or investment adviser. Nothing
in Clip Wallet is financial, investment, tax or legal advice. Information such as prices, routes, staking rates,
scam warnings and decoded requests is provided for convenience and may be wrong or out of date. [Counsel to
confirm this still holds in each market now that ColdAI receives the Clip fee on swaps between networks
(section 4).]

1.3 **This version uses test networks only.** Test tokens have no monetary value. Do not send assets with real
value to addresses shown by a test build. [Revise this section before any mainnet release.]

## 2. Your responsibilities

2.1 **Your recovery phrase is the only way to restore your wallet.** Write it down and keep it safe and offline.
If you lose it and your device, nobody, including us, can restore your wallet. Anyone who learns it can take
everything.

2.2 You are responsible for the transactions you approve, the addresses you send to, the networks you choose,
the apps you connect to and the plugins you install. Blockchain transactions are generally irreversible.

2.3 You must comply with the laws that apply to you, including sanctions, tax and anti-money-laundering laws,
and you must not use Clip Wallet for unlawful purposes. [Eligibility and restricted-territory wording to be
confirmed by counsel.]

2.4 You are responsible for the security of your device, browser, password, passkeys and the accounts (Apple,
Google, password manager, email) your passkeys and backups depend on.

## 3. Third-party services

3.1 Clip Wallet connects you to services we do not run: blockchain networks and their nodes and indexers,
price and market-data providers, name services, swap, staking and buying providers, WalletConnect, hardware
wallets, scam-list publishers and the websites and apps you connect to. Their terms and privacy policies
apply. We do not control them and are not responsible for their availability, accuracy, fees or conduct.

3.2 Buying crypto opens a provider's own page; that provider is responsible for the purchase, payment, identity
checks and refunds.

3.3 Clip Plugins (Advanced mode) are written by third parties. They run sandboxed and cannot sign or see your
keys, but what they show you is theirs, not ours.

3.4 **Swaps between networks** are carried out by SODAX and the parties that fill its swaps ("solvers"), not by
us. Clip Wallet gets SODAX's prices through a swap server (ExClip) and builds and checks the transaction you
sign. Your swap is filled only if a solver delivers at least the minimum shown on the quote and the approval
screen before the swap's deadline. If none does, the amount you sent stays with SODAX until the swap is cancelled, which Clip Wallet
cannot yet do for you. [If ColdAI runs the ExClip swap server, say so here and add it to section 5.]

## 4. Fees

> **For the owner's legal review (added 2026-11-02).** Counsel to confirm: that ColdAI LLC is the entity that
> receives the Clip fee; whether receiving it changes the statements in 1.2 in any market where Clip Wallet is
> offered; how consumer law there requires the fee to be disclosed, and whether any refund rules apply; and its tax
> treatment (including VAT or sales tax). Also to confirm with SODAX: what happens to the Clip fee when a swap is
> not filled and is cancelled (3.4). This draft doesn't say.

4.1 **Network fees.** Most transactions pay a fee to the network they run on. It goes to the network, not to us,
and Clip Wallet shows it before you approve.

4.2 **The Clip fee.** Each swap from one network to another through SODAX carries a fee of **0.875 % of the amount
you sell**, paid to ColdAI LLC (the "Clip fee"). It is part of the amount you sell, not added on top: if you sell
100 USDC, 0.875 USDC is the Clip fee and 99.125 USDC is swapped. It is rounded down to the smallest unit of the
token you sell, so it is never more than 0.875 %. Swaps within one network carry no Clip fee. Only main networks
offer these swaps, so this test version doesn't.

4.3 **You see it before you agree.** The quote and the approval screen show the Clip fee as a percentage and as an
amount of the token you sell, apart from the network fee, and name ColdAI LLC as the receiver. Clip Wallet refuses
to sign a swap whose fee is more than 0.875 % or would be paid to anyone but ColdAI LLC's reviewed address.

4.4 **Other parties' fees.** The rate SODAX quotes includes the costs of SODAX and its solvers. Providers of swaps
within one network, staking and buying charge their own fees under their own terms. We receive no part of those
fees. [Confirm that ColdAI has no referral or revenue-share arrangement with any provider.]

4.5 We will not raise the Clip fee or add a new fee without updating these terms and showing the new fee on the
quote and the approval screen before you agree to it. [Proposed by engineering; owner to confirm.]

## 5. ColdAI services

5.1 **Passkey backup** is optional and stores only an encrypted copy we cannot open. It is provided as a
convenience in addition to, not instead of, your recovery phrase. We may change, suspend or end the service;
we will try to give notice so you can make sure you have your recovery phrase. [Notice period.]

5.2 **Media proxy** loads collectible images for privacy. Images may fail to load or be withheld if they are
unsafe or too large.

5.3 We may limit use of these services to prevent abuse (for example rate limits).

## 6. Open-source software

The Clip Wallet source code is licensed under the Apache License 2.0. It grants no rights to the "Clip Wallet" or "1Mask" names or the Clip Wallet logo, which are ColdAI trademarks. Third-party components are licensed under their
own terms (see each package's licence). Builds published by ColdAI come with checksums and build provenance so
you can verify them.

## 7. Disclaimers

7.1 Clip Wallet is provided **"as is" and "as available"**, without warranties of any kind, express or implied,
including merchantability, fitness for a particular purpose, non-infringement, accuracy and uninterrupted or
error-free operation, to the maximum extent permitted by law.

7.2 Clip Wallet is pre-release software that has not been independently audited. It may contain bugs that cause
transactions to fail or behave unexpectedly.

## 8. Limitation of liability

To the maximum extent permitted by law, ColdAI will not be liable for any indirect, incidental, special,
consequential or punitive damages, or for loss of assets, profits, data or goodwill, arising from your use of
Clip Wallet, including losses caused by lost recovery phrases, compromised devices or accounts, third-party
services, network failures, or transactions you approved. [Aggregate cap and consumer-law carve-outs to be set by
counsel; some jurisdictions do not allow these exclusions.]

## 9. Changes and termination

We may update these terms; the date above will change and material changes will be noted in the release notes.
You can stop using Clip Wallet at any time by uninstalling it (keep your recovery phrase). We may stop
distributing or supporting Clip Wallet or any service.

## 10. Governing law and disputes

[Governing law, venue, arbitration or court jurisdiction, and consumer rights notices to be completed by counsel.]

## 11. Contact

[Contact email / address]. Security issues: see `SECURITY.md` (private disclosure).
