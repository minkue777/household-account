import { render, screen } from '@testing-library/react';
import { AdminAndroidAppVersions } from '@/components/admin/AdminAndroidAppVersions';

test.each([undefined, []])('[T-ADM-004] an older response or absent Android registration is unknown', versions => {
  render(<AdminAndroidAppVersions versions={versions} />);
  expect(screen.getByText('확인 안 됨')).toBeInTheDocument();
});

test('[T-ADM-004] shows every reported version with its Seoul confirmation time and preserves missing metadata', () => {
  render(<AdminAndroidAppVersions versions={[
    { version: '1.2.17', lastConfirmedAt: '2026-11-09T01:10:00.000Z' },
    { version: '2.0.12', lastConfirmedAt: '2026-11-08T15:20:00.000Z' },
    {},
  ]} />);
  expect(screen.getByText('v1.2.17')).toBeInTheDocument();
  expect(screen.getByText('v2.0.12')).toBeInTheDocument();
  expect(screen.getByText('26. 11. 09. 10:10 확인')).toHaveAttribute('datetime', '2026-11-09T01:10:00.000Z');
  expect(screen.getByText('26. 11. 09. 00:20 확인')).toHaveAttribute('datetime', '2026-11-08T15:20:00.000Z');
  expect(screen.getByText('버전 확인 안 됨')).toBeInTheDocument();
  expect(screen.getByText('확인 시각 없음')).toBeInTheDocument();
});
