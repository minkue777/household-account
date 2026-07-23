'use client';

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import Portal from '@/components/common/Portal';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

interface PromptOptions extends ConfirmOptions {
  initialValue?: string;
  placeholder?: string;
}

interface AppDialogApi {
  showAlert(message: string, title?: string): Promise<void>;
  showConfirm(options: ConfirmOptions): Promise<boolean>;
  showPrompt(options: PromptOptions): Promise<string | null>;
}

type DialogRequest =
  | {
      id: number;
      kind: 'alert';
      title: string;
      message: string;
      confirmLabel: string;
      resolve(value: unknown): void;
    }
  | {
      id: number;
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel: string;
      variant: 'default' | 'danger';
      resolve(value: unknown): void;
    }
  | {
      id: number;
      kind: 'prompt';
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel: string;
      variant: 'default' | 'danger';
      initialValue: string;
      placeholder?: string;
      resolve(value: unknown): void;
    };

type PendingDialogRequest =
  | Omit<Extract<DialogRequest, { kind: 'alert' }>, 'id' | 'resolve'>
  | Omit<Extract<DialogRequest, { kind: 'confirm' }>, 'id' | 'resolve'>
  | Omit<Extract<DialogRequest, { kind: 'prompt' }>, 'id' | 'resolve'>;

const fallbackApi: AppDialogApi = {
  showAlert: async () => undefined,
  showConfirm: async () => false,
  showPrompt: async () => null,
};

const AppDialogContext = createContext<AppDialogApi>(fallbackApi);

export function useAppDialog(): AppDialogApi {
  return useContext(AppDialogContext);
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(1);
  const [requests, setRequests] = useState<DialogRequest[]>([]);
  const current = requests[0];

  const enqueue = useCallback(
    <T,>(request: PendingDialogRequest): Promise<T> =>
      new Promise<T>((resolve) => {
        setRequests((queued) => [
          ...queued,
          {
            ...request,
            id: nextId.current++,
            resolve: (value: unknown) => resolve(value as T),
          } as DialogRequest,
        ]);
      }),
    []
  );

  const api = useMemo<AppDialogApi>(
    () => ({
      showAlert: (message, title = '알림') =>
        enqueue<void>({
          kind: 'alert',
          title,
          message,
          confirmLabel: '확인',
        }),
      showConfirm: (options) =>
        enqueue<boolean>({
          kind: 'confirm',
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? '확인',
          cancelLabel: options.cancelLabel ?? '취소',
          variant: options.variant ?? 'default',
        }),
      showPrompt: (options) =>
        enqueue<string | null>({
          kind: 'prompt',
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? '확인',
          cancelLabel: options.cancelLabel ?? '취소',
          variant: options.variant ?? 'default',
          initialValue: options.initialValue ?? '',
          ...(options.placeholder === undefined
            ? {}
            : { placeholder: options.placeholder }),
        }),
    }),
    [enqueue]
  );

  const finish = useCallback(
    (value: unknown) => {
      if (!current) return;
      setRequests((queued) => queued.slice(1));
      current.resolve(value);
    },
    [current]
  );

  return (
    <AppDialogContext.Provider value={api}>
      {children}
      {current && <AppDialogSurface request={current} onFinish={finish} />}
    </AppDialogContext.Provider>
  );
}

function AppDialogSurface({
  request,
  onFinish,
}: {
  request: DialogRequest;
  onFinish(value: unknown): void;
}) {
  const [inputValue, setInputValue] = useState(
    request.kind === 'prompt' ? request.initialValue : ''
  );

  useEffect(() => {
    setInputValue(request.kind === 'prompt' ? request.initialValue : '');
  }, [request]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (request.kind === 'alert') onFinish(undefined);
      else if (request.kind === 'confirm') onFinish(false);
      else onFinish(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onFinish, request.kind]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (request.kind === 'alert') onFinish(undefined);
    else if (request.kind === 'confirm') onFinish(true);
    else onFinish(inputValue);
  };

  const cancel = () => {
    if (request.kind === 'confirm') onFinish(false);
    else if (request.kind === 'prompt') onFinish(null);
  };

  const confirmClass =
    request.kind !== 'alert' && request.variant === 'danger'
      ? 'bg-red-500 hover:bg-red-600'
      : 'bg-blue-500 hover:bg-blue-600';

  return (
    <Portal>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/25 p-4 backdrop-blur-sm">
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby={`app-dialog-title-${request.id}`}
          onSubmit={submit}
          className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        >
          <h2
            id={`app-dialog-title-${request.id}`}
            className="text-lg font-semibold text-slate-800"
          >
            {request.title}
          </h2>
          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">
            {request.message}
          </p>

          {request.kind === 'prompt' && (
            <input
              autoFocus
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder={request.placeholder}
              className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          )}

          <div className="mt-6 flex gap-3">
            {request.kind !== 'alert' && (
              <button
                type="button"
                onClick={cancel}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-50"
              >
                {request.cancelLabel}
              </button>
            )}
            <button
              autoFocus={request.kind !== 'prompt'}
              type="submit"
              className={`flex-1 rounded-lg px-4 py-2 text-white ${confirmClass}`}
            >
              {request.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
