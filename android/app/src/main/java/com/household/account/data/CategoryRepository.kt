package com.household.account.data

import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * 카테고리 데이터 모델 (Firebase에서 가져오는 동적 카테고리)
 */
data class CategoryData(
    val id: String = "",
    val key: String = "",           // 'living', 'custom_001' 등
    val label: String = "",         // '생활비', '취미' 등
    val color: String = "#9CA3AF",  // '#4ADE80'
    val budget: Long? = null,       // 월 예산 (null이면 무제한)
    val order: Int = 0,             // 정렬 순서
    val isDefault: Boolean = false, // 기본 카테고리 (삭제 불가)
    val isActive: Boolean = true,   // 활성화 여부
    val householdId: String = ""    // 가구 ID
)

/**
 * Firebase Firestore를 통한 카테고리 데이터 관리
 */
class CategoryRepository {

    private val firestore = FirebaseFirestore.getInstance()
    private val categoriesCollection = firestore.collection("categories")

    companion object {
        private const val TAG = "CategoryRepository"

        // 기본 카테고리 (Firebase에 없을 때 폴백용)
        val DEFAULT_CATEGORIES = listOf(
            CategoryData(key = "living", label = "생활비", color = "#4ADE80", order = 0, isDefault = true),
            CategoryData(key = "childcare", label = "육아비", color = "#F472B6", order = 1, isDefault = true),
            CategoryData(key = "fixed", label = "고정비", color = "#60A5FA", order = 2, isDefault = true),
            CategoryData(key = "food", label = "식비", color = "#FBBF24", order = 3, isDefault = true),
            CategoryData(key = "etc", label = "기타", color = "#9CA3AF", order = 4, isDefault = true)
        )
    }

    /**
     * 모든 활성 카테고리 조회 (일회성, householdId 필터링)
     */
    suspend fun getActiveCategories(householdId: String): List<CategoryData> {
        if (householdId.isEmpty()) {
            Log.w(TAG, "householdId is empty, using defaults")
            return DEFAULT_CATEGORIES
        }

        return try {
            val snapshot = categoriesCollection
                .whereEqualTo("householdId", householdId)
                .orderBy("order", Query.Direction.ASCENDING)
                .get()
                .await()

            val categories = snapshot.documents.mapNotNull { doc ->
                try {
                    CategoryData(
                        id = doc.id,
                        key = doc.getString("key") ?: "",
                        label = doc.getString("label") ?: "",
                        color = doc.getString("color") ?: "#9CA3AF",
                        budget = doc.getLong("budget"),
                        order = doc.getLong("order")?.toInt() ?: 0,
                        isDefault = doc.getBoolean("isDefault") ?: false,
                        isActive = doc.getBoolean("isActive") ?: true,
                        householdId = doc.getString("householdId") ?: ""
                    )
                } catch (e: Exception) {
                    Log.e(TAG, "Document parse error", e)
                    null
                }
            }.filter { it.isActive }

            if (categories.isEmpty()) {
                Log.w(TAG, "No categories found for householdId: $householdId, using defaults")
                DEFAULT_CATEGORIES
            } else {
                categories
            }
        } catch (e: Exception) {
            Log.e(TAG, "getActiveCategories failed", e)
            DEFAULT_CATEGORIES
        }
    }

    /**
     * 카테고리 실시간 구독 (householdId 필터링)
     */
    fun subscribeToCategories(householdId: String): Flow<List<CategoryData>> = callbackFlow {
        if (householdId.isEmpty()) {
            trySend(DEFAULT_CATEGORIES)
            awaitClose { }
            return@callbackFlow
        }

        val listenerRegistration = categoriesCollection
            .whereEqualTo("householdId", householdId)
            .orderBy("order", Query.Direction.ASCENDING)
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    Log.e(TAG, "Firestore listen failed", error)
                    trySend(DEFAULT_CATEGORIES)
                    return@addSnapshotListener
                }

                val categories = snapshot?.documents?.mapNotNull { doc ->
                    try {
                        CategoryData(
                            id = doc.id,
                            key = doc.getString("key") ?: "",
                            label = doc.getString("label") ?: "",
                            color = doc.getString("color") ?: "#9CA3AF",
                            budget = doc.getLong("budget"),
                            order = doc.getLong("order")?.toInt() ?: 0,
                            isDefault = doc.getBoolean("isDefault") ?: false,
                            isActive = doc.getBoolean("isActive") ?: true,
                            householdId = doc.getString("householdId") ?: ""
                        )
                    } catch (e: Exception) {
                        null
                    }
                }?.filter { it.isActive } ?: DEFAULT_CATEGORIES

                trySend(categories.ifEmpty { DEFAULT_CATEGORIES })
            }

        awaitClose {
            listenerRegistration.remove()
        }
    }

    /**
     * key로 카테고리 찾기
     */
    fun findCategoryByKey(categories: List<CategoryData>, key: String): CategoryData? {
        // key가 대문자인 경우 (예전 enum 형식) 소문자로 변환
        val normalizedKey = key.lowercase()
        return categories.find { it.key == normalizedKey || it.key == key }
    }

    /**
     * label로 카테고리 찾기
     */
    fun findCategoryByLabel(categories: List<CategoryData>, label: String): CategoryData? {
        return categories.find { it.label == label }
    }

    /**
     * "기타" 카테고리 키 가져오기 (householdId 기반)
     * 우선순위: "기타" 라벨 > 첫 번째 활성 카테고리 > "etc" 폴백
     */
    suspend fun getDefaultCategoryKey(householdId: String): String {
        val categories = getActiveCategories(householdId)
        // 1. "기타" 라벨 카테고리 찾기
        val etcCategory = findCategoryByLabel(categories, "기타")
        if (etcCategory != null) return etcCategory.key
        // 2. 첫 번째 활성 카테고리 사용
        if (categories.isNotEmpty()) return categories.first().key
        // 3. 최후의 폴백
        return "etc"
    }
}
