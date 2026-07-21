export interface AdminHousehold {
  householdId: string;
  name: string;
  createdAt: string;
  lifecycleState: "active" | "deleted";
  aggregateVersion: number;
  legacyShareKey?: string;
}

export interface AdminHouseholdEvent {
  eventType: "HouseholdCreated.v1" | "HouseholdDeleted.v1";
  householdId: string;
}

export interface AdminHouseholdState {
  households: readonly AdminHousehold[];
  events: readonly AdminHouseholdEvent[];
}
