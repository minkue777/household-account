import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { InMemoryFirestore } from "./in-memory-firestore";

describe("Firestore regression helper SDK subset", () => {
  it("applies inclusive range, array membership, ordered cursor and limit within collection scope", async () => {
    const memory = new InMemoryFirestore();
    for (const [id, amount, tags] of [["a", 1, ["x"]], ["b", 2, ["x"]], ["c", 3, ["y"]], ["d", 4, ["x"]]] as const) memory.seed(`records/${id}`, { amount, tags });
    memory.seed("records/a/records/nested", { amount: 2, tags: ["x"] });
    const query = memory.collection("records").where("amount", ">=", 1).where("amount", "<=", 3).where("tags", "array-contains", "x").orderBy("__name__").startAfter("a").limit(1);
    expect((await query.get()).docs.map((doc) => doc.id)).toEqual(["b"]);
    const transactional = await memory.runTransaction((transaction) => transaction.get(query));
    if (!("docs" in transactional)) throw new Error("EXPECTED_QUERY_SNAPSHOT");
    expect(transactional.docs.map((doc) => doc.id)).toEqual(["b"]);
  });

  it("collectionGroup includes same named nested collections and snapshot refs retain real parent paths", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("households/a/positions/p", { active: true });
    memory.seed("households/b/positions/q", { active: true });
    memory.seed("households/a/other/r", { active: true });
    const result = await memory.collectionGroup("positions").where("active", "==", true).get();
    expect(result.docs.map((doc) => doc.ref.path)).toEqual(["households/a/positions/p", "households/b/positions/q"]);
    expect(result.docs[0].ref.parent.parent?.path).toBe("households/a");
  });

  it("normalizes SDK transforms and atomically discards staged writes when a transaction aborts", async () => {
    const memory = new InMemoryFirestore();
    memory.seed("records/a", { keep: "kept", remove: "secret" });
    const reference = memory.collection("records").doc("a");
    await reference.set({ remove: FieldValue.delete(), ttl: Timestamp.fromDate(new Date("2026-10-01T00:00:00Z")), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    expect(memory.document("records/a")).toEqual({ keep: "kept", ttl: new Date("2026-10-01T00:00:00Z"), updatedAt: expect.any(Date) });
    const before = memory.document("records/a");
    await expect(memory.runTransaction(async (transaction) => { transaction.set(reference, { keep: "changed" }); transaction.create(memory.collection("records").doc("b"), { value: 1 }); throw new Error("aborted"); })).rejects.toThrow("aborted");
    expect(memory.document("records/a")).toEqual(before);
    expect(memory.has("records/b")).toBe(false);
  });
});
