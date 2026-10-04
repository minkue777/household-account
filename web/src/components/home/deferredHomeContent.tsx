'use client';

import { Component, lazy, Suspense, type ComponentProps, type ComponentType, type LazyExoticComponent } from 'react';

interface DeferredState<Props extends object> {
  Content: LazyExoticComponent<ComponentType<Props>>;
  failed: boolean;
}

/** 각 기능의 첫 사용 때만 로드하며 실패해도 나머지 홈과 입력 상태를 보존합니다. */
export function deferHomeContent<Props extends object>(
  load: () => Promise<{ default: ComponentType<Props> }>,
  label: string,
) {
  return class DeferredHomeContent extends Component<Props, DeferredState<Props>> {
    state: DeferredState<Props> = { Content: lazy(load), failed: false };

    static getDerivedStateFromError() {
      return { failed: true };
    }

    retry = () => {
      // React.lazy는 실패도 기억하므로 사용자 재시도에서 새 경계를 만듭니다.
      this.setState({ Content: lazy(load), failed: false });
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
      const { Content } = this.state;
      const contentProps = this.props as ComponentProps<typeof Content>;
      return (
        <Suspense fallback={
          <div role="status" aria-busy="true" className="my-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            {label} 화면을 불러오는 중입니다.
          </div>
        }>
          <Content key="content" {...contentProps} />
        </Suspense>
      );
    }
  };
}
