import { readFileSync } from "node:fs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-household-account-storage-rules";
const CATALOG_PATH = "market-catalog/v1/latest.json";
const PRIVATE_PATH = "private/runtime-secret.json";
const describeWithStorageEmulator = process.env.FIREBASE_STORAGE_EMULATOR_HOST
  ? describe
  : describe.skip;

let environment: RulesTestEnvironment;

describeWithStorageEmulator("Cloud Storage 공개 catalog 경계", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      storage: {
        rules: readFileSync(
          new URL("../../../../storage.rules", import.meta.url),
          "utf8",
        ),
      },
    });
  });

  beforeEach(async () => {
    await environment.clearStorage();
    await environment.withSecurityRulesDisabled(async (context) => {
      await Promise.all([
        context.storage().ref(CATALOG_PATH).putString('{"version":"v1"}'),
        context.storage().ref(PRIVATE_PATH).putString('{"secret":true}'),
      ]);
    });
  });

  afterAll(async () => {
    if (environment !== undefined) await environment.cleanup();
  });

  it("market catalog는 로그인 여부와 무관하게 읽을 수 있다", async () => {
    await assertSucceeds(
      environment.unauthenticatedContext().storage().ref(CATALOG_PATH).getDownloadURL(),
    );
    await assertSucceeds(
      environment
        .authenticatedContext("member-1")
        .storage()
        .ref(CATALOG_PATH)
        .getDownloadURL(),
    );
  });

  it("market catalog 쓰기는 인증 여부와 무관하게 거부한다", async () => {
    await assertFails(
      Promise.resolve(
        environment
          .unauthenticatedContext()
          .storage()
          .ref("market-catalog/v1/client-write.json")
          .putString("{}"),
      ),
    );
    await assertFails(
      Promise.resolve(
        environment
          .authenticatedContext("member-1")
          .storage()
          .ref("market-catalog/v1/client-write-authenticated.json")
          .putString("{}"),
      ),
    );
  });

  it("allowlist 밖의 모든 경로는 인증해도 읽고 쓸 수 없다", async () => {
    const storage = environment.authenticatedContext("member-1").storage();
    await assertFails(storage.ref(PRIVATE_PATH).getDownloadURL());
    await assertFails(
      Promise.resolve(storage.ref("other/client-write.json").putString("{}")),
    );
  });
});
