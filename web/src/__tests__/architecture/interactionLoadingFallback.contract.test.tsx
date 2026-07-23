import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  ModalInteractionLoadingFallback,
  PanelInteractionLoadingFallback,
} from '@/components/common/InteractionLoadingFallback';

const srcRoot = path.join(process.cwd(), 'src');

function expectImmediateFallback(
  relativePath: string,
  loaderNames: readonly string[]
) {
  const source = fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');

  for (const loaderName of loaderNames) {
    expect(source).toMatch(
      new RegExp(
        `dynamic\\(\\s*${loaderName}\\s*,\\s*\\{\\s*loading:\\s*(?:Modal|Panel)InteractionLoadingFallback\\s*,?\\s*\\}\\s*\\)`
      )
    );
  }
}

describe('첫 상호작용 로딩 표시 계약', () => {
  it('원장과 자산의 동적 상호작용은 chunk를 기다리는 동안 즉시 fallback을 그린다', () => {
    expectImmediateFallback('components/home/LedgerPage.tsx', [
      'loadExpenseDetail',
      'loadAddExpenseModal',
      'loadIncomeSummaryModal',
      'loadSearchModal',
      'loadCategoryDetailModal',
      'loadLocalCurrencyModal',
    ]);
    expectImmediateFallback('app/assets/page.tsx', [
      'loadAssetAddModal',
      'loadAssetEditModal',
      'loadAssetHistoryModal',
      'loadAssetBalanceChart',
      'loadAssetOwnerProfileModal',
    ]);
  });

  it('fallback 자체도 별도 effect를 기다리지 않고 즉시 보인다', () => {
    const { rerender } = render(<ModalInteractionLoadingFallback />);
    expect(screen.getByRole('status')).toHaveTextContent('화면 준비 중...');

    rerender(<PanelInteractionLoadingFallback />);
    expect(screen.getByRole('status')).toHaveTextContent('화면 준비 중...');
  });

  it('자산 화면은 다음 animation frame을 기다리기 전에 상호작용 모듈 요청을 시작한다', () => {
    const source = fs.readFileSync(path.join(srcRoot, 'app/assets/page.tsx'), 'utf8');
    const preloadIndex = source.indexOf('void preloadAssetInteractions()');
    const nextFrameIndex = source.indexOf('window.requestAnimationFrame');

    expect(preloadIndex).toBeGreaterThan(-1);
    expect(nextFrameIndex).toBeGreaterThan(-1);
    expect(preloadIndex).toBeLessThan(nextFrameIndex);
  });

  it('모바일의 일반 클릭 대상은 double-tap 판정으로 지연되지 않는다', () => {
    const globalStyles = fs.readFileSync(path.join(srcRoot, 'app/globals.css'), 'utf8');

    expect(globalStyles).toMatch(
      /button,\s*a,\s*\[role='button'\]\s*\{\s*touch-action:\s*manipulation;/
    );
  });
});
