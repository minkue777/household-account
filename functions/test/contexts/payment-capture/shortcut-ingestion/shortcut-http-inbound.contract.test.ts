import { describe, expect, it } from "vitest";
import { createShortcutHttpInboundDriver } from "../../../support/shortcut-http-inbound-driver";

export interface ShortcutIngressLimitsFixture {
  maxBodyBytes: number;
  maxMessageChars: number;
  maxIdempotencyKeyChars: number;
}

export interface ShortcutInboundCredentialFixture {
  rawCredential: string;
  credentialId: string;
  subjectUid: string;
  householdId: string;
  memberId: string;
  capabilities: readonly string[];
  keyVersion: string;
  status: "active" | "revoked";
}

export interface ShortcutInboundMembershipFixture {
  principalUid: string;
  householdId: string;
  memberId: string;
  membershipState: "active" | "removed";
  householdState: "active" | "deleted" | "purging";
}

export interface ShortcutOwnedCardFixture {
  householdId: string;
  ownerMemberId: string;
  cardCompany: string;
  lastFour: string;
  lifecycleState: "active" | "retired";
}

export interface ShortcutHttpInboundFixture {
  limits: ShortcutIngressLimitsFixture;
  credentials: readonly ShortcutInboundCredentialFixture[];
  memberships: readonly ShortcutInboundMembershipFixture[];
  cards: readonly ShortcutOwnedCardFixture[];
  invitationCodes?: readonly string[];
  ingressGate?:
    | "allowed"
    | "ip-rate-limited"
    | "credential-rate-limited"
    | "quota-exceeded";
  intakeOutcome?: "success" | "duplicate" | "retryable-failure";
}

export interface ShortcutHttpRequest {
  method: "POST" | "OPTIONS" | "GET" | "PUT" | "DELETE";
  headers: {
    authorization?: string;
    contentType?: string;
    idempotencyKey?: string;
    origin?: string;
  };
  rawBodyBytes: number;
  body: unknown;
  receivedAt: string;
  remoteAddress: string;
}

export interface ShortcutPaymentResponseV1 {
  contractVersion: "shortcut-payment-response.v1";
  commandId: string;
  transaction:
    | { kind: "created"; transactionId: string }
    | { kind: "duplicate"; existingTransactionId: string }
    | { kind: "rejected"; code: string }
    | { kind: "needsConfirmation"; candidateIds: readonly string[] };
  notification: {
    state:
      | "queued"
      | "delivered"
      | "no-target"
      | "failed"
      | "unknown-provider-outcome"
      | "permanent-failure"
      | "not-requested";
    targetMemberId?: string;
    deliveryId?: string;
  };
}

export type ShortcutHttpErrorCode =
  | "INVALID_CONTRACT"
  | "REQUIRED_FIELD"
  | "UNSUPPORTED_CONTRACT_VERSION"
  | "METHOD_NOT_ALLOWED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "FIELD_TOO_LONG"
  | "ORIGIN_NOT_ALLOWED"
  | "AUTH_REQUIRED"
  | "CREDENTIAL_REVOKED"
  | "CREDENTIAL_REPLACED"
  | "CREDENTIAL_KEY_VERSION_INVALID"
  | "HOUSEHOLD_FORBIDDEN"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "UNSUPPORTED_MESSAGE"
  | "CARD_NOT_REGISTERED_FOR_ACTOR"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "PAYMENT_INTAKE_TEMPORARILY_UNAVAILABLE";

export interface ShortcutHttpErrorBody {
  contractVersion: "shortcut-payment-response.v1";
  error: {
    code: ShortcutHttpErrorCode;
    retryable: boolean;
  };
}

export type ShortcutHttpResponse =
  | { status: 200; body: ShortcutPaymentResponseV1 }
  | { status: 204; body: null }
  | {
      status: 400 | 401 | 403 | 405 | 409 | 413 | 415 | 422 | 429 | 503;
      body: ShortcutHttpErrorBody;
    };

