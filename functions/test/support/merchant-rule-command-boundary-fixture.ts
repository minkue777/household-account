import {
  createMerchantRuleMutation,
  updateMerchantRuleMutation,
  deleteMerchantRuleMutation,
  reorderMerchantRulesMutation,
  type MerchantRuleMutation,
} from "../../src/contexts/payment-capture/configuration/application/merchantRuleMutation";
import type {
  CreateMerchantRuleCommand,
  MerchantRuleCommandResult,
  DeleteMerchantRuleCommand,
  ReorderMerchantRulesCommand,
  UpdateMerchantRuleCommand,
} from "../../src/contexts/payment-capture/configuration/application/ports/in/merchantRuleCommandInputPort";
import type {
  MerchantRuleCommandState,
  MerchantRuleRecord,
} from "../../src/contexts/payment-capture/configuration/domain/model/merchantRuleSet";
import {
  buildMerchantRuleCommandState,
  cloneMerchantRuleCommandState,
} from "../../src/contexts/payment-capture/configuration/domain/policies/merchantRuleClaims";

type CommitOutcome = "success" | "failure";

export function createMerchantRuleCommandBoundaryFixture(fixture?: {
  readonly rules?: readonly MerchantRuleRecord[];
  readonly collectionVersions?: Readonly<Record<string, number>>;
}) {
  let state: MerchantRuleCommandState = buildMerchantRuleCommandState({
    rules: fixture?.rules ?? [],
    collectionVersions: fixture?.collectionVersions,
  });
  const firstCollectionKey = Object.keys(fixture?.collectionVersions ?? {})[0];
  const householdId =
    fixture?.rules?.[0]?.householdId ??
    firstCollectionKey?.split(":")[0] ??
    "household-a";
  const commit = (
    mutation: MerchantRuleMutation,
    outcome: CommitOutcome = "success",
  ): MerchantRuleCommandResult => {
    if (mutation.writes) {
      if (outcome === "failure") return { kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" };
      state = cloneMerchantRuleCommandState(mutation.state);
    }
    return mutation.value;
  };

  return {
    create(input: CreateMerchantRuleCommand & { readonly commitOutcome?: CommitOutcome }) {
      return commit(createMerchantRuleMutation(state, householdId, input), input.commitOutcome);
    },
    update(input: UpdateMerchantRuleCommand & { readonly commitOutcome?: CommitOutcome }) {
      return commit(updateMerchantRuleMutation(state, householdId, input), input.commitOutcome);
    },
    delete(input: DeleteMerchantRuleCommand & { readonly commitOutcome?: CommitOutcome }) {
      return commit(deleteMerchantRuleMutation(state, householdId, input), input.commitOutcome);
    },
    reorder(input: ReorderMerchantRulesCommand & { readonly commitOutcome?: CommitOutcome }) {
      return commit(reorderMerchantRulesMutation(state, householdId, input), input.commitOutcome);
    },
    state: () => cloneMerchantRuleCommandState(state),
  };
}
