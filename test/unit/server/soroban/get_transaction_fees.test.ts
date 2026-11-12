import { describe, expect, it } from "vitest";
import { rpc, xdr } from "../../../../src/index.js";

const source = xdr.MuxedAccount.keyTypeEd25519(new Uint8Array(32));
const base = {
  txHash: "00".repeat(32),
  latestLedger: 100,
  latestLedgerCloseTime: 1000,
  oldestLedger: 1,
  oldestLedgerCloseTime: 10,
};

function envelope(resource: bigint | null = 1000n, max = 1500) {
  return xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({
      signatures: [],
      tx: new xdr.Transaction({
        sourceAccount: source,
        fee: max,
        seqNum: 1n,
        cond: xdr.Preconditions.precondNone(),
        memo: xdr.Memo.memoNone(),
        operations: [],
        ext:
          resource === null
            ? xdr.TransactionExt.v0()
            : xdr.TransactionExt.sorobanData(
                new xdr.SorobanTransactionData({
                  ext: xdr.SorobanTransactionDataExt.v0(),
                  resourceFee: resource,
                  resources: new xdr.SorobanResources({
                    footprint: new xdr.LedgerFootprint({
                      readOnly: [],
                      readWrite: [],
                    }),
                    instructions: 0,
                    diskReadBytes: 0,
                    writeBytes: 0,
                  }),
                }),
              ),
      }),
    }),
  );
}

function metadata(
  version: 3 | 4,
  details: xdr.SorobanTransactionMetaExt | null = feeDetails(),
): xdr.TransactionMeta {
  const common = {
    ext: xdr.ExtensionPoint.v0(),
    txChangesBefore: [],
    operations: [],
    txChangesAfter: [],
  };
  return version === 3
    ? xdr.TransactionMeta.v3(
        new xdr.TransactionMetaV3({
          ...common,
          sorobanMeta:
            details === null
              ? null
              : new xdr.SorobanTransactionMeta({
                  ext: details,
                  events: [],
                  returnValue: xdr.ScVal.scvVoid(),
                  diagnosticEvents: [],
                }),
        }),
      )
    : xdr.TransactionMeta.v4(
        new xdr.TransactionMetaV4({
          ...common,
          sorobanMeta:
            details === null
              ? null
              : new xdr.SorobanTransactionMetaV2({
                  ext: details,
                  returnValue: null,
                }),
          events: [],
          diagnosticEvents: [],
        }),
      );
}

function feeDetails(nonRefundable = 200n, refundable = 300n, rent = 100n) {
  return xdr.SorobanTransactionMetaExt.v1(
    new xdr.SorobanTransactionMetaExtV1({
      ext: xdr.ExtensionPoint.v0(),
      totalNonRefundableResourceFeeCharged: nonRefundable,
      totalRefundableResourceFeeCharged: refundable,
      rentFeeCharged: rent,
    }),
  );
}

function response(
  envelopeXdr: xdr.TransactionEnvelope = envelope(),
  resultMetaXdr: xdr.TransactionMeta = metadata(3),
  total = 600n,
  failed = false,
):
  | rpc.Api.GetSuccessfulTransactionResponse
  | rpc.Api.GetFailedTransactionResponse {
  const inner = new xdr.InnerTransactionResultPair({
    transactionHash: new Uint8Array(32),
    result: new xdr.InnerTransactionResult({
      feeCharged: 0n,
      result: failed
        ? xdr.InnerTransactionResultResult.txFailed([])
        : xdr.InnerTransactionResultResult.txSuccess([]),
      ext: xdr.InnerTransactionResultExt.v0(),
    }),
  });
  return {
    ...base,
    status: failed
      ? rpc.Api.GetTransactionStatus.FAILED
      : rpc.Api.GetTransactionStatus.SUCCESS,
    ledger: 50,
    createdAt: 500,
    applicationOrder: 1,
    feeBump: envelopeXdr.type === "envelopeTypeTxFeeBump",
    envelopeXdr,
    resultMetaXdr,
    resultXdr: new xdr.TransactionResult({
      feeCharged: total,
      result:
        envelopeXdr.type === "envelopeTypeTxFeeBump"
          ? failed
            ? xdr.TransactionResultResult.txFeeBumpInnerFailed(inner)
            : xdr.TransactionResultResult.txFeeBumpInnerSuccess(inner)
          : failed
            ? xdr.TransactionResultResult.txFailed([])
            : xdr.TransactionResultResult.txSuccess([]),
      ext: xdr.TransactionResultExt.v0(),
    }),
    events: { contractEventsXdr: [], transactionEventsXdr: [] },
  };
}

function bump(resource: bigint | null = 1000n, max = 2500n) {
  return xdr.TransactionEnvelope.envelopeTypeTxFeeBump(
    new xdr.FeeBumpTransactionEnvelope({
      signatures: [],
      tx: new xdr.FeeBumpTransaction({
        feeSource: source,
        fee: max,
        innerTx: xdr.FeeBumpTransactionInnerTx.envelopeTypeTx(
          envelope(resource).v1,
        ),
        ext: xdr.FeeBumpTransactionExt.v0(),
      }),
    }),
  );
}

const unavailable = {
  resource: null,
  inclusion: null,
  nonRefundable: null,
  refundable: null,
  rent: null,
};

