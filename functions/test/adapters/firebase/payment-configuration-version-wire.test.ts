import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { createPaymentConfigurationHouseholdCommandHandlers } from "../../../src/bootstrap/commands/paymentConfigurationHouseholdCommandHandlers";
import type { HouseholdCommandExecutionContext } from "../../../src/bootstrap/commands/householdCommand";
import { InMemoryFirestore } from "../../support/in-memory-firestore";

function setup() {
  const memory = new InMemoryFirestore();
  memory.seed("households/house/members/member", { householdId: "house", displayName: "이름", lifecycleState: "active" });
  const run = (command: string, payload: Record<string, unknown>, commandId = `${command}:${JSON.stringify(payload)}`) => {
    const context: HouseholdCommandExecutionContext = {
      principalUid: "uid", requestedAt: "2026-09-06T00:00:00.000Z",
      actor: { principalUid: "uid", householdId: "house", actingMemberId: "member", capabilities: ["household.read", "household.write"] },
      envelope: { contractVersion: "household-command.v1", command: `payment-configuration.${command}.v1`, commandId, idempotencyKey: commandId, householdId: "house", payload },
    };
    return createPaymentConfigurationHouseholdCommandHandlers(memory as unknown as Firestore).get(context.envelope.command)!.execute(context) as Promise<Record<string, unknown>>;
  };
  const data = () => memory.paths().filter((path) => !path.startsWith("commandReceipts/")).map((path) => [path, memory.document(path)]);
  return { memory, run, data };
}

describe("[CARD-003][CARD-004][MER-004] runtime command versions", () => {
  it("card update and retirement reject the caller's stale version rather than substituting the latest version", async () => {
    const { memory, run, data } = setup();
    const created = await run("register-card", { card: { cardLabel: "삼성", cardLastFour: "1234" } });
    await run("update-card", { cardId: created.cardId, expectedVersion: 1, changes: { cardLastFour: "5678" } });
    const before = data();
    for (const [command, payload] of [
      ["update-card", { cardId: created.cardId, expectedVersion: 1, changes: { cardLastFour: "9999" } }],
      ["delete-card", { cardId: created.cardId, expectedVersion: 1 }],
      ["update-card", { cardId: created.cardId, changes: { cardLastFour: "9999" } }],
    ] as const) await expect(run(command, payload)).rejects.toThrow();
    expect(data()).toEqual(before);
    expect(memory.document(`households/house/registeredCards/${created.cardId}`)).toMatchObject({ lastFour: "5678", aggregateVersion: 2 });
  });

  it("merchant reorder includes inactive rules, commits unique priority/claims once, and rejects stale, incomplete and foreign sets without mutation", async () => {
    const { memory, run, data } = setup();
    const first = await run("create-merchant-rule", { rule: { merchantKeyword: "A", matchType: "contains", mapping: { memo: "memo" }, isActive: false } });
    const second = await run("create-merchant-rule", { rule: { merchantKeyword: "B", matchType: "contains", mapping: { memo: "memo" } } });
    const initialVersion = (memory.document("households/house/paymentConfigurationMeta/merchant-rules")?.collectionVersions as Record<string, number>)?.["house:contains"] ?? 0;
    const payload = { matchType: "contains", orderedRuleIds: [first.ruleId, second.ruleId], expectedCollectionVersion: initialVersion };
    const result = await run("reorder-merchant-rules", payload, "reorder");
    expect(await run("reorder-merchant-rules", payload, "reorder")).toEqual(result);
    expect(memory.document(`households/house/merchantRules/${first.ruleId}`)).toMatchObject({ priority: 20, active: false, aggregateVersion: 2 });
    expect(memory.document(`households/house/merchantRules/${second.ruleId}`)).toMatchObject({ priority: 10, aggregateVersion: 2 });
    const before = data();
    for (const invalid of [payload, { ...payload, expectedCollectionVersion: initialVersion + 1, orderedRuleIds: [first.ruleId] }, { ...payload, expectedCollectionVersion: initialVersion + 1, orderedRuleIds: [first.ruleId, "foreign"] }, { ...payload, expectedCollectionVersion: initialVersion + 1, orderedRuleIds: [first.ruleId, first.ruleId] }]) await expect(run("reorder-merchant-rules", invalid)).rejects.toThrow();
    await expect(run("update-merchant-rule", { ruleId: first.ruleId, expectedVersion: 1, changes: { merchantKeyword: "stale" } })).rejects.toThrow();
    expect(data()).toEqual(before);
  });
});
