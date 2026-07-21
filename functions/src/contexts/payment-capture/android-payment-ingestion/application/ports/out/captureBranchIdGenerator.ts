export interface CaptureBranchIdGenerator {
  next(kind: "payment" | "balance"): string;
}
