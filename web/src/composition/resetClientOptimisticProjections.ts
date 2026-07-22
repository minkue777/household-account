import { ledgerOptimisticProjection } from '@/features/ledger/application/ledgerOptimisticProjection';
import {
  cryptoHoldingOptimisticProjection,
  portfolioOptimisticProjection,
  stockHoldingOptimisticProjection,
} from '@/features/portfolio/application/portfolioOptimisticProjection';

/** Discards every session-owned optimistic overlay before auth scope changes. */
export function resetClientOptimisticProjections(): void {
  ledgerOptimisticProjection.reset();
  portfolioOptimisticProjection.reset();
  stockHoldingOptimisticProjection.reset();
  cryptoHoldingOptimisticProjection.reset();
}
