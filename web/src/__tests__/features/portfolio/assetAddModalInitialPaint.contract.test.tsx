import { Profiler } from 'react';
import { render, screen } from '@testing-library/react';
import AssetAddModal from '@/components/assets/AssetAddModal';
import { ASSET_TYPE_CONFIG, type AssetOwnerOption } from '@/types/asset';

jest.mock('@/lib/assetService', () => ({
  addAsset: jest.fn(), addStockHolding: jest.fn(), addCryptoHolding: jest.fn(),
}));
jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: () => ({ showAlert: jest.fn() }),
}));
jest.mock('@/features/portfolio/application/portfolioQueries', () => ({
  portfolioQueries: { searchStocks: jest.fn(), searchCrypto: jest.fn() },
}));

const owners: AssetOwnerOption[] = [
  { key: 'household', label: '가구', ownerRef: { kind: 'household' } },
  { key: 'jiwoon', label: '지운', ownerRef: { kind: 'profile', profileId: 'jiwoon' } },
];

describe('[AST-001][T-AST-010] 자산 추가 모달 첫 표시', () => {
  test.each([
    ['jiwoon', '지운'],
    [undefined, '가구'],
    ['removed-profile', '가구'],
  ])('기본 명의 %s를 실제 Portal의 첫 commit부터 %s로 표시한다', (defaultOwnerKey, label) => {
    const commits: string[][] = [];
    const subTypeSelections: boolean[] = [];
    render(
      <Profiler id="add-modal" onRender={() => {
        commits.push(Array.from(document.querySelectorAll('button'))
          .filter((button) => owners.some((owner) => owner.label === button.textContent)
            && button.classList.contains('bg-blue-500'))
          .map((button) => button.textContent ?? ''));
        subTypeSelections.push(screen.getByRole('button', {
          name: ASSET_TYPE_CONFIG.savings.subTypes[0],
        }).classList.contains('bg-slate-800'));
      }}>
        <AssetAddModal isOpen onClose={jest.fn()} defaultType="savings"
          defaultOwnerKey={defaultOwnerKey} ownerOptions={owners} />
      </Profiler>
    );
    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((selection) => selection.length === 1 && selection[0] === label)).toBe(true);
    expect(subTypeSelections.every(Boolean)).toBe(true);
  });

  test('페이지처럼 닫을 때 unmount하고 다른 명의로 다시 열면 첫 commit부터 새 명의를 선택한다', () => {
    const { rerender } = render(<AssetAddModal isOpen onClose={jest.fn()} ownerOptions={owners} />);
    rerender(<></>);
    const selections: string[] = [];
    rerender(
      <Profiler id="reopen" onRender={() => {
        selections.push(screen.getByRole('button', { name: '지운' }).className);
      }}>
        <AssetAddModal isOpen onClose={jest.fn()} defaultOwnerKey="jiwoon" ownerOptions={owners} />
      </Profiler>
    );
    expect(selections.length).toBeGreaterThan(0);
    expect(selections.every((classes) => classes.includes('bg-blue-500'))).toBe(true);
  });
});
