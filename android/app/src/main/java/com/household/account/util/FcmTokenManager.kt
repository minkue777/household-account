package com.household.account.util

import android.content.Context
import android.os.Build
import android.util.Log
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.messaging.FirebaseMessaging

/**
 * FCM 토큰을 Firestore fcmTokens 컬렉션에 저장하는 유틸리티
 */
object FcmTokenManager {

    private const val TAG = "FcmTokenManager"
    private const val COLLECTION = "fcmTokens"

    /**
     * FCM 토큰을 Firestore에 저장 (기존 토큰이면 업데이트, 없으면 생성)
     */
    fun saveTokenToFirestore(context: Context, token: String) {
        val householdId = HouseholdPreferences.getHouseholdKey(context)
        val memberName = HouseholdPreferences.getMemberName(context)

        if (householdId.isEmpty() || memberName.isEmpty()) {
            Log.d(TAG, "householdId or memberName is empty, skipping token save")
            return
        }

        val db = FirebaseFirestore.getInstance()

        val tokenData = hashMapOf<String, Any>(
            "token" to token,
            "householdId" to householdId,
            "deviceOwner" to memberName,
            "deviceInfo" to hashMapOf(
                "platform" to "android-native",
                "model" to Build.MODEL,
                "sdk" to Build.VERSION.SDK_INT
            ),
            "lastUpdated" to FieldValue.serverTimestamp()
        )

        // householdId_deviceOwner를 document ID로 사용 → 1인 1토큰 보장
        val docId = "${householdId}_${memberName}"
        db.collection(COLLECTION).document(docId)
            .set(tokenData, SetOptions.merge())
            .addOnSuccessListener {
                Log.d(TAG, "FCM token saved to Firestore")
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Failed to save FCM token", e)
            }
    }

    /**
     * 현재 FCM 토큰을 가져와서 Firestore에 저장
     */
    fun registerCurrentToken(context: Context) {
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                Log.d(TAG, "FCM token obtained, saving to Firestore")
                saveTokenToFirestore(context, token)
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Failed to get FCM token", e)
            }
    }
}
