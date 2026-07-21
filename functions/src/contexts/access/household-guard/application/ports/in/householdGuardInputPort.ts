import type {
  HouseholdGuardDecision,
  HouseholdGuardFacts,
} from "../../../domain/model/householdGuard";

export type HouseholdGuardInput = HouseholdGuardFacts;
export type HouseholdGuardResult = HouseholdGuardDecision;

export interface HouseholdGuardInputPort {
  enter(input: HouseholdGuardInput): Promise<HouseholdGuardResult>;
}
