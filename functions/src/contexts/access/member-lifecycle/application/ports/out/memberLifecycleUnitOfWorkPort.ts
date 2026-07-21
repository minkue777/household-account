import type { MemberLifecycleAggregate } from "../../../domain/model/memberLifecycle";

export interface MemberLifecycleMutation<T> {
  state: MemberLifecycleAggregate;
  value: T;
}

/**
 * Member·Membership·member profile·UID claim의 기존 Canonical Repository들을
 * 하나의 Access transaction으로 조합하는 Port입니다. 별도 lifecycle 저장소가 아닙니다.
 */
export interface MemberLifecycleUnitOfWorkPort {
  read(): Promise<MemberLifecycleAggregate>;
  transact<T>(
    operation: (
      state: MemberLifecycleAggregate,
    ) => MemberLifecycleMutation<T>,
  ): Promise<T>;
}
