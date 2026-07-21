export interface ProjectionEventFact {
  eventId: string;
  paymentDate: string;
  totalAmount: number;
  status: "fixed" | "paid";
  aggregateVersion: number;
}

export interface AnnualProjectionView {
  monthlyAmounts: readonly number[];
  events: Readonly<Record<string, ProjectionEventFact>>;
  sourceCheckpoint: string;
  freshness: "fresh" | "rebuilding";
}

export type ProjectionChange =
  | {
      eventType: "DividendEventChanged.v1";
      eventId: string;
      aggregateVersion: number;
      event: ProjectionEventFact;
      checkpoint: string;
    }
  | {
      eventType: "DividendEventRemoved.v1";
      eventId: string;
      aggregateVersion: number;
      checkpoint: string;
    };

export type ProjectionWriteResult =
  | { kind: "success"; value: AnnualProjectionView }
  | { kind: "already-processed"; value: AnnualProjectionView }
  | { kind: "rebuild-required"; value: AnnualProjectionView }
  | { kind: "forbidden"; code: "DIVIDEND_PROJECTION_WRITE_FORBIDDEN" };
