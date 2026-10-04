package com.household.account

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.household.account.data.CategoryRepository
import com.household.account.data.CategoryData
import java.util.UUID
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.tasks.await
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CategoryRepositoryInstrumentationTest {
    @Test
    fun categoryLookupPreservesCaseSensitiveIds() {
        val repository = CategoryRepository()
        val lowercase = CategoryData(key = "category-abcd_123", label = "다른 카테고리")
        val original = CategoryData(key = "category-aBcD_123", label = "간식/디저트/커피")
        val categories = listOf(lowercase, original)

        assertEquals(original, repository.findCategoryByKey(categories, original.key))
        assertEquals(lowercase, repository.findCategoryByKey(categories, lowercase.key))
        assertNull(repository.findCategoryByKey(listOf(original), lowercase.key))
    }

    // CAT-004 / T-CAT-005: Legacy QuickEdit의 실제 adapter만 별도 SDK 인스턴스로 실행합니다.
    // production singleton과 외부 Firebase는 변경하거나 호출하지 않습니다.
    private suspend fun withIsolatedRepository(
        test: suspend (CategoryRepository, FirebaseFirestore) -> Unit
    ) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val app = FirebaseApp.initializeApp(
            context,
            FirebaseOptions.Builder()
                .setApplicationId("1:1234567890:android:category-fallback")
                .setProjectId("demo-category-fallback")
                .setApiKey("local-test-key")
                .build(),
            "category-fallback-${UUID.randomUUID()}"
        )
        FirebaseAuth.getInstance(app).useEmulator("127.0.0.1", 1)
        val firestore = FirebaseFirestore.getInstance(app)
        firestore.firestoreSettings = FirebaseFirestoreSettings.Builder()
            .setHost("127.0.0.1:1")
            .setSslEnabled(false)
            .setPersistenceEnabled(false)
            .build()
        firestore.disableNetwork().await()
        val repository = CategoryRepository(firestore)
        try {
            test(repository, firestore)
        } finally {
            firestore.terminate().await()
            // Firestore 종료는 Auth의 이미 실행 중인 TokenRefresher까지 기다리지 않습니다.
            // 여기서 app.delete()하면 뒤의 Activity 검사 도중 SDK가 삭제된 앱에 접근합니다.
            // 두 fixture는 고유 이름·demo 프로젝트·로컬 endpoint로 격리하며, FirebaseApp은
            // instrumentation 프로세스가 끝날 때 함께 회수합니다. 연결 종료 오류는 숨기지 않습니다.
        }
    }

    @Test
    fun emptySdkCatalogUsesExactlyFiveDisplayOnlyFallbackCategories() = runBlocking {
        withIsolatedRepository { repository, firestore ->
            val reference = firestore.collection("households").document("house-empty")
                .collection("categoryCatalog").document("current")
            // Fixture is cached locally; no network or production data is used.
            reference.set(mapOf("schemaVersion" to 1, "householdId" to "house-empty",
                "categories" to emptyList<Map<String, Any>>(), "catalogVersion" to 0,
                "defaultCategoryId" to null))
            val source = reference.get().await()
            assertTrue((source.get("categories") as List<*>).isEmpty())
            assertTrue(source.metadata.isFromCache)

            val categories = repository.getActiveCategories("house-empty")
            assertEquals(listOf("living", "childcare", "fixed", "food", "etc"), categories.map { it.key })
            assertTrue(categories.all { it.id.isEmpty() && it.householdId.isEmpty() && it.isDefault })
        }
    }

    @Test
    fun actualSdkReadFailureUsesTheSameDisplayOnlyFallbackWithoutWriting() = runBlocking {
        withIsolatedRepository { repository, firestore ->
            val query = firestore.collection("households").document("house-failure")
                .collection("categoryCatalog").document("current")
            firestore.terminate().await()
            assertNotNull(runCatching { query.get().await() }.exceptionOrNull())

            assertEquals(CategoryRepository.DEFAULT_CATEGORIES, repository.getActiveCategories("house-failure"))
            assertEquals(5, repository.getActiveCategories("").size)
        }
    }
}
