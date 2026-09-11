import { test, expect } from '@playwright/test';
import { createHouseholdThroughUi, firestoreFields, resetTestAccount, writeFirestoreFixture } from './emulator';
import { records, paymentCommand, rawNotification, registerCard, submitRaw } from './payment-helpers';
import { addCategoryThroughUi, openExpenseEdit, textField } from './finance-helpers';

test.beforeEach(resetTestAccount);

test('[CARD-001][CARD-002][CARD-005] 카드 등록·중복 안내·끝 번호 수정·삭제가 실제 등록부와 연결되고 과거 지출 카드는 유지된다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: /^카드 등록/ }).click();
  await page.getByRole('button', { name: '카드 등록', exact: true }).click();
  await page.getByRole('button', { name: '국민', exact: true }).click();
  await page.getByPlaceholder('예: 1234').fill('1234');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('[data-card-id]')).toHaveCount(1);
  const id = await page.locator('[data-card-id]').getAttribute('data-card-id');
  const captured = await submitRaw(request, actor, rawNotification());
  expect(captured.transactionResult.kind).toBe('created');
  await page.getByRole('button', { name: '카드 등록', exact: true }).click();
  await page.getByRole('button', { name: '국민', exact: true }).click();
  await page.getByPlaceholder('예: 1234').fill('1234');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('이미 등록된 카드입니다.')).toBeVisible();
  expect((await records(request, 'registered_cards')).filter(row => row.lifecycleState !== 'retired')).toHaveLength(1);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await page.locator(`[data-card-id="${id}"]`).click();
  await page.getByPlaceholder('예: 1234').fill('5678');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator(`[data-card-id="${id}"]`)).toContainText('5678');
  const afterEdit = await submitRaw(request, actor, rawNotification({ merchant: '수정 카드 거래', card: '5678' }));
  expect(afterEdit.transactionResult.kind).toBe('created');
  const saved = (await records(request, 'registered_cards')).find(row => row.id === id)!;
  await expect(paymentCommand(request, actor, 'payment-configuration.update-card.v1', { cardId: id, expectedVersion: saved.aggregateVersion,
    changes: { cardLabel: '삼성' } })).rejects.toThrow('CARD_IDENTITY_CHANGE_REQUIRES_REREGISTRATION');
  await page.locator(`[data-card-id="${id}"]`).click();
  await page.getByRole('button', { name: '삭제', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.locator('[data-card-id]')).toHaveCount(0);
  const expense = (await records(request, 'expenses')).find(row => row.id === captured.transactionResult.transactionId)!;
  expect(expense.cardLastFour).toContain('1234');
  const retired = await submitRaw(request, actor, rawNotification({ merchant: '삭제 카드 거래', card: '5678' }));
  expect(retired.transactionResult.kind).toBe('rejected');
});

test('[T-CARD-003][CARD-003] 실제 카드 길게 끌기 순서는 재진입에도 유지되고 서버는 누락된 전체 순서를 거부한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const left = await registerCard(request, actor, '국민', '1234');
  const right = await registerCard(request, actor, '삼성', '5678');
  await page.goto('/settings');
  await page.getByRole('button', { name: /^카드 등록/ }).click();
  const items = page.locator('[data-card-id]');
  await expect(items).toHaveCount(2);
  const first = await items.first().boundingBox();
  const last = await items.last().boundingBox();
  expect(first).not.toBeNull(); expect(last).not.toBeNull();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(300); // Product long-press threshold is 240 ms.
  await page.mouse.move(last!.x + last!.width / 2, last!.y + last!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(items.first()).toHaveAttribute('data-card-id', right.cardId);
  await page.reload();
  await page.getByRole('button', { name: /^카드 등록/ }).click();
  await expect(items.first()).toHaveAttribute('data-card-id', right.cardId);
  const meta = (await records(request, `households/${actor.householdId}/paymentConfigurationMeta`)).find(row => row.id === 'registered-cards')!;
  await expect(paymentCommand(request, actor, 'payment-configuration.reorder-cards.v1', { cardIds: [left.cardId], expectedCollectionVersion: meta.collectionVersions[`${actor.householdId}:${actor.memberId}`] })).rejects.toThrow('INCOMPLETE_CARD_SET');
});

