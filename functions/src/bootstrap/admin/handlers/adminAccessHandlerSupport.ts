import type { HouseholdAdministratorActor } from "../../commands/householdCommand";
import { AdminAccessRejection } from "../adminAccess";

export function exactKeys(
  payload: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(payload).every((key) => allowedKeys.has(key));
}

export function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdminAccessRejection(code);
  }
  return value.trim();
}

export function requiredVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AdminAccessRejection("EXPECTED_VERSION_REQUIRED");
  }
  return value;
}

export function reject(
  result: { readonly code?: string },
  fallback: string,
): never {
  throw new AdminAccessRejection(result.code ?? fallback);
}

export function householdConsoleCapabilities(
  capabilities: HouseholdAdministratorActor["capabilities"],
): readonly (
  | "admin.households.read"
  | "admin.households.write"
  | "household.delete"
)[] {
  return capabilities.filter(
    (
      capability,
    ): capability is
      | "admin.households.read"
      | "admin.households.write"
      | "household.delete" =>
      capability === "admin.households.read" ||
      capability === "admin.households.write" ||
      capability === "household.delete",
  );
}

export function householdLifecycleCapabilities(
  capabilities: HouseholdAdministratorActor["capabilities"],
): readonly ("household.delete" | "household.restore")[] {
  return capabilities.filter(
    (capability): capability is "household.delete" | "household.restore" =>
      capability === "household.delete" || capability === "household.restore",
  );
}

export function memberLifecycleCapabilities(
  capabilities: HouseholdAdministratorActor["capabilities"],
): readonly (
  | "admin.household-members.remove"
  | "admin.household-members.restore"
)[] {
  return capabilities.filter(
    (
      capability,
    ): capability is
      | "admin.household-members.remove"
      | "admin.household-members.restore" =>
      capability === "admin.household-members.remove" ||
      capability === "admin.household-members.restore",
  );
}

export function assetRestorationCapabilities(
  capabilities: HouseholdAdministratorActor["capabilities"],
): readonly (
  | "portfolio.asset.restore.deleted"
  | "portfolio.asset.restore.read"
)[] {
  return capabilities.filter(
    (
      capability,
    ): capability is
      | "portfolio.asset.restore.deleted"
      | "portfolio.asset.restore.read" =>
      capability === "portfolio.asset.restore.deleted" ||
      capability === "portfolio.asset.restore.read",
  );
}

export function seoulLocalDate(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}