function expected(
  max = "1500",
  resource = "1000",
  total = "600",
  refundable = "300",
  rent = "100",
) {
  return {
    declared: {
      max,
      resource,
      inclusion: (BigInt(max) - BigInt(resource)).toString(),
    },
    charged: {
      total,
      resource: (200n + BigInt(refundable)).toString(),
      inclusion: (BigInt(total) - 200n - BigInt(refundable)).toString(),
      nonRefundable: "200",
      refundable,
      rent,
    },
    refunded: (BigInt(resource) - 200n - BigInt(refundable)).toString(),
  };
}

describe("rpc.getTransactionFees", () => {
  it("returns null for NOT_FOUND without requiring transaction data", () => {
    const missing: rpc.Api.GetMissingTransactionResponse = {
      ...base,
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    };
    expect(rpc.getTransactionFees(missing)).toBeNull();
  });

  const classicV0 = xdr.TransactionEnvelope.envelopeTypeTxV0(
    new xdr.TransactionV0Envelope({
      signatures: [],
      tx: new xdr.TransactionV0({
        sourceAccountEd25519: new Uint8Array(32),
        fee: 1500,
        seqNum: 1n,
        timeBounds: null,
        memo: xdr.Memo.memoNone(),
        operations: [],
        ext: xdr.TransactionV0Ext.v0(),
      }),
    }),
  );

  for (const [name, tx] of [
    ["v0", classicV0],
    ["v1", envelope(null)],
    ["fee bump", bump(null)],
  ] as const) {
    it(`reports classic ${name} fees without a resource breakdown even with fee metadata`, () => {
      expect(rpc.getTransactionFees(response(tx))).toEqual({
        declared: {
          max: name === "fee bump" ? "2500" : "1500",
          resource: null,
          inclusion: name === "fee bump" ? "2500" : "1500",
        },
        charged: { total: "600", ...unavailable },
        refunded: null,
      });
    });
  }

  for (const version of [3, 4] as const) {
    it(`uses v${version}/ext v1 arithmetic without counting rent twice`, () => {
      expect(
        rpc.getTransactionFees(response(envelope(), metadata(version))),
      ).toEqual(expected());
    });

    it(`preserves known zero refundable fees for failed v${version} transactions`, () => {
      expect(
        rpc.getTransactionFees(
          response(
            envelope(),
            metadata(version, feeDetails(200n, 0n, 0n)),
            300n,
            true,
          ),
        ),
      ).toEqual(expected("1500", "1000", "300", "0", "0"));
    });

    for (const [name, ext] of [
      ["ext v0", xdr.SorobanTransactionMetaExt.v0()],
      ["null Soroban metadata", null],
    ] as const) {
      it(`leaves unavailable v${version} ${name} breakdowns null`, () => {
        expect(
          rpc.getTransactionFees(response(envelope(), metadata(version, ext))),
        ).toEqual({
          declared: { max: "1500", resource: "1000", inclusion: "500" },
          charged: { total: "600", ...unavailable },
          refunded: null,
        });
      });
    }

    for (const failed of [false, true]) {
      it(`uses outer fee-bump max/charge and inner resource budget for v${version}, failed=${failed}`, () => {
        expect(
          rpc.getTransactionFees(
            response(bump(), metadata(version), 600n, failed),
          ),
        ).toEqual(expected("2500"));
      });
    }
  }

  const unsupported = [
    xdr.TransactionMeta.operations([]),
    xdr.TransactionMeta.v1(
      new xdr.TransactionMetaV1({ txChanges: [], operations: [] }),
    ),
    xdr.TransactionMeta.v2(
      new xdr.TransactionMetaV2({
        txChangesBefore: [],
        operations: [],
        txChangesAfter: [],
      }),
    ),
  ];
  unsupported.forEach((meta, version) => {
    it(`falls back to null breakdowns for unsupported metadata v${version}`, () => {
      expect(rpc.getTransactionFees(response(envelope(), meta))).toEqual({
        declared: { max: "1500", resource: "1000", inclusion: "500" },
        charged: { total: "600", ...unavailable },
        refunded: null,
      });
    });
  });

  it("preserves bigint precision in declarations, charges, subtraction, and refunds", () => {
    const tx = response(
      bump(9007199254741999n, 9007199254742999n),
      metadata(4, feeDetails(9007199254740993n, 301n, 101n)),
      9007199254741499n,
    );
    expect(rpc.getTransactionFees(tx)).toEqual({
      declared: {
        max: "9007199254742999",
        resource: "9007199254741999",
        inclusion: "1000",
      },
      charged: {
        total: "9007199254741499",
        resource: "9007199254741294",
        inclusion: "205",
        nonRefundable: "9007199254740993",
        refundable: "301",
        rent: "101",
      },
      refunded: "705",
    });
  });

  it("does not mutate the response or its XDR values and returns independent summaries", () => {
    const tx = response(bump(), metadata(4));
    const before = structuredClone(tx);
    const serialized = [
      tx.envelopeXdr.toXDR("base64"),
      tx.resultXdr.toXDR("base64"),
      tx.resultMetaXdr.toXDR("base64"),
    ];
    const first = rpc.getTransactionFees(tx);
    expect(first).toEqual(expected("2500"));
    expect(structuredClone(tx)).toEqual(before);
    expect([
      tx.envelopeXdr.toXDR("base64"),
      tx.resultXdr.toXDR("base64"),
      tx.resultMetaXdr.toXDR("base64"),
    ]).toEqual(serialized);
    if (first === null) throw new Error("Expected fees");
    first.declared.max = "0";
    first.charged.total = "0";
    expect(rpc.getTransactionFees(tx)).toEqual(expected("2500"));
  });
});