test('[T-MER-006][MER-001][MER-003][MER-005][CAT-004] 사용자 카테고리와 쉼표 규칙을 적용하고 기억하기는 기존 exact를 보존하며 새 가맹점의 exact를 만든다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const category = await addCategoryThroughUi(page, request, '간식/디저트/커피');
  const categoryId = textField(category, 'key')!;
  await registerCard(request, actor);
  await page.goto('/settings');
  await page.getByRole('button', { name: /^가맹점 규칙/ }).click();
  await page.getByRole('button', { name: '새 규칙 추가', exact: true }).click();
  await page.getByPlaceholder('예: 스타벅스, 효성에프엠에스').fill(' cafe, 커피점 ');
  await page.getByRole('button', { name: '일치', exact: true }).click();
  await page.getByPlaceholder('비워두면 원본 가맹점명 유지').fill('우리 카페');
  await page.getByRole('button', { name: '간식/', exact: true }).click();
  await page.getByPlaceholder('자동으로 추가될 메모').fill('원두');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('cafe, 커피점', { exact: true })).toBeVisible();
  const captured = await submitRaw(request, actor, rawNotification({ merchant: 'CAFE' }));
  expect(captured.transactionResult.quickEditSnapshot).toMatchObject({ categoryId, merchant: '우리 카페', memo: '원두' });
  const edit = await openExpenseEdit(page, captured.transactionResult.transactionId);
  await expect(edit.getByRole('button', { name: '간식', exact: true })).toHaveClass(/border-blue-500/);
  await edit.getByRole('button', { name: '식비', exact: true }).click();
  await edit.getByText('이 가맹점 기억하기', { exact: true }).click();
  await edit.getByRole('button', { name: '저장', exact: true }).click();
  await expect.poll(async () => (await records(request, 'expenses')).find(row => row.id === captured.transactionResult.transactionId)?.category).toBe('food');
  // MER-005: 이미 존재하는 exact는 사용자가 만든 mapping을 덮어쓰지 않고 재사용합니다.
  const next = await submitRaw(request, actor, rawNotification({ merchant: 'CAFE', amount: 15000 }));
  expect(next.transactionResult.quickEditSnapshot).toMatchObject({ categoryId, merchant: '우리 카페', memo: '원두' });
  const savedRules = await records(request, 'merchant_rules');
  expect(savedRules).toHaveLength(1);
  expect(savedRules[0].merchantKeyword.toLowerCase()).toContain('cafe');

  const fresh = await submitRaw(request, actor, rawNotification({ merchant: '새 기억 가맹점', amount: 16000 }));
  expect(fresh.transactionResult.quickEditSnapshot.categoryId).toBe('etc');
  const freshEdit = await openExpenseEdit(page, fresh.transactionResult.transactionId);
  await freshEdit.getByRole('button', { name: '식비', exact: true }).click();
  await freshEdit.getByText('이 가맹점 기억하기', { exact: true }).click();
  await freshEdit.getByRole('button', { name: '저장', exact: true }).click();
  // 모달은 낙관적으로 닫힙니다. 후속 수집 전 실제 원장+규칙 transaction 완료를 관측합니다.
  await expect.poll(async () => (await records(request, 'expenses')).find(row => row.id === fresh.transactionResult.transactionId)?.category).toBe('food');
  const rememberedRules = await records(request, 'merchant_rules');
  expect(rememberedRules).toHaveLength(2);
  expect(rememberedRules.find(row => row.merchantKeyword === '새 기억 가맹점')).toMatchObject({ matchType: 'exact', mapping: { category: 'food' } });
  const rememberedCapture = await submitRaw(request, actor, rawNotification({ merchant: '새 기억 가맹점', amount: 17000 }));
  expect(rememberedCapture.transactionResult.quickEditSnapshot.categoryId).toBe('food');
});