export interface ShortcutInboundPublicSnapshot {
  transactions: readonly {
    transactionId: string;
    householdId: string;
    creatorMemberId: string;
    source: "ios-shortcut";
    amountInWon: number;
    merchant: string;
  }[];
  events: readonly {
    eventName: "TransactionRecorded.v1" | "CaptureDuplicateObserved.v1";
    eventId: string;
    producer: "household-finance.ledger" | "payment-capture.intake";
    householdId: string;
    creatorMemberId: string;
  }[];
}

export interface ShortcutHttpInboundContractSubject {
  handle(request: ShortcutHttpRequest): Promise<ShortcutHttpResponse>;

  handleConcurrently(
    requests: readonly ShortcutHttpRequest[],
  ): Promise<readonly ShortcutHttpResponse[]>;

  snapshot(): ShortcutInboundPublicSnapshot;
}

export function createSubject(
  _fixture: ShortcutHttpInboundFixture,
): ShortcutHttpInboundContractSubject {
  return createShortcutHttpInboundDriver(_fixture);
}

const activeCredential: ShortcutInboundCredentialFixture = {
  rawCredential: "shortcut-credential-member-a",
  credentialId: "credential-a",
  subjectUid: "uid-a",
  householdId: "household-a",
  memberId: "member-a",
  capabilities: ["paymentCapture:submit"],
  keyVersion: "signing-key-v1",
  status: "active",
};

const activeMembership: ShortcutInboundMembershipFixture = {
  principalUid: "uid-a",
  householdId: "household-a",
  memberId: "member-a",
  membershipState: "active",
  householdState: "active",
};

const memberACard: ShortcutOwnedCardFixture = {
  householdId: "household-a",
  ownerMemberId: "member-a",
  cardCompany: "국민",
  lastFour: "1234",
  lifecycleState: "active",
};

const validMessage = "국민1234승인\n10,000원\n07/19 08:50 스타벅스";

function fixture(
  overrides: Partial<ShortcutHttpInboundFixture> = {},
): ShortcutHttpInboundFixture {
  return {
    limits: {
      maxBodyBytes: 512,
      maxMessageChars: 200,
      maxIdempotencyKeyChars: 80,
    },
    credentials: [activeCredential],
    memberships: [activeMembership],
    cards: [memberACard],
    ingressGate: "allowed",
    intakeOutcome: "success",
    ...overrides,
  };
}

