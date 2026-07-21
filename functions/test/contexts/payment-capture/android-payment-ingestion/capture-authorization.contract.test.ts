import { describe, expect, it } from "vitest";
import {
  createCaptureAuthorizationDriver,
  type CaptureApprovalActor,
  type CaptureAuthorizationInputPort,
  type CaptureAuthorizationState,
} from "../../../support/capture-authorization-driver";

export interface CaptureAuthorizationContractSubject {
  submitApproval: CaptureAuthorizationInputPort["submitApproval"];
  state(): CaptureAuthorizationState;
}

export function createSubject(): CaptureAuthorizationContractSubject {
  return createCaptureAuthorizationDriver();
}

const actor = (
  overrides: Partial<CaptureApprovalActor> = {},
): CaptureApprovalActor => ({
  principalId: "principal-1",
  householdId: "household-1",
  actingMemberId: "member-1",
  capabilities: ["paymentCapture:submit"],
  ...overrides,
});

const expectNoDownstreamState = (subject: CaptureAuthorizationContractSubject) => {
  expect(subject.state()).toEqual({
    transactions: [],
    captureReceipts: [],
    configurationResolutions: [],
  });
};

describe("Android Capture 승인 인증·가구 범위 공개 계약", () => {
  it("[T-ING-AUTH-001][ING-SAVE-001] 인증 Actor가 없으면 승인 저장과 receipt·설정 조회를 시작하지 않는다", async () => {
    const subject = createSubject();

    expect(
      await subject.submitApproval({ observationId: "observation-1" }),
    ).toEqual({ kind: "Unauthenticated", code: "AUTH_REQUIRED" });
    expectNoDownstreamState(subject);
  });

  it.each([
    {
      name: "householdId가 없는 Actor",
      actor: actor({ householdId: undefined }),
      envelopeHouseholdId: undefined,
      code: "HOUSEHOLD_REQUIRED",
    },
    {
      name: "actingMemberId가 없는 Actor",
      actor: actor({ actingMemberId: undefined }),
      envelopeHouseholdId: "household-1",
      code: "ACTOR_MISMATCH",
    },
    {
      name: "submit capability가 없는 Actor",
      actor: actor({ capabilities: [] }),
      envelopeHouseholdId: "household-1",
      code: "CAPABILITY_REQUIRED",
    },
    {
      name: "envelope와 다른 가구 Actor",
      actor: actor({ householdId: "household-2" }),
      envelopeHouseholdId: "household-1",
      code: "ACTOR_MISMATCH",
    },
  ] as const)(
    "[T-ING-AUTH-001][ING-SAVE-001] $name 입력은 $code이며 Canonical 상태가 없다",
    async ({ actor: actorFixture, envelopeHouseholdId, code }) => {
      const subject = createSubject();

      expect(
        await subject.submitApproval({
          actor: actorFixture,
          envelopeHouseholdId,
          observationId: "observation-1",
        }),
      ).toEqual({ kind: "Forbidden", code });
      expectNoDownstreamState(subject);
    },
  );

  it("[T-ING-AUTH-001][ING-SAVE-001] Actor 가구가 있어도 envelope 가구 범위가 없으면 fail-closed로 거부한다", async () => {
    const subject = createSubject();

    expect(
      await subject.submitApproval({
        actor: actor(),
        observationId: "observation-1",
      }),
    ).toEqual({ kind: "Forbidden", code: "ACTOR_MISMATCH" });
    expectNoDownstreamState(subject);
  });

  it("[T-ING-AUTH-001][ING-SAVE-001/ING-SAVE-006] 유효한 가구 Actor만 자기 memberId를 creator로 저장한다", async () => {
    const subject = createSubject();

    const result = await subject.submitApproval({
      actor: actor(),
      envelopeHouseholdId: "household-1",
      observationId: "observation-1",
    });

    expect(result).toEqual({
      kind: "Created",
      transactionId: expect.any(String),
      householdId: "household-1",
      creatorMemberId: "member-1",
    });
    if (result.kind !== "Created") {
      throw new Error("유효한 Actor의 거래가 생성되어야 합니다.");
    }
    expect(subject.state()).toEqual({
      transactions: [
        {
          transactionId: result.transactionId,
          householdId: "household-1",
          creatorMemberId: "member-1",
        },
      ],
      captureReceipts: ["observation-1"],
      configurationResolutions: ["observation-1"],
    });
  });
});