test('[MER-001][MER-002][MER-007] 규칙은 좁은 매칭을 우선하며 중복 거절·카테고리 보관이 서버 저장에 반영된다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor);
  const category = await paymentCommand(request, actor, 'category.create.v1', { category: { label: '규칙 카테고리', color: '#F9A8D4' } });
  for (const [matchType, keyword, merchant] of [['contains', 'CAFE', '포함'], ['endsWith', 'CAFE', '끝'], ['startsWith', 'CAFE', '시작'], ['exact', 'CAFE', '정확']]) {
    await paymentCommand(request, actor, 'payment-configuration.create-merchant-rule.v1', { rule: {
      merchantKeyword: keyword, matchType, mapping: { merchant, category: category.categoryId },
    } });
  }
  const first = await submitRaw(request, actor, rawNotification({ merchant: 'CAFE' }));
  expect(first.transactionResult.quickEditSnapshot).toMatchObject({ merchant: '정확', categoryId: category.categoryId });
  await expect(paymentCommand(request, actor, 'payment-configuration.create-merchant-rule.v1', { rule: { merchantKeyword: 'cafe, OTHER', matchType: 'exact', mapping: { category: 'etc' } } })).rejects.toThrow('RULE_ALREADY_EXISTS');
  const cat = (await records(request, `households/${actor.householdId}/categories`)).find(row => row.categoryId === category.categoryId)!;
  await paymentCommand(request, actor, 'category.archive.v1', { categoryId: category.categoryId, expectedVersion: cat.aggregateVersion ?? cat.version });
  const next = await submitRaw(request, actor, rawNotification({ merchant: 'CAFE', amount: 15500 }));
  expect(next.transactionResult.quickEditSnapshot.categoryId).not.toBe(category.categoryId);
  expect(next.transactionResult.quickEditSnapshot.merchant).toBe('정확');
  const projection = (await records(request, `households/${actor.householdId}/runtimeProjections`)).find(row => row.id === 'payment-capture-configuration-v1')!;
  expect(projection.activeCategoryIds).not.toContain(category.categoryId);
});

test('[MER-001][MER-003][MER-004] 동일 유형의 규칙 우선순위·수정·삭제 UI는 새 수집 결과와 새로고침에 반영된다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor);
  const tea = await paymentCommand(request, actor, 'payment-configuration.create-merchant-rule.v1', { rule: { merchantKeyword: 'TEA', matchType: 'contains', mapping: { merchant: '차 규칙', category: 'food' } } });
  const cafe = await paymentCommand(request, actor, 'payment-configuration.create-merchant-rule.v1', { rule: { merchantKeyword: 'CAFE', matchType: 'contains', mapping: { merchant: '커피 규칙', category: 'fixed' } } });
  await page.goto('/settings');
  await page.getByRole('button', { name: /^가맹점 규칙/ }).click();
  const priorities = (await records(request, 'merchant_rules')).sort((left, right) => right.priority - left.priority);
  const lowerKeyword = priorities[1].merchantKeyword;
  await page.getByRole('button', { name: `${lowerKeyword} 우선순위 올리기`, exact: true }).click();
  await expect.poll(async () => (await records(request, 'merchant_rules')).sort((left, right) => right.priority - left.priority).map(row => row.merchantKeyword)).toEqual([lowerKeyword, priorities[0].merchantKeyword]);
  const preferredId = lowerKeyword === 'TEA' ? tea.ruleId : cafe.ruleId;
  const otherId = lowerKeyword === 'TEA' ? cafe.ruleId : tea.ruleId;
  const first = await submitRaw(request, actor, rawNotification({ merchant: 'TEA CAFE' }));
  expect(first.transactionResult.quickEditSnapshot.merchant).toBe(lowerKeyword === 'TEA' ? '차 규칙' : '커피 규칙');
  await page.getByRole('button', { name: `${lowerKeyword} 규칙 수정`, exact: true }).click();
  await page.getByPlaceholder('비워두면 원본 가맹점명 유지').fill('수정한 규칙');
  await page.getByPlaceholder('자동으로 추가될 메모').fill('설정에서 수정한 메모');
  await page.getByRole('button', { name: '생활비', exact: true }).click();
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('수정한 규칙', { exact: true })).toBeVisible();
  const changed = await submitRaw(request, actor, rawNotification({ merchant: 'TEA CAFE', amount: 13000 }));
  expect(changed.transactionResult.quickEditSnapshot).toMatchObject({ merchant: '수정한 규칙', categoryId: 'living', memo: '설정에서 수정한 메모' });
  await page.reload();
  await page.getByRole('button', { name: /^가맹점 규칙/ }).click();
  await expect(page.getByText('수정한 규칙', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: `${lowerKeyword} 규칙 삭제`, exact: true }).click();
  await page.getByRole('dialog', { name: '가맹점 규칙 삭제' }).getByRole('button', { name: '삭제', exact: true }).click();
  await expect(page.getByRole('button', { name: `${lowerKeyword} 규칙 수정`, exact: true })).toHaveCount(0);
  const afterDelete = await submitRaw(request, actor, rawNotification({ merchant: 'TEA CAFE', amount: 14000 }));
  expect(afterDelete.transactionResult.quickEditSnapshot.merchant).toBe(lowerKeyword === 'TEA' ? '커피 규칙' : '차 규칙');
  const remaining = await records(request, 'merchant_rules');
  expect(remaining.map(row => row.id)).toEqual([otherId]);
  expect(remaining.map(row => row.id)).not.toContain(preferredId);
});

