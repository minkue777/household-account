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

test('[T-WEBVIEW-004][AND-012] 준비된 날짜별 내역은 key 변경과 재진입에도 로딩 표시 없이 최신 props와 새 화면 상태로 열린다', async () => {
  const load = jest.fn(async () => ({ default: ({ date }: { date: string }) => <input aria-label="선택 날짜" defaultValue={date} /> }));
  const Deferred = deferHomeContent(load, '날짜별 내역');
  const view = render(<Deferred key="first" date="10월 1일" />);
  expect(await screen.findByLabelText('선택 날짜')).toHaveValue('10월 1일');
  fireEvent.change(screen.getByLabelText('선택 날짜'), { target: { value: '이전 화면 상태' } });
  view.rerender(<Deferred key="second" date="10월 2일" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('선택 날짜')).toHaveValue('10월 2일');
  view.rerender(<></>);
  view.rerender(<Deferred key="third" date="10월 3일" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByLabelText('선택 날짜')).toHaveValue('10월 3일');
  expect(load).toHaveBeenCalledTimes(1);
});

test('[T-WEBVIEW-004][AND-012] 사전 준비가 끝나면 첫 표시도 동기적으로 준비된 코드를 사용한다', async () => {
  const load = jest.fn(async () => ({ default: ({ date }: { date: string }) => <p>{date}</p> }));
  const Deferred = deferHomeContent(load, '날짜별 내역');
  await Deferred.preload();
  render(<Deferred date="미리 준비한 날짜" />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('미리 준비한 날짜')).toBeVisible();
  expect(load).toHaveBeenCalledTimes(1);
});

test('[T-WEBVIEW-004][AND-012] 사전 준비 중 첫 사용과 여러 화면이 하나의 진행 중 loader를 공유한다', async () => {
  let finish!: (value: { default: (props: { value: string }) => JSX.Element }) => void;
  const load = jest.fn(() => new Promise<{ default: (props: { value: string }) => JSX.Element }>(resolve => { finish = resolve; }));
  const Deferred = deferHomeContent(load, '날짜별 내역');
  const preparing = Deferred.preload();
  render(<><Deferred value="첫 화면" /><Deferred value="다른 화면" /></>);
  await act(async () => {
    finish({ default: ({ value }) => <p>{value}</p> });
    await preparing;
  });
  expect(screen.getByText('첫 화면')).toBeVisible();
  expect(screen.getByText('다른 화면')).toBeVisible();
  expect(load).toHaveBeenCalledTimes(1);
});

test('[T-WEBVIEW-004][AND-012] 백그라운드 준비 실패는 실제 첫 사용에서 다시 요청할 수 있다', async () => {
  const load = jest.fn().mockRejectedValueOnce(new Error('preload unavailable'))
    .mockResolvedValueOnce({ default: () => <p>첫 사용 복구</p> });
  const Deferred = deferHomeContent(load, '날짜별 내역');
  await expect(Deferred.preload()).rejects.toThrow('preload unavailable');
  render(<Deferred />);
  expect(await screen.findByText('첫 사용 복구')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(load).toHaveBeenCalledTimes(2);
});
