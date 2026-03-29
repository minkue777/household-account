'use client';

import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Link2,
  MessageSquareText,
  Smartphone,
} from 'lucide-react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { isIOS } from '@/lib/pushNotificationService';

const IOS_SHORTCUT_API_URL =
  'https://asia-northeast3-household-account-6f300.cloudfunctions.net/addExpenseFromMessage';
const IOS_SHORTCUT_API_TOKEN = 'household-account-ios-shortcut-2024';

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-xl bg-white px-3 py-2 text-[12px] text-slate-700">
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100"
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
    </div>
  );
}

export default function IosShortcutSetupCard() {
  const { household, householdKey, currentMember } = useHousehold();
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    setIsIOSDevice(isIOS());
  }, []);

  useEffect(() => {
    if (!copiedKey) return;

    const timer = window.setTimeout(() => {
      setCopiedKey(null);
    }, 1600);

    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  if (!householdKey || !currentMember) {
    return null;
  }

  const payloadExample = JSON.stringify(
    {
      message: '{{카드 문자 원문}}',
      token: IOS_SHORTCUT_API_TOKEN,
      householdId: householdKey,
    },
    null,
    2
  );

  const openShortcutsApp = () => {
    window.location.href = 'shortcuts://';
  };

  const openShortcutEditor = () => {
    window.location.href = 'shortcuts://create-shortcut';
  };

  const handleCopy = async (key: string, value: string) => {
    await copyToClipboard(value);
    setCopiedKey(key);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-r from-blue-50 via-cyan-50 to-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">iPhone 문자 자동등록</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                단축어와 개인 자동화를 한 번만 설정하면 카드 문자를 자동으로 가계부에 넣을 수 있습니다.
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-500 ring-1 ring-slate-200">
            {isIOSDevice ? '현재 iPhone' : 'iPhone 전용'}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">현재 가계</div>
            <div className="mt-2 font-semibold text-slate-800">{household?.name || householdKey}</div>
            <div className="mt-1 text-sm text-slate-500">{householdKey}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">현재 사용자</div>
            <div className="mt-2 font-semibold text-slate-800">{currentMember.name}</div>
            <div className="mt-1 text-sm text-slate-500">단축어를 설치하는 iPhone 사용자 이름을 확인해 주세요.</div>
          </div>
        </div>

        {!isIOSDevice && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            지금 보고 계신 기기에서는 미리보기만 가능합니다. 실제 설정은 iPhone의 Safari 또는 단축어 앱에서 진행해 주세요.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={openShortcutsApp}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            <ExternalLink className="h-4 w-4" />
            단축어 앱 열기
          </button>
          <button
            type="button"
            onClick={openShortcutEditor}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Link2 className="h-4 w-4" />
            새 단축어 만들기
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-blue-500" />
            <h3 className="font-semibold text-slate-800">설치 순서</h3>
          </div>
          <div className="space-y-3 text-sm leading-6 text-slate-600">
            <div>
              <div className="font-medium text-slate-800">1. 단축어 준비</div>
              <div>단축어 앱에서 기존 단축어를 열거나 새 단축어를 만든 뒤, 카드 문자 원문을 서버로 보내는 흐름을 넣어 주세요.</div>
            </div>
            <div>
              <div className="font-medium text-slate-800">2. 개인 자동화 만들기</div>
              <div>
                단축어 앱의 <span className="font-medium text-slate-800">자동화</span> 탭에서
                <span className="font-medium text-slate-800"> 메시지</span> 트리거를 만들고, 카드 문자 발신 번호나 공통 문구로 조건을 걸어 주세요.
              </div>
            </div>
            <div>
              <div className="font-medium text-slate-800">3. 기존 단축어 실행으로 연결</div>
              <div>자동화 안에서 액션을 새로 짜지 말고, 이미 만든 카드 등록 단축어를 실행하도록 연결해 주세요.</div>
            </div>
            <div>
              <div className="font-medium text-slate-800">4. 실행 전에 묻기 끄기</div>
              <div>자동화 저장 직전에 실행 전에 묻기를 꺼야 실제로 자동 등록됩니다.</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-blue-500" />
            <h3 className="font-semibold text-slate-800">연동 값 복사</h3>
          </div>
          <div className="space-y-3">
            <CopyRow
              label="요청 URL"
              value={IOS_SHORTCUT_API_URL}
              copied={copiedKey === 'url'}
              onCopy={() => void handleCopy('url', IOS_SHORTCUT_API_URL)}
            />
            <CopyRow
              label="API 토큰"
              value={IOS_SHORTCUT_API_TOKEN}
              copied={copiedKey === 'token'}
              onCopy={() => void handleCopy('token', IOS_SHORTCUT_API_TOKEN)}
            />
            <CopyRow
              label="가계 키"
              value={householdKey}
              copied={copiedKey === 'household'}
              onCopy={() => void handleCopy('household', householdKey)}
            />
          </div>
        </div>

        <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
            단축어 요청 예시 보기
          </summary>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            현재 단축어에 값을 수동으로 넣어야 할 때는 아래 JSON 형태를 기준으로 맞추면 됩니다.
          </p>
          <div className="mt-3 rounded-2xl bg-slate-900 p-4">
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-slate-100">
              {payloadExample}
            </pre>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy('payload', payloadExample)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            {copiedKey === 'payload' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            {copiedKey === 'payload' ? '예시 복사됨' : 'JSON 예시 복사'}
          </button>
        </details>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
          설정이 끝나면 카드 문자 한 건으로 먼저 테스트해 보시고, 가계부에 즉시 들어오는지 확인해 주세요.
        </div>
      </div>
    </section>
  );
}
