import type {
  AnnualProjectionView,
  ProjectionChange,
  ProjectionEventFact,
  ProjectionWriteResult,
} from "../../../domain/model/dividendProjection";

export interface DividendProjectionWriter {
  handle(change: ProjectionChange): Promise<ProjectionWriteResult>;
  attemptDirectOverwrite(input: {
    actor: "anonymous" | "member";
    projection: AnnualProjectionView;
  }): Promise<ProjectionWriteResult>;
  rebuild(
    canonicalEvents: readonly ProjectionEventFact[],
  ): Promise<ProjectionWriteResult>;
  currentProjection(): AnnualProjectionView;
}
