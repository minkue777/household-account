import { render, screen } from '@testing-library/react';
import { AdminAndroidAppVersions } from '@/components/admin/AdminAndroidAppVersions';

test.each([undefined, []])('[T-ADM-004] an older response or absent Android registration is unknown', versions => {
  render(<AdminAndroidAppVersions versions={versions} />);
  expect(screen.getByText('확인 안 됨')).toBeInTheDocument();
});

test('[T-ADM-004] shows only the most recently confirmed version, even when its version number is lower', () => {
  render(<AdminAndroidAppVersions versions={[
    { version: '1.2.17', lastConfirmedAt: '2026-11-09T01:10:00.000Z' },
    { version: '2.0.12', lastConfirmedAt: '2026-11-08T15:20:00.000Z' },
    {},
  ]} />);
  expect(screen.getByText('v1.2.17')).toBeInTheDocument();
  expect(screen.queryByText('v2.0.12')).not.toBeInTheDocument();
  expect(screen.getByText('26. 11. 09. 10:10 확인')).toHaveAttribute('datetime', '2026-11-09T01:10:00.000Z');
  expect(screen.queryByText('26. 11. 09. 00:20 확인')).not.toBeInTheDocument();
  expect(screen.queryByText('버전 확인 안 됨')).not.toBeInTheDocument();
});

test('[T-ADM-004] missing version in the newest registration does not fall back to an older installation', () => {
  render(<AdminAndroidAppVersions versions={[
    { lastConfirmedAt: '2026-11-09T01:10:00.000Z' },
    { version: '2.0.12', lastConfirmedAt: '2026-11-08T15:20:00.000Z' },
  ]} />);
  expect(screen.getByText('버전 확인 안 됨')).toBeInTheDocument();
  expect(screen.getByText('26. 11. 09. 10:10 확인')).toBeInTheDocument();
  expect(screen.queryByText('v2.0.12')).not.toBeInTheDocument();
});

test('[T-ADM-004] preserves unknown confirmation metadata', () => {
  render(<AdminAndroidAppVersions versions={[{}]} />);
  expect(screen.getByText('버전 확인 안 됨')).toBeInTheDocument();
  expect(screen.getByText('확인 시각 없음')).toBeInTheDocument();
});
