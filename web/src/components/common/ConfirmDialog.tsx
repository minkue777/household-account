'use client';

import Portal from './Portal';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  pending?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 확인 다이얼로그 컴포넌트
 * variant='danger': 삭제 등 위험한 작업용 (빨간색 버튼)
 * variant='default': 일반 확인용 (파란색 버튼)
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = '확인',
  cancelLabel = '취소',
  variant = 'default',
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const confirmButtonClass = variant === 'danger'
    ? 'bg-red-500 text-white hover:bg-red-600'
    : 'bg-blue-500 text-white hover:bg-blue-600';

  return (
    <Portal>
      <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm flex items-center justify-center z-[9999]">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="bg-white rounded-2xl p-6 m-4 max-w-sm w-full shadow-xl"
        >
          <h3 className="text-lg font-semibold text-slate-800 mb-3">
            {title}
          </h3>
          <p className="text-slate-600 mb-6">
            {message}
          </p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={pending}
              className="flex-1 py-2 px-4 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={pending}
              className={`flex-1 py-2 px-4 rounded-lg transition-colors ${confirmButtonClass}`}
            >
              {confirmLabel}
            </button>
          </div>
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        </div>
      </div>
    </Portal>
  );
}
