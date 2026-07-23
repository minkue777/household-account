import fs from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import {
  AppDialogProvider,
  useAppDialog,
} from '@/contexts/AppDialogContext';

const SOURCE_ROOT = path.resolve(process.cwd(), 'src');

function productionSources(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return productionSources(fullPath);
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
    return [fullPath];
  });
}

function DialogHarness() {
  const { showAlert, showConfirm, showPrompt } = useAppDialog();
  return (
    <>
      <button onClick={() => void showAlert('저장하지 못했습니다.', '작업 실패')}>
        오류
      </button>
      <button
        onClick={() =>
          void showConfirm({
            title: '삭제 확인',
            message: '삭제할까요?',
            variant: 'danger',
          })
        }
      >
        확인
      </button>
      <button
        onClick={() =>
          void showPrompt({
            title: '이름 변경',
            message: '새 이름을 입력해 주세요.',
            initialValue: '기존 이름',
          })
        }
      >
        입력
      </button>
    </>
  );
}

describe('앱 내부 대화상자 계약', () => {
  test('운영 코드는 브라우저 기본 alert·confirm·prompt를 호출하거나 참조하지 않는다', () => {
    const violations = productionSources(SOURCE_ROOT).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      const calls = [
        ...source.matchAll(/\b(?:alert|confirm|prompt)\s*\(/g),
        ...source.matchAll(
          /\b(?:window|globalThis|self)(?:\.(?:alert|confirm|prompt)\b|\s*\[\s*['"`](?:alert|confirm|prompt)['"`]\s*\])/g
        ),
      ];
      return calls.map((match) => ({
        filePath: path.relative(SOURCE_ROOT, filePath),
        token: match[0],
      }));
    });

    expect(violations).toEqual([]);
  });

  test('모든 App Router 화면은 공통 앱 대화상자 Provider 안에서 실행된다', () => {
    const rootLayout = fs.readFileSync(path.join(SOURCE_ROOT, 'app', 'layout.tsx'), 'utf8');
    const appProviders = fs.readFileSync(
      path.join(SOURCE_ROOT, 'components', 'AppProviders.tsx'),
      'utf8'
    );

    expect(rootLayout).toContain('<AppProviders>');
    expect(appProviders).toContain('<AppDialogProvider>');
  });

  test('오류·확인·텍스트 입력을 URL 없는 앱 Portal 대화상자로 표시한다', async () => {
    const nativeAlert = jest.spyOn(window, 'alert').mockImplementation(() => {});
    const nativeConfirm = jest.spyOn(window, 'confirm').mockImplementation(() => false);
    const nativePrompt = jest.spyOn(window, 'prompt').mockImplementation(() => null);

    render(
      <AppDialogProvider>
        <DialogHarness />
      </AppDialogProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '오류' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('작업 실패');
    expect(screen.getByRole('dialog')).toHaveTextContent('저장하지 못했습니다.');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '확인' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('삭제 확인');
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '입력' }));
    expect(screen.getByDisplayValue('기존 이름')).toBeInTheDocument();

    expect(nativeAlert).not.toHaveBeenCalled();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(nativePrompt).not.toHaveBeenCalled();
    nativeAlert.mockRestore();
    nativeConfirm.mockRestore();
    nativePrompt.mockRestore();
  });
});
