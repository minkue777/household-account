import type {
  HouseholdCommandActor,
  HouseholdCommandResult,
} from "./householdCommand";

export type ResolveHouseholdActorResult =
  | { readonly kind: "active"; readonly actor: HouseholdCommandActor }
  | { readonly kind: "forbidden" }
  | { readonly kind: "household-not-active" };

export interface HouseholdCommandMembershipPort {
  resolveActor(input: {
    readonly principalUid: string;
    readonly householdId: string;
  }): Promise<ResolveHouseholdActorResult>;
}

export type HouseholdCommandReceiptClaim =
  | { readonly kind: "claimed" }
  | {
      readonly kind: "completed";
      readonly result: HouseholdCommandResult;
    }
  | { readonly kind: "in-progress" }
  | { readonly kind: "payload-mismatch" };

export interface HouseholdCommandReceiptPort {
  claim(input: {
    readonly receiptId: string;
    readonly principalUid: string;
    readonly command: string;
    readonly payloadHash: string;
    readonly requestedAt: string;
  }): Promise<HouseholdCommandReceiptClaim>;

  complete(input: {
    readonly receiptId: string;
    readonly payloadHash: string;
    readonly result: HouseholdCommandResult;
    readonly completedAt: string;
  }): Promise<void>;

  abandon(input: {
    readonly receiptId: string;
    readonly payloadHash: string;
  }): Promise<void>;
}

export interface HouseholdCommandHashPort {
  hash(value: string): string;
}
