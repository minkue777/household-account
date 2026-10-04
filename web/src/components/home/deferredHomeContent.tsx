'use client';

import { Component, lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';

interface DeferredState<Props extends object> {
  Content: ComponentType<Props> | LazyExoticComponent<ComponentType<Props>>;
  failed: boolean;
}

/** 각 기능의 첫 사용 때만 로드하며 실패해도 나머지 홈과 입력 상태를 보존합니다. */
export function deferHomeContent<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
) {
  type ContentModule = { default: ComponentType<Props> };
  let resolved: ComponentType<Props> | undefined;
  let pending: Promise<ContentModule> | undefined;
  const loadShared = (): Promise<ContentModule> => {
    if (pending) return pending;
    let request: Promise<ContentModule>;
    try { request = load(); } catch (error) { request = Promise.reject(error); }
    pending = request.then(module => {
      resolved = module.default;
      return module;
    }, error => {
      pending = undefined;
      // A rejected React.lazy is permanent; future mounts/retries need a fresh one.
      SharedContent = lazy(loadShared);
      throw error;
    });
    return pending;
  };
  let SharedContent = lazy(loadShared);

  return class DeferredHomeContent extends Component<Props, DeferredState<Props>> {
    // A preloaded module bypasses the extra Promise turn on its first mount.
    state: DeferredState<Props> = { Content: resolved ?? SharedContent, failed: false };

    static preload(): Promise<void> {
      return loadShared().then(() => undefined);
    }

    static getDerivedStateFromError() {
      return { failed: true };
    }

    retry = () => {
      this.setState({ Content: resolved ?? SharedContent, failed: false });
    };

    render() {
      if (this.state.failed) {
        return (
          <div role="alert" className="my-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <p>{label} 화면을 불러오지 못했습니다.</p>
            <button type="button" onClick={this.retry} className="mt-2 rounded-lg border border-slate-300 px-3 py-2">
              다시 시도
            </button>
          </div>
        );
      }
      // Both eager and lazy variants use the loader's same Props contract.
      const Content = this.state.Content as ComponentType<Props>;
      return (
        <Suspense fallback={
          <div role="status" aria-busy="true" className="my-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            {label} 화면을 불러오는 중입니다.
          </div>
        }>
          <Content key="content" {...this.props} />
        </Suspense>
      );
    }
  };
}
