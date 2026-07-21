export {
  advanceDividendEvent,
  createDividendEventId,
  upsertDividendAnnouncement,
  validateDividendStateTransition,
  type DividendChangedEvent,
  type DividendDisclosureInput,
  type DividendEvent,
  type DividendMutationOutcome,
  type DividendStatus,
  type DividendTransitionResult,
  type DividendUpsertOutcome,
} from "./domain/entities/dividendEvent";

export type { DividendReadPolicies } from "./application/ports/in/dividendReadPolicies";
export type {
  AnnualDividendView,
  DividendEventFact,
  UpcomingDividendResult,
} from "./domain/model/dividendRead";

export type { DividendLifecycle } from "./application/ports/in/dividendLifecycle";
export type {
  AnnualDividendProjection,
  DividendCommandResult,
  DividendDisclosure,
  DividendEligibilityContribution,
  DividendEventView,
  DividendIntegrationEvent,
  PositionSnapshot,
} from "./domain/model/dividendLifecycle";

export type { DividendProjectionWriter } from "./application/ports/in/dividendProjectionWriter";
export type {
  AnnualProjectionView,
  ProjectionChange,
  ProjectionEventFact,
  ProjectionWriteResult,
} from "./domain/model/dividendProjection";

export type { DividendDiscovery } from "./application/ports/in/dividendDiscovery";
export type {
  DisclosureRequestObservation,
  DividendAnnouncementEvent,
  DividendRefreshResult,
  RunDividendDiscoveryCommand,
} from "./domain/model/dividendDiscovery";

export type { DividendRefreshJob } from "./application/ports/in/dividendRefreshJob";
export type {
  DividendRefreshJobEvent,
  DividendRefreshJobResult,
  DividendRefreshSchedule,
  RefreshDisclosure,
} from "./domain/model/dividendRefreshJob";

export type { DividendSweepRecovery } from "./application/ports/in/dividendSweepRecovery";
export type {
  DividendCorrectionResult,
  DividendSweepReceipt,
  DividendSweepResult,
  EligibilityEvidence,
  PositionHistoryObservation,
  RecoverEligibilityResult,
  SweepDividendChangedEvent,
  SweepDividendEventView,
} from "./domain/model/dividendSweepRecovery";
