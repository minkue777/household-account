import type {
  HouseholdGuardInput,
  HouseholdGuardInputPort,
  HouseholdGuardResult,
} from "./ports/in/householdGuardInputPort";
import type { ProtectedHouseholdContentPort } from "./ports/out/protectedHouseholdContentPort";
import { decideHouseholdGuard } from "../domain/policies/householdGuardPolicy";

export interface HouseholdGuardApplicationDependencies {
  protectedContent: ProtectedHouseholdContentPort;
}

class DefaultHouseholdGuardApplication implements HouseholdGuardInputPort {
  constructor(
    private readonly dependencies: HouseholdGuardApplicationDependencies,
  ) {}

  async enter(input: HouseholdGuardInput): Promise<HouseholdGuardResult> {
    const decision = decideHouseholdGuard(input);
    if (decision.kind === "protected-content") {
      await this.dependencies.protectedContent.openMemberContent(decision.actor);
    } else if (decision.kind === "admin-content") {
      await this.dependencies.protectedContent.openAdministratorContent(
        decision.householdId,
      );
    }
    return decision;
  }
}

export function createHouseholdGuardApplication(
  dependencies: HouseholdGuardApplicationDependencies,
): HouseholdGuardInputPort {
  return new DefaultHouseholdGuardApplication(dependencies);
}
