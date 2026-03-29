'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Link2,
  MessageSquareText,
  Smartphone,
  WandSparkles,
} from 'lucide-react';
import { useHousehold } from '@/contexts/HouseholdContext';
import { isIOS } from '@/lib/pushNotificationService';

const IOS_SHORTCUT_API_URL =
  'https://asia-northeast3-household-account-6f300.cloudfunctions.net/addExpenseFromMessage';
const IOS_SHORTCUT_API_TOKEN = 'household-account-ios-shortcut-2024';
const IOS_SETUP_SHORTCUT_NAME = '가계부 자동등록 설정';
const IOS_SETUP_SHORTCUT_SHARE_URL =
  'https://www.icloud.com/shortcuts/a2791b93177b4c5e9b36f2b869eb3cb9';

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
  const searchParams = useSearchParams();
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

  const setupStatus = searchParams.get('iosShortcutSetup');

  const setupPayload = useMemo(() => {
    if (!householdKey || !currentMember) return '';

    return JSON.stringify(
      {
        apiUrl: IOS_SHORTCUT_API_URL,
        token: IOS_SHORTCUT_API_TOKEN,
        householdId: householdKey,
        householdName: household?.name || '',
        memberName: currentMember.name,
      },
      null,
      2
    );
  }, [currentMember, household?.name, householdKey]);

  const setupShortcutUrl = useMemo(() => {
    if (!setupPayload || typeof window === 'undefined') return '';

    const callbackBase = `${window.location.origin}/settings`;
    const params = new URLSearchParams({
      name: IOS_SETUP_SHORTCUT_NAME,
      input: 'text',
      text: setupPayload,
      'x-success': `${callbackBase}?iosShortcutSetup=done`,
      'x-cancel': `${callbackBase}?iosShortcutSetup=cancel`,
      'x-error': `${callbackBase}?iosShortcutSetup=error`,
    });

    return `shortcuts://x-callback-url/run-shortcut?${params.toString()}`;
  }, [setupPayload]);

  if (!householdKey || !currentMember) {
    return null;
  }

  const openShortcutsApp = () => {
    window.location.href = 'shortcuts://';
  };

  const openShortcutEditor = () => {
    window.location.href = 'shortcuts://create-shortcut';
  };

  const openShortcutInstall = () => {
    if (!IOS_SETUP_SHORTCUT_SHARE_URL) {
      alert('공유 단축어 링크가 아직 연결되지 않았습니다. 실제 설치 링크를 한 번 등록해야 이 버튼이 동작합니다.');
      return;
    }
    window.location.href = IOS_SETUP_SHORTCUT_SHARE_URL;
  };

  const runSetupShortcut = () => {
    if (!setupShortcutUrl) return;
    window.location.href = setupShortcutUrl;
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
                단축어 설치 링크를 열고, 설치 후에는 설정 단축어를 실행해서 연동 값을 자동으로 채우는 흐름입니다.
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
            <div className="mt-1 text-sm text-slate-500">설정 단축어로 함께 넘길 사용자 이름입니다.</div>
          </div>
        </div>

        {!isIOSDevice && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
            지금 보고 계신 기기에서는 미리보기만 가능합니다. 실제 설정은 iPhone의 Safari 또는 단축어 앱에서 진행해 주세요.
          </div>
        )}

        {setupStatus === 'done' && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
            설정 단축어 실행이 끝났습니다. 이제 iPhone 단축어 앱에서 개인 자동화만 연결해 주시면 됩니다.
          </div>
        )}
        {setupStatus === 'cancel' && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            설정 단축어 실행이 취소되었습니다. 다시 눌러 연동 값을 채워 주세요.
          </div>
        )}
        {setupStatus === 'error' && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">
            설정 단축어 실행 중 오류가 있었습니다. 단축어 이름과 설치 여부를 먼저 확인해 주세요.
          </div>
        )}

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
              <Download className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-800">1. 설정 단축어 설치</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Apple 공식 방식으로는 공유된 iCloud 단축어 링크를 열면 설치 화면이 뜹니다. 이 버튼은 그 설치 링크를 여는 자리입니다.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={openShortcutInstall}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  설정 단축어 설치
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy('shortcut-name', IOS_SETUP_SHORTCUT_NAME)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  {copiedKey === 'shortcut-name' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  {copiedKey === 'shortcut-name' ? '이름 복사됨' : '단축어 이름 복사'}
                </button>
              </div>
              {!IOS_SETUP_SHORTCUT_SHARE_URL && (
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  아직 실제 iCloud 공유 링크가 연결되지 않았습니다. 이 버튼이 완전히 동작하려면 공유 단축어 링크를 한 번 넣어야 합니다.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
              <WandSparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-800">2. 설치 후 설정 단축어 실행</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                아래 버튼은 <span className="font-medium text-slate-800">{IOS_SETUP_SHORTCUT_NAME}</span> 단축어를 열고,
                URL·토큰·가계 키·사용자 이름을 한 번에 입력값으로 넘깁니다.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={runSetupShortcut}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  설정 단축어 실행
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy('shortcut-url', setupShortcutUrl)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  {copiedKey === 'shortcut-url' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  {copiedKey === 'shortcut-url' ? '딥링크 복사됨' : '딥링크 복사'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={openShortcutsApp}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
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
            <h3 className="font-semibold text-slate-800">가장 짧은 설정 순서</h3>
          </div>
          <div className="space-y-3 text-sm leading-6 text-slate-600">
            <div>
              <div className="font-medium text-slate-800">1. 설정 단축어 설치</div>
              <div>앱 안의 설치 버튼으로 공유 단축어 링크를 열고 단축어를 컬렉션에 추가합니다.</div>
            </div>
            <div>
              <div className="font-medium text-slate-800">2. 설정 단축어 실행</div>
              <div>앱 안의 실행 버튼으로 연동 값을 한 번에 채웁니다.</div>
            </div>
            <div>
              <div className="font-medium text-slate-800">3. 메시지 자동화 만들기</div>
              <div>단축어 앱 자동화 탭에서 메시지 트리거를 만들고 카드 문자 발신 번호나 공통 문구를 고릅니다.</div>
            </div>
            <div>
              <div className="font-medium text-slate-800">4. 실행 전에 묻기 끄기</div>
              <div>이 옵션을 꺼야 실제로 자동 등록됩니다.</div>
            </div>
          </div>
        </div>

        <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
            고급 설정 값 직접 보기
          </summary>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            설정 단축어가 없거나 수동으로 확인해야 할 때만 아래 값을 사용해 주세요.
          </p>
          <div className="mt-3 space-y-3">
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
        </details>

        <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
            설정 단축어에 넘기는 JSON 보기
          </summary>
          <div className="mt-3 rounded-2xl bg-slate-900 p-4">
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-6 text-slate-100">
              {setupPayload}
            </pre>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy('payload', setupPayload)}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
          >
            {copiedKey === 'payload' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            {copiedKey === 'payload' ? 'JSON 복사됨' : 'JSON 복사'}
          </button>
        </details>
      </div>
    </section>
  );
}