test('[MER-006][MER-002] 과거 exactMatch·category 필드의 실제 저장 문서는 projection 재생성 후 정확·포함·기본 카테고리로 수집된다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  await registerCard(request, actor);
  await writeFirestoreFixture(request, 'merchant_rules/legacy-exact', firestoreFields({ householdId: actor.householdId, merchantKeyword: 'LEGACY CAFE', exactMatch: true, category: 'food', isActive: true }));
  await writeFirestoreFixture(request, 'merchant_rules/legacy-contains', firestoreFields({ householdId: actor.householdId, merchantKeyword: 'LEGACY', exactMatch: false, category: 'fixed', priority: 10, isActive: true }));
  await writeFirestoreFixture(request, 'merchant_rules/legacy-disabled', firestoreFields({ householdId: actor.householdId, merchantKeyword: '중지 CAFE', exactMatch: true, category: 'food', active: false }));
  // 최초 capture 이전에 실제 저장 projection을 무효화합니다. warm cache를
  // 테스트 전용 API로 지우거나 Query/매칭 결과를 대체하지 않습니다.
  await writeFirestoreFixture(request, `households/${actor.householdId}/runtimeProjections/payment-capture-configuration-v1`, firestoreFields({ householdId: actor.householdId, schemaVersion: 0 }));
  const exact = await submitRaw(request, actor, rawNotification({ merchant: 'legacy cafe', amount: 3100 }));
  expect(exact.transactionResult.quickEditSnapshot).toMatchObject({ categoryId: 'food', merchant: 'legacy cafe' });
  const contains = await submitRaw(request, actor, rawNotification({ merchant: 'NEW LEGACY CAFE', amount: 3200 }));
  expect(contains.transactionResult.quickEditSnapshot.categoryId).toBe('fixed');
  const noMatch = await submitRaw(request, actor, rawNotification({ merchant: '중지 CAFE', amount: 3300 }));
  expect(noMatch.transactionResult.quickEditSnapshot.categoryId).toBe('etc');
  const legacy = await records(request, 'merchant_rules');
  expect(legacy.every(row => row.matchType === undefined && row.mapping === undefined)).toBe(true);
  const projection = (await records(request, `households/${actor.householdId}/runtimeProjections`)).find(row => row.id === 'payment-capture-configuration-v1')!;
  expect(projection.merchantRules).toEqual(expect.arrayContaining([
    expect.objectContaining({ ruleId: 'legacy-exact', matchType: 'exact', mapping: { categoryId: 'food' } }),
    expect.objectContaining({ ruleId: 'legacy-contains', matchType: 'contains', mapping: { categoryId: 'fixed' } }),
    expect.objectContaining({ ruleId: 'legacy-disabled', matchType: 'exact', active: false, mapping: { categoryId: 'food' } }),
  ]));
});
