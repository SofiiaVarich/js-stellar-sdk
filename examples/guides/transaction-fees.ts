/** Runnable snippets for docs/guides/08-transaction-fees.md. */
// #region full
// #region connect
import {
  Asset,
  BASE_FEE,
  Contract,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  contract,
  inspectTransaction,
  rpc,
} from "@stellar/stellar-sdk";
// #endregion full
import { deployWasm } from "./setup/deploy.js";
// #region full

const rpcUrl = "https://soroban-testnet.stellar.org";
const networkPassphrase = Networks.TESTNET;
const server = new rpc.Server(rpcUrl);
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const keypair = Keypair.random();
await server.fundAddress(keypair.publicKey());
// #endregion connect

// #region bids
// Example policy, not a recommended percentile or cap. This caps only the
// inclusion bid per operation, not the separate Soroban resource fee.
const inclusionCap = 10_000n;
function cappedBid(observed: string): string {
  const bid = BigInt(observed);
  const floor = BigInt(BASE_FEE);
  return (
    bid < floor ? floor : bid > inclusionCap ? inclusionCap : bid
  ).toString();
}

const stats = await server.getFeeStats();
const classicBid = cappedBid(stats.inclusionFee.p90);
const contractBid = cappedBid(stats.sorobanInclusionFee.p90);

// Horizon is another source for classic transaction fee statistics.
const horizonStats = await horizon.feeStats();
const horizonBid = cappedBid(horizonStats.fee_charged.p90);
// #endregion bids

// #region classic
const payment = new TransactionBuilder(
  await horizon.loadAccount(keypair.publicKey()),
  { fee: horizonBid, networkPassphrase }, // or classicBid from RPC
)
  .addOperation(
    Operation.payment({
      destination: keypair.publicKey(),
      asset: Asset.native(),
      amount: "1",
    }),
  )
  .setTimeout(60)
  .build();
payment.sign(keypair);
const paid = await horizon.submitTransaction(payment);
const paymentRecord = await horizon
  .transactions()
  .transaction(paid.hash)
  .call();
console.log("Classic fee charged (stroops):", paymentRecord.fee_charged);
// #endregion classic
// #endregion full
if (!paid.successful || BigInt(classicBid) > inclusionCap) {
  throw new Error("classic fee example failed");
}
// #region full
let contractId = "C..."; // your deployed increment contract
// #endregion full
contractId = await deployWasm(
  { rpcUrl, networkPassphrase, keypair },
  "increment.wasm",
);
// #region full
// Set contractId to your deployed increment contract's ID.
// #region prepare
const transaction = new TransactionBuilder(
  await server.getAccount(keypair.publicKey()),
  { fee: contractBid, networkPassphrase }, // inclusion bid only
)
  .addOperation(new Contract(contractId).call("increment"))
  .setTimeout(60)
  .build();
const prepared = await server.prepareTransaction(transaction);
// Simulation supplies the resource fee, footprint, and authorization entries.
// #endregion prepare

// #region inspect
const summary = inspectTransaction(prepared);
if (!("fees" in summary)) throw new Error("Expected an ordinary transaction");
const fees = summary.fees;
console.log("Maximum total (stroops):", fees.max);
console.log("Resource budget (stroops):", fees.resource);
console.log("Inclusion bid total (stroops):", fees.inclusion);
// #endregion inspect
// #endregion full
if (
  fees.resource === null ||
  BigInt(fees.max) !== BigInt(fees.resource) + BigInt(fees.inclusion) ||
  fees.inclusion !== contractBid
) {
  throw new Error(
    "prepared fee breakdown does not match the bid and resource fee",
  );
}
// #region full

// #region charged
prepared.sign(keypair);
const sent = await server.sendTransaction(prepared);
if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
  throw new Error(`Not queued: ${sent.status}`);
}
const landed = await server.pollTransaction(sent.hash);
if (
  landed.status !== rpc.Api.GetTransactionStatus.SUCCESS &&
  landed.status !== rpc.Api.GetTransactionStatus.FAILED
) {
  throw new Error(`Not confirmed: ${landed.status}`);
}
console.log("Fee charged (stroops):", landed.resultXdr.feeCharged.toString());
// #endregion charged
// #endregion full
if (
  landed.status !== rpc.Api.GetTransactionStatus.SUCCESS ||
  landed.resultXdr.feeCharged > BigInt(fees.max)
) {
  throw new Error("contract fee example failed or exceeded its maximum");
}
// #region full

// #region client
interface IncrementContract {
  increment: (
    options?: contract.MethodOptions,
  ) => Promise<contract.AssembledTransaction<number>>;
}
const client = await contract.Client.from<IncrementContract>({
  contractId,
  rpcUrl,
  networkPassphrase,
  publicKey: keypair.publicKey(),
  ...contract.basicNodeSigner(keypair, networkPassphrase),
});
const call = await client.increment({ fee: contractBid });
// The client simulates automatically and adds the resource fee too.
if (!call.built) throw new Error("Missing simulated transaction");
const clientSummary = inspectTransaction(call.built);
if (!("fees" in clientSummary))
  throw new Error("Expected an ordinary transaction");
console.log("Client fee upper bound:", clientSummary.fees);
await call.signAndSend();
// #endregion client
// #endregion full
