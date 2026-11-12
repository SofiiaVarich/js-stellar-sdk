---
title: Transaction Fees
description:
  Choose capped inclusion bids, prepare contract resource fees, inspect the
  maximum cost, and read the fee charged after confirmation.
---

# Transaction Fees

A transaction's `fee` option is a **maximum inclusion bid per operation**, in
stroops (10,000,000 stroops = 1 XLM). Included transactions pay the network's
**clearing price**, not necessarily their bid. `BASE_FEE` is the network minimum
(currently 100 stroops), not a recommended fee for current traffic.

A Soroban transaction has two fee components:

- **Inclusion:** your bid to get into a ledger. This is the `fee` passed to
  `TransactionBuilder` or a contract client's method options.
- **Resources:** the budget for executing the contract and storing its data.
  Simulation supplies this separately; `prepareTransaction` and the contract
  client add it to the transaction's total fee.

Increasing the inclusion bid does not increase the resource budget. The cap on
that bid is **not a cap on the entire Soroban transaction fee**.

This guide covers the SDK plumbing, not a bidding strategy. For choosing
percentiles and understanding surge pricing, see Stellar's
[inclusion fee pricing strategies](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering#inclusion-fee-pricing-strategies).

## Prerequisites and connection

Use Node.js and the SDK, as in
[Connect and Fund an Account](/guides/01-connect-and-fund/). The example funds a
throwaway account on testnet. For the contract sections, use a deployed
increment contract as in [Invoke a Contract](/guides/06-invoke-a-contract/).
Never use a production secret key in these examples.

<!-- snippet: transaction-fees.ts#connect -->

## Choose a capped inclusion bid

`rpc.Server.getFeeStats()` returns **two distributions**: use `inclusionFee` for
classic transactions and `sorobanInclusionFee` for contract transactions.
Neither includes the contract resource fee. `Horizon.Server.feeStats()` is
another source for classic transactions; its `fee_charged` distribution reports
charged per-operation fees.

The example uses `p90` with a 10,000-stroop per-operation cap and the network
minimum as a floor. These are illustrative policy choices, **not
recommendations**. If the clearing price exceeds your cap, the transaction may
not land. Use integer arithmetic for stroop amounts rather than floating-point
XLM conversions.

<!-- snippet: transaction-fees.ts#bids -->

## Classic transactions

Pass either classic bid to `TransactionBuilder`. The builder multiplies it by
the number of operations to set the transaction's maximum inclusion fee. Here
there is one operation: a payment back to the funded source account.

<!-- snippet: transaction-fees.ts#classic -->

## Contract calls: the two preparation paths

### TransactionBuilder and prepareTransaction

Use the **Soroban** inclusion distribution for the builder's `fee`. Then call
`prepareTransaction` before signing: simulation sets the resource fee and the
other data needed to execute the call. `contractId` below is your deployed
increment contract's ID.

<!-- snippet: transaction-fees.ts#prepare -->

### Contract client

The same bid goes in the method's `MethodOptions.fee`. The client simulates by
default, so it adds the resource fee automatically. Passing `simulate: false`
skips that preparation; it does not eliminate resource fees.

<!-- snippet: transaction-fees.ts#client -->

For both paths, simulate against current state and inspect the prepared total
before approving or signing it. An inclusion cap alone cannot enforce your
application's total spending limit.

## Before sending: inspect the upper bound

`inspectTransaction(prepared).fees` reports decimal strings in stroops:

- `max`: the maximum total declared by the transaction.
- `resource`: the resource budget (`null` for classic transactions).
- `inclusion`: the total inclusion bid, excluding resources.

<!-- snippet: transaction-fees.ts#inspect -->

The final cost can be lower: inclusion is charged at the clearing price, and
unused refundable resources (rent, events, and return value) are refunded.
Non-refundable resource charges are not refunded. Treat `max` as an upper bound,
not a prediction or a guaranteed charge.

For a fee-bump transaction, inspect the outer summary's `maxFee`; the inner
transaction's `fees` alone does not describe the fee payer's outer cap.

## After it lands: read what was charged

`sendTransaction` only queues a transaction. Wait for confirmation with
`pollTransaction`, then read the parsed `resultXdr.feeCharged` bigint. It is
available for both successful and failed confirmed transactions: an applied
transaction can pay fees even when its operations fail. There is no dedicated
charged-fee helper in this SDK version.

<!-- snippet: transaction-fees.ts#charged -->

For Horizon submissions, read `fee_charged` from the transaction response, as in
the classic example. For a fee bump, use the **outer** transaction result's
`feeCharged`, not its inner result.

## When it does not land

Horizon's `tx_insufficient_fee` (RPC's `errorResult.result.type` of
`txInsufficientFee`) means the declared fee was too small. RPC's
`TRY_AGAIN_LATER` means the transaction was not queued; it is not confirmation
that the bid alone was the problem. Refresh fee statistics and check network
conditions before retrying.

If your inclusion bid is too low, rebuild with a higher bid within your policy,
prepare contract transactions again, and **sign again**. Check the original
hash's status and the account sequence before rebuilding so you do not submit
the same action twice. An alternative is to wrap the signed transaction in a
[fee-bump transaction](https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions),
using `TransactionBuilder.buildFeeBumpTransaction` to raise its inclusion bid
without changing the inner signatures. The outer transaction needs its fee
payer's signature. A fee bump does not increase the contract's resource budget.

Do not confuse insufficient inclusion fees with an insufficient refundable
resource fee: raising `MethodOptions.fee` does not fix the latter. See
[Handle Errors](/guides/05-handle-errors/) for inspecting submission errors.

## Put it together

Set `contractId` to your deployed increment contract. This script sends a
classic payment, prepares and submits a raw contract call, and then sends
another call through the contract client. The runnable test supplies its own
deployed contract.

<!-- snippet: transaction-fees.ts#full -->
