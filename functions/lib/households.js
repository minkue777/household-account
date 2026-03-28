"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.renameHouseholdMember = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const config_1 = require("./config");
exports.renameHouseholdMember = functions
    .region(config_1.REGION)
    .https.onCall(async (data) => {
    var _a;
    const householdId = typeof (data === null || data === void 0 ? void 0 : data.householdId) === 'string' ? data.householdId.trim() : '';
    const memberId = typeof (data === null || data === void 0 ? void 0 : data.memberId) === 'string' ? data.memberId.trim() : '';
    const newName = typeof (data === null || data === void 0 ? void 0 : data.newName) === 'string' ? data.newName.trim() : '';
    if (!householdId || !memberId || !newName) {
        throw new functions.https.HttpsError('invalid-argument', 'householdId, memberId, newName이 필요합니다.');
    }
    const householdRef = config_1.db.collection('households').doc(householdId);
    const householdSnap = await householdRef.get();
    if (!householdSnap.exists) {
        throw new functions.https.HttpsError('not-found', '가계를 찾을 수 없습니다.');
    }
    const householdData = householdSnap.data() || {};
    const members = Array.isArray(householdData.members) ? householdData.members : [];
    const memberIndex = members.findIndex((member) => (member === null || member === void 0 ? void 0 : member.id) === memberId);
    if (memberIndex === -1) {
        throw new functions.https.HttpsError('not-found', '멤버를 찾을 수 없습니다.');
    }
    const oldName = typeof ((_a = members[memberIndex]) === null || _a === void 0 ? void 0 : _a.name) === 'string' ? members[memberIndex].name : '';
    if (!oldName) {
        throw new functions.https.HttpsError('failed-precondition', '기존 멤버 이름이 비어 있습니다.');
    }
    const isDuplicateName = members.some((member) => (member === null || member === void 0 ? void 0 : member.id) !== memberId && typeof (member === null || member === void 0 ? void 0 : member.name) === 'string' && member.name.trim() === newName);
    if (isDuplicateName) {
        throw new functions.https.HttpsError('already-exists', '이미 같은 이름의 멤버가 있습니다.');
    }
    if (oldName === newName) {
        return {
            success: true,
            oldName,
            newName,
            updatedAssets: 0,
        };
    }
    const updatedMembers = members.map((member) => (member === null || member === void 0 ? void 0 : member.id) === memberId ? Object.assign(Object.assign({}, member), { name: newName }) : member);
    const batch = config_1.db.batch();
    batch.update(householdRef, { members: updatedMembers });
    const assetsSnapshot = await config_1.db
        .collection('assets')
        .where('householdId', '==', householdId)
        .get();
    const assetsToUpdate = assetsSnapshot.docs.filter((docSnap) => docSnap.data().owner === oldName);
    assetsToUpdate.forEach((docSnap) => {
        batch.update(docSnap.ref, {
            owner: newName,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    });
    const oldTokenRef = config_1.db.collection('fcmTokens').doc(`${householdId}_${oldName}`);
    const oldTokenSnap = await oldTokenRef.get();
    if (oldTokenSnap.exists) {
        const newTokenRef = config_1.db.collection('fcmTokens').doc(`${householdId}_${newName}`);
        batch.set(newTokenRef, Object.assign(Object.assign({}, oldTokenSnap.data()), { deviceOwner: newName, lastUpdated: admin.firestore.FieldValue.serverTimestamp() }), { merge: true });
        batch.delete(oldTokenRef);
    }
    await batch.commit();
    return {
        success: true,
        oldName,
        newName,
        updatedAssets: assetsToUpdate.length,
    };
});
//# sourceMappingURL=households.js.map