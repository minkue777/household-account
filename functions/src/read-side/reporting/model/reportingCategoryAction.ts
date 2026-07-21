export interface ReportingCategoryDetailRow {
  transactionId: string;
  merchant: string;
  amountInWon: number;
  aggregateVersion: number;
}

export type ReportingCategoryAction =
  | {
      kind: "update-transaction";
      transactionId: string;
      expectedVersion: number;
      merchant: string;
      amountInWon: number;
    }
  | {
      kind: "delete-transaction";
      transactionId: string;
      expectedVersion: number;
    }
  | {
      kind: "save-merchant-rule";
      candidate: { merchant: string; categoryId: string };
    };

export type ReportingUpstreamActionResult =
  | { kind: "success" }
  | { kind: "conflict"; code: string }
  | { kind: "failure"; code: string };

export interface ReportingCategoryActionResult {
  kind: "success" | "conflict" | "failure";
  rows: readonly ReportingCategoryDetailRow[];
  queryRevision: number;
  code?: string;
}
