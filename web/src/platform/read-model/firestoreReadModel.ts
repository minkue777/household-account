/**
 * Web read-side 전용 Firestore 경계입니다.
 *
 * 이 모듈은 Query/listener API만 노출합니다. Command 측 변경 API와
 * transaction/batch API는 Functions 경계를 거치도록 의도적으로 제외합니다.
 */
import { onSnapshot as firebaseOnSnapshot } from 'firebase/firestore';
import { requestRemoteSessionRecovery } from '@/platform/functions-api/firebaseCallableRecovery';

export {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  orderBy,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

export { db } from '@/lib/firebase';

type FirestoreListener = (...args: unknown[]) => () => void;

/**
 * Firestore listener는 error callback 뒤 자동 재개되지 않습니다. Android 인증이
 * 만료된 경우 Context의 단일 복구 경로를 깨우고, 복구 epoch가 모든 구독을 다시
 * 생성하도록 합니다. 원래 listener overload와 callback 동작은 그대로 보존합니다.
 */
export const onSnapshot = ((...rawArguments: unknown[]) => {
  const args = [...rawArguments];
  const secondArgument = args[1];
  const secondArgumentIsObserver =
    typeof secondArgument === 'object'
    && secondArgument !== null
    && 'next' in secondArgument;
  const callbackIndex =
    typeof secondArgument === 'function' || secondArgumentIsObserver ? 1 : 2;
  const callbackOrObserver = args[callbackIndex];

  if (
    typeof callbackOrObserver === 'object'
    && callbackOrObserver !== null
    && 'next' in callbackOrObserver
  ) {
    const observer = callbackOrObserver as {
      next?: unknown;
      error?: (error: unknown) => void;
      complete?: unknown;
    };
    args[callbackIndex] = {
      ...observer,
      error: (error: unknown) => {
        requestRemoteSessionRecovery();
        observer.error?.(error);
      },
    };
  } else {
    const errorIndex = callbackIndex + 1;
    const originalError = args[errorIndex];
    args[errorIndex] = (error: unknown) => {
      requestRemoteSessionRecovery();
      if (typeof originalError === 'function') {
        (originalError as (value: unknown) => void)(error);
      }
    };
  }

  return (firebaseOnSnapshot as unknown as FirestoreListener)(...args);
}) as typeof firebaseOnSnapshot;

interface TimestampLike {
  toDate(): Date;
}

export function timestampToDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as TimestampLike).toDate === 'function'
  ) {
    return (value as TimestampLike).toDate();
  }
  return undefined;
}
