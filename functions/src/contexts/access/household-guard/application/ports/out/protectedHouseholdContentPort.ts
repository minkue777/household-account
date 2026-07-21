export interface ProtectedHouseholdContentPort {
  openMemberContent(input: {
    householdId: string;
    memberId: string;
  }): Promise<void>;
  openAdministratorContent(householdId: string): Promise<void>;
}
