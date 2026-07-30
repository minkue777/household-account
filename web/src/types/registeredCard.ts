export interface RegisteredCard {
  id: string;
  householdId: string;
  ownerMemberId: string;
  owner: string;
  cardLabel: string;
  cardLastFour: string;
  orderIndex?: number;
  lifecycle: 'active' | 'retired';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateRegisteredCardInput {
  householdId: string;
  owner: string;
  cardLabel: string;
  cardLastFour?: string;
  orderIndex?: number;
}

export const REGISTERED_CARD_LABELS = [
  '삼성',
  '국민',
  '농협',
  '롯데',
  '비씨',
  '현대',
  '우리',
  '신한',
  '하나',
  '네이버페이',
  '카카오페이',
  '토스',
  '대전사랑카드',
  '온누리상품권',
  '경기지역화폐',
  '세종지역화폐',
] as const;

export type RegisteredCardLabel = (typeof REGISTERED_CARD_LABELS)[number];

export const NUMBERLESS_REGISTERED_CARD_LABELS = new Set<RegisteredCardLabel>([
  '네이버페이',
  '카카오페이',
  '토스',
]);

function normalizeRegisteredCardLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function timestampLikeToDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate(): Date }).toDate();
  }
  return undefined;
}

export function mapRegisteredCardDocument(
  id: string,
  data: Record<string, unknown>
): RegisteredCard {
  const lifecycleValue =
    typeof data.lifecycle === 'string'
      ? data.lifecycle
      : typeof data.lifecycleState === 'string'
        ? data.lifecycleState
        : undefined;

  return {
    id,
    householdId: typeof data.householdId === 'string' ? data.householdId : '',
    ownerMemberId: typeof data.ownerMemberId === 'string' ? data.ownerMemberId : '',
    owner: typeof data.owner === 'string' ? data.owner : '',
    cardLabel: normalizeRegisteredCardLabel(data.cardCompanyCode ?? data.cardLabel),
    cardLastFour:
      typeof data.lastFour === 'string'
        ? data.lastFour
        : typeof data.cardLastFour === 'string'
          ? data.cardLastFour
          : '',
    orderIndex:
      typeof data.order === 'number'
        ? data.order
        : typeof data.orderIndex === 'number'
          ? data.orderIndex
          : undefined,
    lifecycle:
      lifecycleValue === 'retired'
      || (data.deletedAt !== undefined && data.deletedAt !== null)
        ? 'retired'
        : 'active',
    createdAt: timestampLikeToDate(data.createdAt),
    updatedAt: timestampLikeToDate(data.updatedAt),
  };
}
