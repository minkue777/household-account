import { act, fireEvent, render, screen } from '@testing-library/react';
import { deferHomeContent } from '@/components/home/deferredHomeContent';

test('[T-WEBVIEW-004][AND-012] 미사용 기능을 로드하지 않으며 기다리는 동안 홈과 최신 props를 유지한다', async () => {
  let finish!: (value: { default: (props: { value: string }) => JSX.Element }) => void;
  const load = jest.fn(() => new Promise<{ default: (props: { value: string }) => JSX.Element }>(resolve => { finish = resolve; }));
  const Deferred = deferHomeContent(load, '검색');
  function Home({ open, value }: { open: boolean; value: string }) {
    return <><input aria-label="보존할 입력" defaultValue="초안" />{open && <Deferred value={value} />}</>;
  }
  const view = render(<Home open={false} value="이전 범위" />);
  expect(load).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('보존할 입력'), { target: { value: '편집한 초안' } });
  view.rerender(<Home open value="이전 범위" />);
  expect(screen.getByRole('status')).toHaveTextContent('검색 화면을 불러오는 중입니다.');
  view.rerender(<Home open value="현재 범위" />);
  await act(async () => finish({ default: ({ value }) => <p>{value}</p> }));
  expect(screen.getByText('현재 범위')).toBeVisible();
  expect(screen.queryByText('이전 범위')).not.toBeInTheDocument();
  expect(screen.getByLabelText('보존할 입력')).toHaveValue('편집한 초안');
  expect(load).toHaveBeenCalledTimes(1);
});

test('[T-WEBVIEW-004][AND-012] 코드 로드 실패는 홈을 유지하고 사용자 재시도로 실제 loader를 다시 호출한다', async () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const load = jest.fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ default: () => <p>다시 열린 검색</p> });
    const Deferred = deferHomeContent(load, '검색');
    render(<><input aria-label="보존할 입력" defaultValue="초안" /><Deferred /></>);
    expect(await screen.findByRole('alert')).toHaveTextContent('검색 화면을 불러오지 못했습니다.');
    expect(screen.getByLabelText('보존할 입력')).toHaveValue('초안');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('다시 열린 검색')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    consoleError.mockRestore();
  }
});
