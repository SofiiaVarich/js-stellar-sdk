import { Api } from "./api.js";

/** Declared and charged transaction fees, as decimal strings in stroops. */
export interface TransactionFees {
  /** Maximum amounts declared in the envelope, not the amounts paid. */
  declared: {
    /** Outer maximum for fee-bump transactions. */
    max: string;
    /** Declared resource budget, or null for classic transactions. */
    resource: string | null;
    /** Total inclusion bid (not per operation). */
    inclusion: string;
  };
  charged: {
    /** Total paid by the fee source, including for failed transactions. */
    total: string;
    /** Resource charges, or null when Soroban fee metadata is unavailable. */
    resource: string | null;
    /** Inclusion charge, or null when Soroban fee metadata is unavailable. */
    inclusion: string | null;
    /** Non-refundable resource charge, or null when unavailable. */
    nonRefundable: string | null;
    /** Refundable resource charge, including rent, or null when unavailable. */
    refundable: string | null;
    /** Rent charge, already included in refundable, or null when unavailable. */
    rent: string | null;
  };
  /** Unused resource budget returned to the payer, or null when unavailable. */
  refunded: string | null;
}

/**
 * Reports declared and charged fees from a parsed RPC transaction response.
 * Makes no network calls. All amounts are decimal strings in stroops.
 *
 * Soroban fee details are available from metadata v3/v4 with Soroban extension
 * v1. For classic transactions or other metadata versions, charged.total and
 * declared fees remain available, but the charged breakdown and refund are
 * null. A missing breakdown is not a known zero charge.
 *
 * Rent is part of the refundable resource charge, not an additional fee.
 * Failed transactions can pay fees; the metadata reports their actual charges.
 * For fee bumps, the outer result reports what the fee source paid; the inner
 * result's feeCharged is always zero and is not used.
 *
 * @param response - a parsed response from {@link rpc.Server.getTransaction}
 * @returns the fee summary, or null if the transaction is NOT_FOUND
 *
 * @example
 * ```ts
 * const response = await server.getTransaction(hash);
 * const fees = rpc.getTransactionFees(response);
 * if (fees) {
 *   console.log("Maximum bid:", fees.declared.max);
 *   console.log("Total paid:", fees.charged.total);
 *   console.log("Resource refund:", fees.refunded);
 * }
 * ```
 * @see {@link inspectTransaction} for inspecting fees before submission
 */
export function getTransactionFees(
  response: Api.GetTransactionResponse,
): TransactionFees | null {
  if (response.status === Api.GetTransactionStatus.NOT_FOUND) return null;

  const envelope = response.envelopeXdr;
  const max = BigInt(
    envelope.type === "envelopeTypeTxFeeBump"
      ? envelope.feeBump.tx.fee
      : envelope.type === "envelopeTypeTx"
        ? envelope.v1.tx.fee
        : envelope.v0.tx.fee,
  );
  const transaction =
    envelope.type === "envelopeTypeTxFeeBump"
      ? envelope.feeBump.tx.innerTx.v1.tx
      : envelope.type === "envelopeTypeTx"
        ? envelope.v1.tx
        : null;
  const resource =
    transaction?.ext.type === "sorobanData"
      ? transaction.ext.sorobanData.resourceFee
      : null;
  const total = response.resultXdr.feeCharged;
  const fees: TransactionFees = {
    declared: {
      max: max.toString(),
      resource: resource?.toString() ?? null,
      inclusion: (max - (resource ?? 0n)).toString(),
    },
    charged: {
      total: total.toString(),
      resource: null,
      inclusion: null,
      nonRefundable: null,
      refundable: null,
      rent: null,
    },
    refunded: null,
  };

  const meta = response.resultMetaXdr;
  const sorobanMeta =
    meta.type === "v3"
      ? meta.v3.sorobanMeta
      : meta.type === "v4"
        ? meta.v4.sorobanMeta
        : null;
  if (resource !== null && sorobanMeta?.ext.type === "v1") {
    const details = sorobanMeta.ext.v1;
    const nonRefundable = details.totalNonRefundableResourceFeeCharged;
    const refundable = details.totalRefundableResourceFeeCharged;
    const resourceCharged = nonRefundable + refundable;
    fees.charged = {
      total: total.toString(),
      resource: resourceCharged.toString(),
      inclusion: (total - resourceCharged).toString(),
      nonRefundable: nonRefundable.toString(),
      refundable: refundable.toString(),
      rent: details.rentFeeCharged.toString(),
    };
    fees.refunded = (resource - resourceCharged).toString();
  }
  return fees;
}
