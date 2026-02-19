import { db } from './config';

/**
 * FCM 멀티캐스트 전송 후 실패한 토큰을 DB에서 삭제
 */
export async function cleanupFailedTokens(
  tokens: string[],
  response: { failureCount: number; responses: Array<{ success: boolean }> }
): Promise<void> {
  if (response.failureCount === 0) return;

  const failedTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      failedTokens.push(tokens[idx]);
    }
  });

  const deletePromises = failedTokens.map(async (token) => {
    const tokenQuery = await db.collection('fcmTokens')
      .where('token', '==', token)
      .get();
    tokenQuery.forEach(doc => doc.ref.delete());
  });
  await Promise.all(deletePromises);
}
