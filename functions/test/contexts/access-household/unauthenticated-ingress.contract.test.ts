import { describe, expect, it } from "vitest";
import type {
  ProtectedIngress,
  ProtectedIngressInputPort,
} from "../../../src/platform/ingress-security/public";
import {
  createUnauthenticatedIngressFixtureSubject,
  type ProtectedIngressSnapshot,
} from "../../support/unauthenticated-ingress-fixture";

/**
 * 무인증 서버 쓰기 경계를 한 fixture로 검증하는 Cross-cutting Subject입니다.
 * 각 기능의 내부 저장소 대신 공개 결과·전체 상태 지문·Event만 관찰합니다.
 */
export interface UnauthenticatedIngressSubject
  extends ProtectedIngressInputPort {
  snapshot(): Promise<ProtectedIngressSnapshot>;
  publishedEvents(): Promise<readonly { eventType: string; resourceId: string }[]>;
}

export function createSubject(): UnauthenticatedIngressSubject {
  return createUnauthenticatedIngressFixtureSubject();
}

const payloadByIngress: Readonly<
  Record<ProtectedIngress, Readonly<Record<string, unknown>>>
> = {
  RegisterEndpoint: {
    householdId: "house-1",
    memberId: "member-1",
    fid: "attacker-controlled-fid",
    platform: "ios-pwa",
  },
  RenameSelf: {
    householdId: "house-1",
    displayName: "공격자 이름",
    expectedVersion: 3,
  },
  SubmitShortcutCapture: {
    householdId: "house-1",
    amountInWon: 100_000,
    merchant: "공격 입력",
  },
  SaveDividendSnapshot: {
    householdId: "house-1",
    assetId: "asset-1",
    amountInWon: 9_999_999,
  },
};

describe("무인증 서버 쓰기 Cross-cutting 공개 계약", () => {
  it.each<ProtectedIngress>([
    "RegisterEndpoint",
    "RenameSelf",
    "SubmitShortcutCapture",
    "SaveDividendSnapshot",
  ])(
    "[T-SEC-002][ADM-002/IOS-010/PUSH-009] 무인증 %s 호출은 AUTH_REQUIRED이며 모든 Context 상태와 Event가 불변이다",
    async (entryPoint) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      const result = await subject.invoke({
        entryPoint,
        payload: payloadByIngress[entryPoint],
      });

      expect(result).toEqual({
        kind: "unauthenticated",
        code: "AUTH_REQUIRED",
      });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it("[T-HH-SEC-001][T-SEC-002][ADM-002/HH-009] 무인증 rename은 타 가구 memberId를 주입해도 이름·참조·Event를 전혀 바꾸지 않는다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    const result = await subject.invoke({
      entryPoint: "RenameSelf",
      payload: {
        householdId: "house-other",
        memberId: "member-other",
        displayName: "탈취 이름",
        expectedVersion: 1,
      },
    });

    expect(result).toEqual({
      kind: "unauthenticated",
      code: "AUTH_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it("[T-SEC-002][ADM-002/IOS-010/PUSH-009] 공개 ingress allowlist는 필요한 세 경로뿐이며 배당 snapshot 직접 저장은 인증 후에도 닫혀 있다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    expect(subject.supportedPublicIngresses()).toEqual([
      "RegisterEndpoint",
      "RenameSelf",
      "SubmitShortcutCapture",
    ]);
    await expect(
      subject.invoke({
        entryPoint: "SaveDividendSnapshot",
        authorization: "Bearer member-credential",
        appAttestation: "valid-app-attestation",
        payload: payloadByIngress.SaveDividendSnapshot,
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "INGRESS_NOT_ALLOWED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it.each<ProtectedIngress>([
    "RegisterEndpoint",
    "RenameSelf",
    "SubmitShortcutCapture",
  ])(
    "[T-SEC-002][ADM-002/IOS-010/PUSH-009] 인증돼도 route capability가 없는 %s 요청은 downstream을 호출하지 않는다",
    async (entryPoint) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      await expect(
        subject.invoke({
          entryPoint,
          authorization: "Bearer no-capability",
          appAttestation: "valid-app-attestation",
          payload: payloadByIngress[entryPoint],
        }),
      ).resolves.toEqual({
        kind: "forbidden",
        code: "CAPABILITY_REQUIRED",
      });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it("[T-SEC-002][ADM-002/IOS-010/PUSH-009] capability가 있어도 active Membership이 아니면 공개 ingress를 호출하지 않는다", async () => {
    const subject = createSubject();
    const before = await subject.snapshot();

    await expect(
      subject.invoke({
        entryPoint: "RenameSelf",
        authorization: "Bearer removed-member",
        appAttestation: "valid-app-attestation",
        payload: payloadByIngress.RenameSelf,
      }),
    ).resolves.toEqual({
      kind: "forbidden",
      code: "ACTIVE_MEMBERSHIP_REQUIRED",
    });
    expect(await subject.snapshot()).toEqual(before);
    expect(await subject.publishedEvents()).toEqual([]);
  });

  it.each([
    [undefined, "APP_ATTESTATION_REQUIRED"],
    ["invalid-app-attestation", "APP_ATTESTATION_INVALID"],
  ] as const)(
    "[T-SEC-002][ADM-002/PUSH-009] RegisterEndpoint의 App Attestation %s 상태는 %s로 차단한다",
    async (appAttestation, code) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      await expect(
        subject.invoke({
          entryPoint: "RegisterEndpoint",
          authorization: "Bearer member-credential",
          appAttestation,
          payload: payloadByIngress.RegisterEndpoint,
        }),
      ).resolves.toEqual({ kind: "forbidden", code });
      expect(await subject.snapshot()).toEqual(before);
      expect(await subject.publishedEvents()).toEqual([]);
    },
  );

  it.each([
    {
      entryPoint: "RegisterEndpoint" as const,
      authorization: "Bearer member-credential",
      appAttestation: "valid-app-attestation",
      changedDigest: "notificationEndpointDigest" as const,
    },
    {
      entryPoint: "RenameSelf" as const,
      authorization: "Bearer member-credential",
      appAttestation: "valid-app-attestation",
      changedDigest: "accessDigest" as const,
    },
    {
      entryPoint: "SubmitShortcutCapture" as const,
      authorization: "Bearer shortcut-credential",
      appAttestation: undefined,
      changedDigest: "shortcutReceiptDigest" as const,
    },
  ])(
    "[T-SEC-002][ADM-002/IOS-010/PUSH-009] 허용된 $entryPoint는 인증·Membership·capability 선검증 뒤 공개 dispatcher로 전달한다",
    async ({ entryPoint, authorization, appAttestation, changedDigest }) => {
      const subject = createSubject();
      const before = await subject.snapshot();

      const result = await subject.invoke({
        entryPoint,
        authorization,
        appAttestation,
        payload: payloadByIngress[entryPoint],
      });

      expect(result).toEqual({
        kind: "success",
        resourceId: `${entryPoint}:1`,
      });
      const after = await subject.snapshot();
      expect(after[changedDigest]).not.toBe(before[changedDigest]);
      expect(await subject.publishedEvents()).toEqual([
        {
          eventType: `${entryPoint}Accepted.v1`,
          resourceId: `${entryPoint}:1`,
        },
      ]);
    },
  );
});
