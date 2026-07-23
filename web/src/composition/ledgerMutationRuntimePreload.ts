let ledgerMutationRuntimePreload: Promise<void> | undefined;

/**
 * 모달 UI는 페이지 번들에 정적으로 포함합니다. 첫 paint 뒤에는 저장·삭제 같은
 * 후속 명령 코드만 준비해 첫 mutation의 모듈 로딩 지연을 줄입니다.
 */
export function preloadLedgerMutationRuntime(): Promise<void> {
  ledgerMutationRuntimePreload ??= Promise.all([
    import('@/lib/expenseService'),
    import('@/lib/merchantRuleService'),
    import('@/lib/partnerNotificationService'),
    import('@/features/ledger/application/ledgerCommands'),
  ]).then(() => undefined).catch((error) => {
    ledgerMutationRuntimePreload = undefined;
    throw error;
  });
  return ledgerMutationRuntimePreload;
}
