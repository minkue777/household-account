export interface VerifiedAdminActor {
  principalRef: string;
  capabilities: readonly (
    | "admin.households.read"
    | "admin.households.write"
    | "household.delete"
  )[];
}

export interface AdminHouseholdView {
  householdId: string;
  name: string;
  createdAt: string;
  lifecycleState: "active" | "deleted";
  aggregateVersion: number;
  legacyShareKey?: string;
}

export type AdminConsoleResult<T> =
  | { kind: "success"; value: T }
  | { kind: "forbidden"; code: string }
  | { kind: "validation-error"; code: string };

export interface AdminHouseholdPage {
  items: readonly AdminHouseholdView[];
  nextCursor?: string;
}

export interface AdminHouseholdConsoleInputPort {
  open(actor: VerifiedAdminActor): Promise<AdminConsoleResult<"opened">>;
  listHouseholds(input: {
    cursor?: string;
    limit: number;
  }): Promise<AdminConsoleResult<AdminHouseholdPage>>;
  createHousehold(input: {
    name: string;
    idempotencyKey: string;
  }): Promise<AdminConsoleResult<AdminHouseholdView>>;
  copyLegacyShareKey(
    householdId: string,
  ): Promise<AdminConsoleResult<{ copied: true }>>;
  deleteHousehold(input: {
    householdId: string;
    confirmed: boolean;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<AdminConsoleResult<AdminHouseholdView>>;
}
