'use client';

import { useState } from 'react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { HOME_CARD_LABELS, homePreferenceCommands, useAvailableHomeCurrencies, useHomePreferences } from '@/features/home-preferences/homePreferences';
import type { HomeSummaryCardKey, HomeSummaryConfig } from '@/types/household';
const CURRENCY_LABELS: Record<string, string> = { gyeonggi: '경기지역화폐', daejeon: '대전사랑카드', sejong: '여민전' };

export default function HomePreferencesSettings() {
  const { householdKey, adminHouseholdView } = useHousehold();
  const preference = useHomePreferences();
  const { types: currencies, error: currenciesError } = useAvailableHomeCurrencies(householdKey);
  const [draft, setDraft] = useState<{ configuration: HomeSummaryConfig; version: number }>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const configuration = draft?.configuration ?? preference.configuration;
  const enabled = !!householdKey && preference.version !== undefined && !preference.error && !pending && !adminHouseholdView;
  const change = (side: 'leftCard' | 'rightCard', value: HomeSummaryCardKey) => {
    if (preference.version === undefined) return;
    setDraft(current => ({ configuration: { ...(current?.configuration ?? preference.configuration), [side]: value }, version: current?.version ?? preference.version! }));
    setMessage('');
  };
  const save = async () => {
    if (!enabled || !draft) return;
    if (configuration.leftCard === configuration.rightCard) { setMessage('서로 다른 두 카드를 선택해 주세요.'); return; }
    setPending(true);
    try { await homePreferenceCommands.saveCards(householdKey!, configuration, draft.version); setDraft(undefined); setMessage('홈 카드 구성을 저장했습니다.'); }
    catch { setMessage('저장하지 못했습니다. 다른 가구원이 변경했다면 최신 설정을 다시 불러와 주세요.'); }
    finally { setPending(false); }
  };
  const selectCurrency = async (type: string) => {
    if (!enabled || !type) return;
    setPending(true);
    try { await homePreferenceCommands.selectCurrency(householdKey!, type, preference.version!); setMessage('홈 지역화폐를 저장했습니다.'); }
    catch { setMessage('지역화폐 선택을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setPending(false); }
  };
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <h2 className="font-semibold">홈 카드 구성</h2>
    <p className="text-sm text-slate-500">가구원 모두에게 같은 두 카드를 표시합니다.</p>
    {(['leftCard', 'rightCard'] as const).map(side => <label key={side} className="flex items-center justify-between text-sm">
      {side === 'leftCard' ? '왼쪽 카드' : '오른쪽 카드'}
      <select aria-label={side === 'leftCard' ? '왼쪽 카드' : '오른쪽 카드'} disabled={!enabled} value={configuration[side]} onChange={event => change(side, event.target.value as HomeSummaryCardKey)} className="rounded-lg border p-2">
        {Object.entries(HOME_CARD_LABELS).map(([key, label]) => <option key={key} value={key} disabled={key !== configuration[side] && key === configuration[side === 'leftCard' ? 'rightCard' : 'leftCard']}>{label}</option>)}
      </select>
    </label>)}
    <div className="flex gap-3"><button type="button" disabled={!enabled || !draft} onClick={() => void save()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40">카드 저장</button>
      {draft && <button type="button" disabled={pending} onClick={() => { setDraft(undefined); setMessage(''); }} className="text-sm underline">최신 설정 다시 불러오기</button>}</div>
    <label className="flex items-center justify-between text-sm">홈 지역화폐
      <select aria-label="홈 지역화폐" disabled={!enabled || currenciesError || currencies.length === 0} value={preference.selectedType ?? ''} onChange={event => void selectCurrency(event.target.value)} className="rounded-lg border p-2">
        <option value="">선택해 주세요</option>{currencies.map(type => <option key={type} value={type}>{CURRENCY_LABELS[type] ?? type}</option>)}
      </select>
    </label>
    {(preference.error || currenciesError || message) && <p role="status" className="text-sm text-slate-600">{preference.error || currenciesError ? '홈 설정을 불러오지 못했습니다.' : message}</p>}
  </section>;
}
