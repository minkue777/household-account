import { describe, expect, it } from "vitest";

import { GoogleCloudBillingCostReader } from "../../src/adapters/google-cloud/admin/googleCloudBillingCostReader";

describe("Google Cloud Billing BigQuery reader", () => {
  it("bounded transport rejects an oversized response and never follows a credential-bearing redirect", async () => {
    for (const response of [new Response('x'.repeat(1_048_577)), new Response(null, { status: 302, headers: { location: 'https://outside.example/steal' } })]) {
      const requests: string[] = [];
      const reader = new GoogleCloudBillingCostReader('project', 'project.dataset.table', 'US', { getAccessToken: async () => ({ access_token: 'secret' }) }, async (url, init) => {
        expect(init.redirect).toBe('manual'); requests.push(url); return response;
      });
      await expect(reader.read({ projectId: 'project', calculatedAt: '2026-09-06T00:00:00Z' })).rejects.toThrow('BILLING_QUERY_');
      expect(requests).toHaveLength(1);
      expect(requests[0]).toContain('https://bigquery.googleapis.com/');
    }
  });
  it("credits를 포함한 parameterized Standard export query 결과를 읽는다", async () => {
    const requests: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const reader = new GoogleCloudBillingCostReader(
      "household-account-6f300",
      "household-account-6f300.cloud_billing_export.gcp_billing_export_v1_ABC_DEF_GHI",
      "US",
      { getAccessToken: async () => ({ access_token: "token-a" }) },
      async (url, init) => {
        requests.push({
          url,
          ...(init.body === undefined
            ? {}
            : { body: JSON.parse(init.body) as Record<string, unknown> }),
        });
        return Response.json({
            jobComplete: true,
            rows: [{
              f: [{
                v: JSON.stringify({
                  currency: "KRW",
                  dataUpdatedAt: "2026-08-02T05:40:00Z",
                  dailyAmounts: [
                    { date: "2026-08-01", amount: "100.5" },
                    { date: "2026-08-02", amount: 768.5 },
                  ],
                  serviceAmounts: [
                    {
                      serviceId: "services/firestore",
                      serviceName: "Firestore",
                      amount: 869,
                    },
                  ],
                }),
              }],
            }],
          });
      },
    );

    await expect(reader.read({
      projectId: "household-account-6f300",
      calculatedAt: "2026-08-02T06:00:00.000Z",
    })).resolves.toEqual({
      currency: "KRW",
      dataUpdatedAt: "2026-08-02T05:40:00.000Z",
      dailyAmounts: [
        { date: "2026-08-01", amount: 100.5 },
        { date: "2026-08-02", amount: 768.5 },
      ],
      serviceAmounts: [
        {
          serviceId: "services/firestore",
          serviceName: "Firestore",
          amount: 869,
        },
      ],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain("bigquery.googleapis.com");
    const query = requests[0].body?.query;
    expect(query).toEqual(expect.stringContaining("UNNEST(credits)"));
    expect(query).toEqual(expect.stringContaining("project.id = @projectId"));
    expect(query).toEqual(expect.stringContaining("export_time >="));
    expect(requests[0].body?.useLegacySql).toBe(false);
    expect(requests[0].body?.maximumBytesBilled).toBe("268435456");
  });

  it("느린 query job은 같은 location에서 한 번 기다린 뒤 결과를 읽는다", async () => {
    let invocation = 0;
    const reader = new GoogleCloudBillingCostReader(
      "household-account-6f300",
      "household-account-6f300.cloud_billing_export.gcp_billing_export_v1_ABC_DEF_GHI",
      "US",
      { getAccessToken: async () => ({ access_token: "token-a" }) },
      async (url) => {
        invocation += 1;
        if (invocation === 1) {
          return Response.json({
              jobComplete: false,
              jobReference: { jobId: "job-a" },
            });
        }
        expect(url).toContain("/queries/job-a?location=US");
        return Response.json({
            jobComplete: true,
            rows: [{ f: [{ v: JSON.stringify({
              currency: "KRW",
              dataUpdatedAt: "2026-08-02T05:40:00Z",
              dailyAmounts: [],
              serviceAmounts: [],
            }) }] }],
          });
      },
    );

    await expect(reader.read({
      projectId: "household-account-6f300",
      calculatedAt: "2026-08-02T06:00:00.000Z",
    })).resolves.toMatchObject({ currency: "KRW" });
    expect(invocation).toBe(2);
  });

  it("환경 table 식별자를 SQL로 삽입하기 전에 거부한다", () => {
    expect(() => new GoogleCloudBillingCostReader(
      "household-account-6f300",
      "dataset.table`; DROP TABLE x",
      "US",
      { getAccessToken: async () => ({ access_token: "token-a" }) },
    )).toThrow("BILLING_EXPORT_TABLE_INVALID");
  });

  it("export table이 아직 생성되지 않았으면 준비 중 상태로 구분한다", async () => {
    const reader = new GoogleCloudBillingCostReader(
      "household-account-6f300",
      "household-account-6f300.cloud_billing_export.gcp_billing_export_v1_ABC_DEF_GHI",
      "US",
      { getAccessToken: async () => ({ access_token: "token-a" }) },
      async () => Response.json({}, { status: 404 }),
    );

    await expect(reader.read({
      projectId: "household-account-6f300",
      calculatedAt: "2026-08-02T06:00:00.000Z",
    })).rejects.toThrow("BILLING_COST_SOURCE_NOT_READY");
  });
});
