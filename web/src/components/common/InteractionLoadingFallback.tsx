'use client';

import ModalOverlay from './ModalOverlay';

/**
 * 동적 모듈이 아직 내려오지 않았더라도 클릭한 프레임에 즉시 창의 윤곽을 보여 줍니다.
 * 네트워크가 느릴 때 버튼이 무반응처럼 보이는 시간을 없애기 위한 최소 UI입니다.
 */
export function ModalInteractionLoadingFallback() {
  return (
    <ModalOverlay>
      <div
        role="status"
        aria-live="polite"
        className="my-auto w-full max-w-lg rounded-2xl bg-white px-6 py-8 text-center text-sm text-slate-500 shadow-xl"
      >
        화면 준비 중...
      </div>
    </ModalOverlay>
  );
}

/**
 * 원장 상세처럼 페이지 안에 열리는 동적 영역은 같은 자리의 패널을 즉시 확보합니다.
 */
export function PanelInteractionLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 text-center text-sm text-slate-500 shadow-sm"
    >
      화면 준비 중...
    </div>
  );
}
