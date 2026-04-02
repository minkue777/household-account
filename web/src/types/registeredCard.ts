import { Timestamp } from 'firebase/firestore';

export interface RegisteredCard {
  id: string;
  householdId: string;
  owner: string;
  cardLabel: string;
  cardLastFour: string;
  orderIndex?: number;
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

export function mapRegisteredCardDocument(
  id: string,
  data: Record<string, unknown>
): RegisteredCard {
  return {
    id,
    householdId: typeof data.householdId === 'string' ? data.householdId : '',
    owner: typeof data.owner === 'string' ? data.owner : '',
    cardLabel: normalizeRegisteredCardLabel(data.cardLabel),
    cardLastFour: typeof data.cardLastFour === 'string' ? data.cardLastFour : '',
    orderIndex: typeof data.orderIndex === 'number' ? data.orderIndex : undefined,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : undefined,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : undefined,
  };
}