function validRequest(
  overrides: Partial<ShortcutHttpRequest> = {},
): ShortcutHttpRequest {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${activeCredential.rawCredential}`,
      contentType: "application/json",
      idempotencyKey: "shortcut-payment-20260719-001",
    },
    rawBodyBytes: 120,
    body: {
      contractVersion: "shortcut-payment.v1",
      message: validMessage,
    },
    receivedAt: "2026-07-19T09:00:00+09:00",
    remoteAddress: "198.51.100.20",
    ...overrides,
  };
}

function expectNoCanonicalChange(subject: ShortcutHttpInboundContractSubject) {
  expect(subject.snapshot()).toEqual({ transactions: [], events: [] });
}

describe("iPhone Shortcut HTTP 인바운드 공개 계약", () => {
  it("[T-IOS-SEC-002] body의 householdId·createdBy·owner는 Actor와 저장 가구를 바꾸지 않는다", async () => {
    const subject = createSubject(fixture());

    const response = await subject.handle(
      validRequest({
        body: {
          contractVersion: "shortcut-payment.v1",
          message: validMessage,
          householdId: "household-b",
          createdBy: "member-b",
          memberName: "다른 사용자",
          deviceOwner: "member-b",
          owner: "member-b",
        },
      }),
    );

    expect(response).toMatchObject({
      status: 200,
      body: {
        contractVersion: "shortcut-payment-response.v1",
        transaction: { kind: "created" },
        notification: {
          state: "queued",
          targetMemberId: "member-a",
        },
      },
    });
    expect(subject.snapshot().transactions).toEqual([
      expect.objectContaining({
        householdId: "household-a",
        creatorMemberId: "member-a",
        source: "ios-shortcut",
      }),
    ]);
    expect(subject.snapshot().events).toEqual([
      expect.objectContaining({
        eventName: "TransactionRecorded.v1",
        producer: "household-finance.ledger",
        householdId: "household-a",
        creatorMemberId: "member-a",
      }),
    ]);
  });

  it("[T-IOS-SEC-002] 위조한 가구에만 일치 카드가 있어도 credential 가구의 본인 카드로 사용하지 않는다", async () => {
    const subject = createSubject(
      fixture({
        cards: [
          {
            householdId: "household-b",
            ownerMemberId: "member-b",
            cardCompany: "국민",
            lastFour: "1234",
            lifecycleState: "active",
          },
        ],
      }),
    );

    const response = await subject.handle(
      validRequest({
        body: {
          contractVersion: "shortcut-payment.v1",
          message: validMessage,
          householdId: "household-b",
          createdBy: "member-b",
        },
      }),
    );

    expect(response).toEqual({
      status: 422,
      body: {
        contractVersion: "shortcut-payment-response.v1",
        error: {
          code: "CARD_NOT_REGISTERED_FOR_ACTOR",
          retryable: false,
        },
      },
    });
    expectNoCanonicalChange(subject);
  });

  it.each([
    {
      name: "Authorization 없음",
      request: validRequest({
        headers: {
          contentType: "application/json",
          idempotencyKey: "missing-auth",
        },
      }),
      fixtureValue: fixture(),
      expected: { status: 401, code: "AUTH_REQUIRED" },
    },
    {
      name: "Access의 5분 초대 코드",
      request: validRequest({
        headers: {
          authorization: "Bearer household-invitation-code",
          contentType: "application/json",
          idempotencyKey: "invitation-is-not-auth",
        },
      }),
      fixtureValue: fixture({
        invitationCodes: ["household-invitation-code"],
      }),
      expected: { status: 401, code: "AUTH_REQUIRED" },
    },
    {
      name: "폐기된 Shortcut credential",
      request: validRequest(),
      fixtureValue: fixture({
        credentials: [{ ...activeCredential, status: "revoked" }],
      }),
      expected: { status: 401, code: "CREDENTIAL_REVOKED" },
    },
    {
      name: "필수 capability가 없는 credential",
      request: validRequest(),
      fixtureValue: fixture({
        credentials: [{ ...activeCredential, capabilities: [] }],
      }),
      expected: { status: 403, code: "HOUSEHOLD_FORBIDDEN" },
    },
    {
      name: "제거된 Membership",
      request: validRequest(),
      fixtureValue: fixture({
        memberships: [
          { ...activeMembership, membershipState: "removed" },
        ],
      }),
      expected: { status: 403, code: "HOUSEHOLD_FORBIDDEN" },
    },
  ])(
    "[T-IOS-SEC-002] $name은 typed 인증·인가 오류이며 Canonical 변경이 없다",
    async ({ request, fixtureValue, expected }) => {
      const subject = createSubject(fixtureValue);

      const response = await subject.handle(request);

      expect(response).toMatchObject({
        status: expected.status,
        body: {
          contractVersion: "shortcut-payment-response.v1",
          error: { code: expected.code, retryable: false },
        },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it("[T-IOS-SEC-002] 인증 오류 응답에 credential·message·위조 owner를 반사하지 않는다", async () => {
    const leakedCredential = "household-invitation-code";
    const leakedMessage = "민감한 결제 메시지";
    const subject = createSubject(
      fixture({ invitationCodes: [leakedCredential] }),
    );

    const response = await subject.handle(
      validRequest({
        headers: {
          authorization: `Bearer ${leakedCredential}`,
          contentType: "application/json",
          idempotencyKey: "secret-non-reflection",
        },
        body: {
          contractVersion: "shortcut-payment.v1",
          message: leakedMessage,
          createdBy: "forged-owner",
        },
      }),
    );
    const serialized = JSON.stringify(response);

    expect(response.status).toBe(401);
    expect(serialized).not.toContain(leakedCredential);
    expect(serialized).not.toContain(leakedMessage);
    expect(serialized).not.toContain("forged-owner");
  });

  it.each([
    {
      name: "POST 외 method",
      request: validRequest({ method: "GET" }),
      expected: { status: 405, code: "METHOD_NOT_ALLOWED" },
    },
    {
      name: "JSON이 아닌 Content-Type",
      request: validRequest({
        headers: {
          authorization: `Bearer ${activeCredential.rawCredential}`,
          contentType: "text/plain",
          idempotencyKey: "wrong-content-type",
        },
      }),
      expected: { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" },
    },
    {
      name: "지원하지 않는 contract version",
      request: validRequest({
        body: {
          contractVersion: "shortcut-payment.v2",
          message: validMessage,
        },
      }),
      expected: { status: 400, code: "UNSUPPORTED_CONTRACT_VERSION" },
    },
    {
      name: "객체가 아닌 body",
      request: validRequest({ body: ["shortcut-payment.v1", validMessage] }),
      expected: { status: 400, code: "INVALID_CONTRACT" },
    },
    {
      name: "message 필드 누락",
      request: validRequest({
        body: { contractVersion: "shortcut-payment.v1" },
      }),
      expected: { status: 400, code: "REQUIRED_FIELD" },
    },
  ])(
    "[T-IOS-003] $name은 typed transport/schema 오류이며 Canonical 변경이 없다",
    async ({ request, expected }) => {
      const subject = createSubject(fixture());

      const response = await subject.handle(request);

      expect(response).toMatchObject({
        status: expected.status,
        body: { error: { code: expected.code, retryable: false } },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it("[T-IOS-003] body byte 상한은 포함하고 한 byte 초과부터 413으로 거부한다", async () => {
    const atBoundary = createSubject(fixture());
    const overBoundary = createSubject(fixture());

    const accepted = await atBoundary.handle(
      validRequest({ rawBodyBytes: 512 }),
    );
    const rejected = await overBoundary.handle(
      validRequest({ rawBodyBytes: 513 }),
    );

    expect(accepted.status).toBe(200);
    expect(rejected).toEqual({
      status: 413,
      body: {
        contractVersion: "shortcut-payment-response.v1",
        error: { code: "PAYLOAD_TOO_LARGE", retryable: false },
      },
    });
    expectNoCanonicalChange(overBoundary);
  });

  it.each([
    {
      name: "message",
      request: validRequest({
        body: {
          contractVersion: "shortcut-payment.v1",
          message: "x".repeat(201),
        },
        rawBodyBytes: 260,
      }),
    },
    {
      name: "Idempotency-Key",
      request: validRequest({
        headers: {
          authorization: `Bearer ${activeCredential.rawCredential}`,
          contentType: "application/json",
          idempotencyKey: "k".repeat(81),
        },
      }),
    },
  ])(
    "[T-IOS-003] $name 길이 상한 초과는 field validation 오류로 거부한다",
    async ({ request }) => {
      const subject = createSubject(fixture());

      const response = await subject.handle(request);

      expect(response).toEqual({
        status: 400,
        body: {
          contractVersion: "shortcut-payment-response.v1",
          error: { code: "FIELD_TOO_LONG", retryable: false },
        },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it("[T-IOS-003] OPTIONS는 preflight만 반환하고 거래를 만들지 않는다", async () => {
    const subject = createSubject(fixture());

    const response = await subject.handle(
      validRequest({
        method: "OPTIONS",
        headers: { origin: "https://household.example" },
        rawBodyBytes: 0,
        body: null,
      }),
    );

    expect(response).toEqual({ status: 204, body: null });
    expectNoCanonicalChange(subject);
  });

  it("[T-IOS-002] schema는 맞지만 지원하지 않는 message는 422 parse 오류로 구분한다", async () => {
    const subject = createSubject(fixture());

    const response = await subject.handle(
      validRequest({
        body: {
          contractVersion: "shortcut-payment.v1",
          message: "카드 승인 형식이 아닌 입력",
        },
      }),
    );

    expect(response).toEqual({
      status: 422,
      body: {
        contractVersion: "shortcut-payment-response.v1",
        error: { code: "UNSUPPORTED_MESSAGE", retryable: false },
      },
    });
    expectNoCanonicalChange(subject);
  });

  it("[T-IOS-SEC-002] 허용 origin이어도 credential 인증을 생략하지 않는다", async () => {
    const subject = createSubject(fixture());

    const response = await subject.handle(
      validRequest({
        headers: {
          origin: "https://household.example",
          contentType: "application/json",
          idempotencyKey: "cors-is-not-auth",
        },
      }),
    );

    expect(response).toMatchObject({
      status: 401,
      body: { error: { code: "AUTH_REQUIRED" } },
    });
    expectNoCanonicalChange(subject);
  });

  it.each([
    {
      gate: "ip-rate-limited" as const,
      code: "RATE_LIMITED" as const,
    },
    {
      gate: "credential-rate-limited" as const,
      code: "RATE_LIMITED" as const,
    },
    {
      gate: "quota-exceeded" as const,
      code: "QUOTA_EXCEEDED" as const,
    },
  ])(
    "[T-IOS-003] $gate는 429 $code이며 거래를 만들지 않는다",
    async ({ gate, code }) => {
      const subject = createSubject(fixture({ ingressGate: gate }));

      const response = await subject.handle(validRequest());

      expect(response).toEqual({
        status: 429,
        body: {
          contractVersion: "shortcut-payment-response.v1",
          error: { code, retryable: true },
        },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it("[T-IOS-001] 같은 key와 같은 payload의 순차 재전송은 최초 typed 결과를 재생한다", async () => {
    const subject = createSubject(fixture());
    const request = validRequest();

    const first = await subject.handle(request);
    const replay = await subject.handle(request);

    expect(first).toMatchObject({
      status: 200,
      body: { transaction: { kind: "created" } },
    });
    expect(replay).toEqual(first);
    expect(subject.snapshot().transactions).toHaveLength(1);
    expect(subject.snapshot().events).toHaveLength(1);
  });

  it("[T-IOS-001] 같은 key·message에서 위조 alias만 달라져도 같은 논리 요청으로 재생한다", async () => {
    const subject = createSubject(fixture());

    const first = await subject.handle(
      validRequest({
        body: {
          contractVersion: "shortcut-payment.v1",
          message: validMessage,
          householdId: "household-b",
          createdBy: "member-b",
        },
      }),
    );
    const replay = await subject.handle(
      validRequest({
        body: {
          contractVersion: "shortcut-payment.v1",
          message: validMessage,
          householdId: "household-c",
          createdBy: "member-c",
        },
      }),
    );

    expect(replay).toEqual(first);
    expect(subject.snapshot().transactions).toHaveLength(1);
    expect(subject.snapshot().transactions[0]).toMatchObject({
      householdId: "household-a",
      creatorMemberId: "member-a",
    });
  });

  it("[T-IOS-001] 같은 key에 다른 payment payload를 보내면 409이며 최초 거래만 유지한다", async () => {
    const subject = createSubject(fixture());
    await subject.handle(validRequest());

    const conflict = await subject.handle(
      validRequest({
        body: {
          contractVersion: "shortcut-payment.v1",
          message: "국민 1234\n20,000원\n07/19 08:51 다른가맹점",
        },
      }),
    );

    expect(conflict).toEqual({
      status: 409,
      body: {
        contractVersion: "shortcut-payment-response.v1",
        error: {
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
          retryable: false,
        },
      },
    });
    expect(subject.snapshot().transactions).toHaveLength(1);
    expect(subject.snapshot().transactions[0]).toMatchObject({
      amountInWon: 10_000,
      merchant: "스타벅스",
    });
  });

  it("[T-IOS-001] key가 없으면 credential과 정규 message의 안정 key로 같은 요청을 재생한다", async () => {
    const subject = createSubject(fixture());
    const request = validRequest({
      headers: {
        authorization: `Bearer ${activeCredential.rawCredential}`,
        contentType: "application/json",
      },
    });

    const first = await subject.handle(request);
    const replay = await subject.handle(request);

    expect(replay).toEqual(first);
    expect(subject.snapshot().transactions).toHaveLength(1);
  });

  it("[T-IOS-001] 같은 key·payload의 동시 요청도 거래·Event 하나와 같은 결과만 만든다", async () => {
    const subject = createSubject(fixture());
    const request = validRequest();

    const [first, second] = await subject.handleConcurrently([
      request,
      request,
    ]);

    expect(second).toEqual(first);
    expect(subject.snapshot().transactions).toHaveLength(1);
    expect(subject.snapshot().events).toHaveLength(1);
  });

  it("[IOS-012] Payment Intake 일시 실패는 retryable 503이고 일부 거래를 남기지 않는다", async () => {
    const subject = createSubject(
      fixture({ intakeOutcome: "retryable-failure" }),
    );

    const response = await subject.handle(validRequest());

    expect(response).toEqual({
      status: 503,
      body: {
        contractVersion: "shortcut-payment-response.v1",
        error: {
          code: "PAYMENT_INTAKE_TEMPORARILY_UNAVAILABLE",
          retryable: true,
        },
      },
    });
    expectNoCanonicalChange(subject);
  });

  it("[T-IOS-NOTIFY-002][IOS-009] Duplicate 응답은 새 거래 없이 Payment Intake producer의 관찰 Event만 남긴다", async () => {
    const subject = createSubject(fixture({ intakeOutcome: "duplicate" }));

    const first = await subject.handle(validRequest());
    const replay = await subject.handle(validRequest());

    expect(first).toMatchObject({
      status: 200,
      body: {
        transaction: {
          kind: "duplicate",
          existingTransactionId: "transaction-existing",
        },
        notification: { state: "queued", targetMemberId: "member-a" },
      },
    });
    expect(replay).toEqual(first);
    expect(subject.snapshot()).toEqual({
      transactions: [],
      events: [
        {
          eventName: "CaptureDuplicateObserved.v1",
          eventId: expect.any(String),
          producer: "payment-capture.intake",
          householdId: "household-a",
          creatorMemberId: "member-a",
        },
      ],
    });
  });

  it.each([
    {
      name: "0인 body byte 상한",
      limits: {
        maxBodyBytes: 0,
        maxMessageChars: 200,
        maxIdempotencyKeyChars: 80,
      },
    },
    {
      name: "무한대 message 상한",
      limits: {
        maxBodyBytes: 512,
        maxMessageChars: Number.POSITIVE_INFINITY,
        maxIdempotencyKeyChars: 80,
      },
    },
    {
      name: "정수가 아닌 idempotency key 상한",
      limits: {
        maxBodyBytes: 512,
        maxMessageChars: 200,
        maxIdempotencyKeyChars: 1.5,
      },
    },
  ])(
    "[T-IOS-003][T-IOS-SEC-002][IOS-012] $name 설정은 route 시작 단계에서 fail-closed한다",
    ({ limits }) => {
      expect(() => createSubject(fixture({ limits }))).toThrow(
        "Invalid Shortcut ingress limit",
      );
    },
  );

  it("[T-IOS-003][T-IOS-SEC-002][IOS-012] 필수 ingress limit이 누락되어도 route 시작 단계에서 fail-closed한다", () => {
    const missingKeyLimit = {
      maxBodyBytes: 512,
      maxMessageChars: 200,
    } as ShortcutIngressLimitsFixture;

    expect(() =>
      createSubject(fixture({ limits: missingKeyLimit })),
    ).toThrow("Invalid Shortcut ingress limit: maxIdempotencyKeyChars");
  });

  it.each([
    {
      name: "정규화 전에 긴 message",
      request: validRequest({
        rawBodyBytes: 400,
        body: {
          contractVersion: "shortcut-payment.v1",
          message: `${" ".repeat(201)}${validMessage}`,
        },
      }),
    },
    {
      name: "trim 전에 긴 Idempotency-Key",
      request: validRequest({
        headers: {
          authorization: `Bearer ${activeCredential.rawCredential}`,
          contentType: "application/json",
          idempotencyKey: `${" ".repeat(81)}k`,
        },
      }),
    },
  ])(
    "[T-IOS-003][T-IOS-SEC-002] $name는 정규화로 길이 제한을 우회할 수 없다",
    async ({ request }) => {
      const subject = createSubject(fixture());

      expect(await subject.handle(request)).toEqual({
        status: 400,
        body: {
          contractVersion: "shortcut-payment-response.v1",
          error: { code: "FIELD_TOO_LONG", retryable: false },
        },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it("[T-IOS-003][IOS-012] application/json의 charset parameter는 JSON 요청으로 허용한다", async () => {
    const subject = createSubject(fixture());

    const response = await subject.handle(
      validRequest({
        headers: {
          authorization: `Bearer ${activeCredential.rawCredential}`,
          contentType: "Application/JSON; charset=utf-8",
          idempotencyKey: "json-with-charset",
        },
      }),
    );

    expect(response).toMatchObject({ status: 200 });
    expect(subject.snapshot().transactions).toHaveLength(1);
  });

  it("[T-IOS-004][T-IOS-002] Shortcut rich value의 text 필드를 공용 normalizer로 해석한 뒤 parser에 전달한다", async () => {
    const subject = createSubject(fixture());

    const response = await subject.handle(
      validRequest({
        body: {
          contractVersion: "shortcut-payment.v1",
          message: { text: `  ${validMessage}  ` },
        },
      }),
    );

    expect(response).toMatchObject({
      status: 200,
      body: { transaction: { kind: "created" } },
    });
    expect(subject.snapshot().transactions[0]).toMatchObject({
      amountInWon: 10_000,
      merchant: "스타벅스",
    });
  });

  it.each([null, "   ", []])(
    "[T-IOS-003][T-IOS-004] 정규화 후 비어 있는 message %j는 REQUIRED_FIELD로 거부한다",
    async (message) => {
      const subject = createSubject(fixture());

      expect(
        await subject.handle(
          validRequest({
            body: { contractVersion: "shortcut-payment.v1", message },
          }),
        ),
      ).toEqual({
        status: 400,
        body: {
          contractVersion: "shortcut-payment-response.v1",
          error: { code: "REQUIRED_FIELD", retryable: false },
        },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it("[T-IOS-003][IOS-012] 명시된 legacy Actor alias 외의 임의 body field는 허용하지 않는다", async () => {
    const subject = createSubject(fixture());

    expect(
      await subject.handle(
        validRequest({
          body: {
            contractVersion: "shortcut-payment.v1",
            message: validMessage,
            arbitraryServerField: true,
          },
        }),
      ),
    ).toEqual({
      status: 400,
      body: {
        contractVersion: "shortcut-payment-response.v1",
        error: { code: "INVALID_CONTRACT", retryable: false },
      },
    });
    expectNoCanonicalChange(subject);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "[T-IOS-003][T-IOS-SEC-002] 유효하지 않은 rawBodyBytes %s는 body 처리 전에 거부한다",
    async (rawBodyBytes) => {
      const subject = createSubject(fixture());

      expect(
        await subject.handle(validRequest({ rawBodyBytes })),
      ).toMatchObject({
        status: 400,
        body: { error: { code: "INVALID_CONTRACT" } },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it.each([
    "Basic shortcut-credential-member-a",
    "Bearer shortcut-credential-member-a trailing-value",
  ])(
    "[T-IOS-SEC-002][IOS-012] 형식이 잘못된 Authorization %s는 bearer credential로 해석하지 않는다",
    async (authorization) => {
      const subject = createSubject(fixture());

      expect(
        await subject.handle(
          validRequest({
            headers: {
              authorization,
              contentType: "application/json",
              idempotencyKey: "malformed-authorization",
            },
          }),
        ),
      ).toMatchObject({
        status: 401,
        body: { error: { code: "AUTH_REQUIRED", retryable: false } },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it.each(["credential-rate-limited", "quota-exceeded"] as const)(
    "[T-IOS-SEC-002][IOS-012] %s 검사는 bearer 인증을 대신하지 않으며 미인증 요청은 먼저 401이다",
    async (ingressGate) => {
      const subject = createSubject(fixture({ ingressGate }));

      expect(
        await subject.handle(
          validRequest({
            headers: {
              contentType: "application/json",
              idempotencyKey: "unauthenticated-before-credential-gate",
            },
          }),
        ),
      ).toMatchObject({
        status: 401,
        body: { error: { code: "AUTH_REQUIRED" } },
      });
      expectNoCanonicalChange(subject);
    },
  );

  it("[T-IOS-003][T-IOS-SEC-002] 성공 응답도 credential 원문과 결제 message를 반사하지 않는다", async () => {
    const subject = createSubject(fixture());

    const response = await subject.handle(validRequest());
    const serialized = JSON.stringify(response);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain(activeCredential.rawCredential);
    expect(serialized).not.toContain(validMessage);
  });

  it("[T-IOS-003] Idempotency-Key 최대 길이 경계값 자체는 허용한다", async () => {
    const subject = createSubject(fixture());

    const response = await subject.handle(
      validRequest({
        headers: {
          authorization: `Bearer ${activeCredential.rawCredential}`,
          contentType: "application/json",
          idempotencyKey: "k".repeat(80),
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("[T-IOS-001][T-IOS-SEC-002] 같은 idempotency key도 credential 범위가 다르면 서로의 receipt를 재생하지 않는다", async () => {
    const credentialB: ShortcutInboundCredentialFixture = {
      ...activeCredential,
      rawCredential: "shortcut-credential-member-b",
      credentialId: "credential-b",
      subjectUid: "uid-b",
      householdId: "household-b",
      memberId: "member-b",
    };
    const subject = createSubject(
      fixture({
        credentials: [activeCredential, credentialB],
        memberships: [
          activeMembership,
          {
            principalUid: "uid-b",
            householdId: "household-b",
            memberId: "member-b",
            membershipState: "active",
            householdState: "active",
          },
        ],
        cards: [
          memberACard,
          {
            householdId: "household-b",
            ownerMemberId: "member-b",
            cardCompany: "국민",
            lastFour: "1234",
            lifecycleState: "active",
          },
        ],
      }),
    );
    const requestB = validRequest({
      headers: {
        authorization: `Bearer ${credentialB.rawCredential}`,
        contentType: "application/json",
        idempotencyKey: "shortcut-payment-20260719-001",
      },
    });

    const responseA = await subject.handle(validRequest());
    const responseB = await subject.handle(requestB);

    expect(responseA).toMatchObject({ status: 200 });
    expect(responseB).toMatchObject({ status: 200 });
    expect(
      responseA.status === 200 && responseB.status === 200
        ? responseB.body.commandId
        : "",
    ).not.toBe(responseA.status === 200 ? responseA.body.commandId : "");
    expect(subject.snapshot().transactions).toMatchObject([
      { householdId: "household-a", creatorMemberId: "member-a" },
      { householdId: "household-b", creatorMemberId: "member-b" },
    ]);
  });
});
