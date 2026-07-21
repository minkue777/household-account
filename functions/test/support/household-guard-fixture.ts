import { createHouseholdGuardApplication } from "../../src/contexts/access/household-guard/application/householdGuardApplication";
import type { ProtectedHouseholdContentPort } from "../../src/contexts/access/household-guard/application/ports/out/protectedHouseholdContentPort";
import type { HouseholdGuardInputPort } from "../../src/contexts/access/public";

export interface HouseholdGuardFixtureSubject extends HouseholdGuardInputPort {
  displayedHouseholdIds(): readonly string[];
}

class RecordingProtectedHouseholdContentPort
  implements ProtectedHouseholdContentPort
{
  private readonly openedHouseholdIds: string[] = [];

  async openMemberContent(input: {
    householdId: string;
    memberId: string;
  }): Promise<void> {
    this.openedHouseholdIds.push(input.householdId);
  }

  async openAdministratorContent(householdId: string): Promise<void> {
    this.openedHouseholdIds.push(householdId);
  }

  displayedHouseholdIds(): readonly string[] {
    return [...this.openedHouseholdIds];
  }
}

class HouseholdGuardFixtureDriver implements HouseholdGuardFixtureSubject {
  constructor(
    private readonly application: HouseholdGuardInputPort,
    private readonly content: RecordingProtectedHouseholdContentPort,
  ) {}

  enter(...args: Parameters<HouseholdGuardInputPort["enter"]>) {
    return this.application.enter(...args);
  }

  displayedHouseholdIds(): readonly string[] {
    return this.content.displayedHouseholdIds();
  }
}

export function createHouseholdGuardFixtureSubject(): HouseholdGuardFixtureSubject {
  const content = new RecordingProtectedHouseholdContentPort();
  return new HouseholdGuardFixtureDriver(
    createHouseholdGuardApplication({ protectedContent: content }),
    content,
  );
}
