"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupFailedTokens = cleanupFailedTokens;
const config_1 = require("./config");
/**
 * FCM 멀티캐스트 전송 후 실패한 토큰을 DB에서 삭제
 */
async function cleanupFailedTokens(tokens, response) {
    if (response.failureCount === 0)
        return;
    const failedTokens = [];
    response.responses.forEach((resp, idx) => {
        if (!resp.success) {
            failedTokens.push(tokens[idx]);
        }
    });
    const deletePromises = failedTokens.map(async (token) => {
        const tokenQuery = await config_1.db.collection('fcmTokens')
            .where('token', '==', token)
            .get();
        tokenQuery.forEach(doc => doc.ref.delete());
    });
    await Promise.all(deletePromises);
}
//# sourceMappingURL=helpers.js.map