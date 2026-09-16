import type { AdminOperationsDashboardWireView } from '@/platform/functions-api';

type Billing = Extract<NonNullable<AdminOperationsDashboardWireView['billingCost']>, { status: 'available' }>;

function itemLabel(name: string): string {
  if (name.includes('Firestore Read Ops')) return 'Firestore 문서 조회';
  if (name.includes('Firestore Entity Writes')) return 'Firestore 문서 쓰기';
  if (name.includes('Firestore TTL Deletes')) return 'Firestore TTL 자동 삭제';
  if (name.includes('Firestore Entity Deletes')) return 'Firestore 문서 삭제';
  if (name.includes('Firestore Storage')) return 'Firestore 저장 공간';
  if (name.includes('Firestore Internet Data Transfer')) return 'Firestore 외부 전송';
  return name;
}

export function AdminBillingDetails({ billing }: { billing: Billing }) {
  if (billing.skuAmounts === undefined) {
    return <p className="px-4 pb-4 text-xs text-slate-500">항목별 상세 내역은 다음 비용 집계부터 표시됩니다.</p>;
  }
  const services = new Map(billing.serviceAmounts.map(service => [service.serviceId, service.serviceName]));
  for (const sku of billing.skuAmounts) if (!services.has(sku.serviceId)) services.set(sku.serviceId, sku.serviceId);
  const money = (amount: number) => `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(amount)}${billing.currency === 'KRW' ? '원' : ` ${billing.currency}`}`;
  const unitLabels: Record<string, string> = { count: '회', gibibyte: 'GiB', 'gibibyte month': 'GiB·월', seconds: '초' };
  return <div className="space-y-3 px-4 pb-4">
    <p className="text-xs text-slate-500">청구 데이터 반영 시각: {new Date(billing.dataUpdatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국 시간). 내보내기 지연으로 실제 사용 시각과 차이가 있습니다.</p>
    {Array.from(services).map(([serviceId, name]) => {
      const items = billing.skuAmounts!.filter(sku => sku.serviceId === serviceId);
      if (items.length === 0) return null;
      return <details key={serviceId} open={name === 'App Engine'} className="rounded-xl border border-slate-800 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-200">{name} 상세 비용</summary>
        {name === 'App Engine' && <p className="mt-2 text-xs text-slate-400">App Engine 청구 항목에는 Firestore 사용료도 포함됩니다. 아래는 실제 과금 항목(SKU)별 내역입니다.</p>}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-xs" aria-label={`${name} 과금 항목`}>
            <thead className="text-slate-500"><tr>{['과금 항목', '리전', '사용량', '사용 비용', '크레딧', '합계'].map(label => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
            <tbody>{items.map(sku => <tr key={`${sku.skuId}:${sku.location}:${sku.usageUnit}`} className="border-t border-slate-800 text-slate-300">
              <td className="px-2 py-3"><div>{itemLabel(sku.skuName)}</div><div className="mt-1 text-[10px] text-slate-500">{sku.skuName} · {sku.skuId}</div></td>
              <td className="px-2 py-3">{sku.location}</td>
              <td className="whitespace-nowrap px-2 py-3">{new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 }).format(sku.usageAmount)} {unitLabels[sku.usageUnit] ?? sku.usageUnit}</td>
              <td className="whitespace-nowrap px-2 py-3">{money(sku.cost)}</td>
              <td className="whitespace-nowrap px-2 py-3">{money(sku.credits)}</td>
              <td className="whitespace-nowrap px-2 py-3 font-medium">{money(sku.amount)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>;
    })}
    <p className="text-xs text-slate-500">크레딧을 반영한 잠정 금액이며 0원인 사용 항목도 포함합니다. 상세 금액과 서비스 합계는 반올림으로 소폭 다를 수 있습니다. 개별 화면·함수별 비용은 이 청구 데이터에서 구분되지 않습니다.</p>
  </div>;
}
