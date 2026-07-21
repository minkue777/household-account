import { createMerchantRuleCommandApplication } from "../../src/contexts/payment-capture/configuration/application/merchantRuleCommandApplication";
import type {
  CreateMerchantRuleCommand,
  DeleteMerchantRuleCommand,
  ReorderMerchantRulesCommand,
  UpdateMerchantRuleCommand,
} from "../../src/contexts/payment-capture/configuration/application/ports/in/merchantRuleCommandInputPort";
import type { MerchantRuleCommandStorePort } from "../../src/contexts/payment-capture/configuration/application/ports/out/merchantRuleCommandStorePort";
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
  let nextCommitOutcome: CommitOutcome = "success";

  const store: MerchantRuleCommandStorePort = {
    read: () => cloneMerchantRuleCommandState(state),
    transact(decide) {
      const decision = decide(cloneMerchantRuleCommandState(state));
      if (!decision.writes) {
        return { kind: "Committed", value: decision.value };
      }
      if (nextCommitOutcome === "failure") {
        return { kind: "CommitFailed" };
      }
      state = cloneMerchantRuleCommandState(decision.state);
      return { kind: "Committed", value: decision.value };
    },
  };

  const firstCollectionKey = Object.keys(fixture?.collectionVersions ?? {})[0];
  const householdId =
    fixture?.rules?.[0]?.householdId ??
    firstCollectionKey?.split(":")[0] ??
    "household-a";
  const application = createMerchantRuleCommandApplication({ householdId, store });

  const setCommitOutcome = (outcome: CommitOutcome | undefined): void => {
    nextCommitOutcome = outcome ?? "success";
  };

  return {
    create(input: CreateMerchantRuleCommand & { readonly commitOutcome?: CommitOutcome }) {
      setCommitOutcome(input.commitOutcome);
      const { commitOutcome: _commitOutcome, ...command } = input;
      return application.create(command);
    },
    update(input: UpdateMerchantRuleCommand & { readonly commitOutcome?: CommitOutcome }) {
      setCommitOutcome(input.commitOutcome);
      const { commitOutcome: _commitOutcome, ...command } = input;
      return application.update(command);
    },
    delete(input: DeleteMerchantRuleCommand & { readonly commitOutcome?: CommitOutcome }) {
      setCommitOutcome(input.commitOutcome);
      const { commitOutcome: _commitOutcome, ...command } = input;
      return application.delete(command);
    },
    reorder(input: ReorderMerchantRulesCommand & { readonly commitOutcome?: CommitOutcome }) {
      setCommitOutcome(input.commitOutcome);
      const { commitOutcome: _commitOutcome, ...command } = input;
      return application.reorder(command);
    },
    state: () => application.state(),
  };
}
