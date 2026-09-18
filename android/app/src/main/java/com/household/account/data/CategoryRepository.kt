package com.household.account.data

import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.DocumentSnapshot
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
class CategoryRepository(private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    private fun catalogReference(householdId: String) = firestore.collection("households")
        .document(householdId).collection("categoryCatalog").document("current")

    private fun readCategories(snapshot: DocumentSnapshot, householdId: String): List<CategoryData> {
        if (!snapshot.exists()) return emptyList()
        require(snapshot.getLong("schemaVersion") == 1L && snapshot.getString("householdId") == householdId) {
            "CATEGORY_CATALOG_INVALID"
        }
        val entries = snapshot.get("categories") as? List<*> ?: error("CATEGORY_CATALOG_INVALID")
        val defaultCategoryId = snapshot.getString("defaultCategoryId")
        val categories = entries.map { entry ->
            val fields = entry as? Map<*, *> ?: error("CATEGORY_CATALOG_INVALID")
            val key = fields["categoryId"] as? String ?: error("CATEGORY_CATALOG_INVALID")
            val state = fields["state"] as? String ?: error("CATEGORY_CATALOG_INVALID")
            require(key.isNotBlank() && state in listOf("active", "archive-pending", "archived"))
            CategoryData(
                id = key, key = key,
                label = fields["name"] as? String ?: error("CATEGORY_CATALOG_INVALID"),
                color = fields["color"] as? String ?: error("CATEGORY_CATALOG_INVALID"),
                budget = (fields["budgetInWon"] as? Number)?.toLong(),
                order = (fields["sortOrder"] as? Number)?.toInt() ?: error("CATEGORY_CATALOG_INVALID"),
                isDefault = key == defaultCategoryId,
                isActive = state == "active", householdId = householdId,
            )
        }
        require(categories.map { it.key }.distinct().size == categories.size) { "CATEGORY_CATALOG_INVALID" }
        return categories.filter { it.isActive }.sortedWith(compareBy({ it.order }, { it.key }))
    }

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
            Log.w(TAG, "CATEGORY_SCOPE_MISSING")
            return DEFAULT_CATEGORIES
        }

        return try {
            val snapshot = catalogReference(householdId).get().await()
            val categories = readCategories(snapshot, householdId)

            if (categories.isEmpty()) {
                Log.w(TAG, "CATEGORY_RESULT_EMPTY")
                DEFAULT_CATEGORIES
            } else {
                categories
            }
        } catch (e: Exception) {
            Log.e(TAG, "CATEGORY_READ_FAILED")
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

        val listenerRegistration = catalogReference(householdId)
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null) {
                    Log.e(TAG, "CATEGORY_SUBSCRIPTION_FAILED")
                    trySend(DEFAULT_CATEGORIES)
                    return@addSnapshotListener
                }
                try {
                    trySend(readCategories(snapshot, householdId).ifEmpty { DEFAULT_CATEGORIES })
                } catch (e: Exception) {
                    Log.e(TAG, "CATEGORY_CATALOG_INVALID")
                    trySend(DEFAULT_CATEGORIES)
                }
            }

        awaitClose {
            listenerRegistration.remove()
        }
    }

    /**
     * key로 카테고리 찾기
     */
    fun findCategoryByKey(categories: List<CategoryData>, key: String): CategoryData? {
        return categories.find { it.key == key }
    }

    /**
     * label로 카테고리 찾기
     */
    fun findCategoryByLabel(categories: List<CategoryData>, label: String): CategoryData? {
        return categories.find { it.label == label }
    }

    /**
     * household 설정에서 기본 카테고리 키 가져오기
     */
    suspend fun getDefaultCategoryKey(householdId: String): String {
        if (householdId.isEmpty()) return "etc"

        return try {
            val catalog = catalogReference(householdId).get().await()
            val categories = readCategories(catalog, householdId)
            categories.firstOrNull { it.isDefault }?.key ?: "etc"
        } catch (e: Exception) {
            Log.e(TAG, "DEFAULT_CATEGORY_READ_FAILED")
            "etc"
        }
    }
}
