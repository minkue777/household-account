package com.household.account

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import android.widget.LinearLayout
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.ViewAction
import androidx.test.espresso.UiController
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.RootMatchers.isDialog
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import org.hamcrest.Matcher
import com.google.firebase.auth.FirebaseAuth
import com.household.account.data.CategoryData
import com.household.account.quickedit.AndroidKeystoreQuickEditCommandOutboxStore
import com.household.account.ledger.HouseholdCommandKind
import com.household.account.util.HouseholdPreferences
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout
import androidx.work.WorkManager
import com.google.android.flexbox.FlexboxLayout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class QuickEditActivityInstrumentationTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences("household_prefs", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        context.getSharedPreferences("quick_edit_pending_queue.v1", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    @After
    fun tearDown() {
        runBlocking { HouseholdPreferences.clearHouseholdKey(context) }
        context.getSharedPreferences("household_prefs", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
        context.getSharedPreferences("quick_edit_pending_queue.v1", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    @Test
    fun notifyOnlyPersistsVersionedCommandWithoutUnsavedFormValues() {
        prepareLocalCommandSession()
        launchQuickEdit().use { scenario ->
            scenario.onActivity { activity ->
                activity.findViewById<EditText>(R.id.etMerchant).setText("저장하지 않을 가맹점")
                activity.findViewById<EditText>(R.id.etAmount).setText("99001")
                activity.findViewById<EditText>(R.id.etMemo).setText("저장하지 않을 메모")
                activity.findViewById<Button>(R.id.btnNotify).performClick()
            }
            val store = AndroidKeystoreQuickEditCommandOutboxStore(context)
            waitUntil("알림 요청 암호화 outbox commit") { store.load().isNotEmpty() }
            val entry = store.load().single()
            assertEquals(HouseholdCommandKind.REQUEST_HOUSEHOLD_NOTIFICATION, entry.envelope.command)
            assertEquals(setOf("transactionId", "expectedVersion"), entry.envelope.payload.keys)
            assertEquals("expense-quick-edit-test", entry.envelope.payload["transactionId"])
            assertEquals(3, (entry.envelope.payload["expectedVersion"] as Number).toInt())
            waitUntil("Worker 영속 예약 후 QuickEdit 닫기") { scenario.state == Lifecycle.State.DESTROYED }
            assertWorkerReservationExists()
        }
    }

    @Test
    fun splitAmountEditingBalancesTwoItemsButKeepsThreeItemsIndependent() {
        prepareLocalCommandSession()
        launchQuickEdit().use { scenario ->
            scenario.onActivity { activity ->
                activity.findViewById<EditText>(R.id.etAmount).setText("12000")
                activity.findViewById<Button>(R.id.btnSplit).performClick()
            }
            editSplitRows { rows ->
                assertEquals(2, rows.childCount)
                rows.amount(0).setText("7500")
                assertEquals("4500", rows.amount(1).text.toString())
            }
            onView(withId(R.id.btnAddSplit)).inRoot(isDialog()).perform(click())
            editSplitRows { rows ->
                assertEquals(3, rows.childCount)
                rows.amount(0).setText("3000")
                assertEquals("4500", rows.amount(1).text.toString())
                assertEquals("0", rows.amount(2).text.toString())
                rows.amount(2).setText("4500")
                assertEquals("3000", rows.amount(0).text.toString())
                assertEquals("4500", rows.amount(1).text.toString())
                rows.getChildAt(2).findViewById<ImageButton>(R.id.btnRemove).performClick()
            }
            editSplitRows { rows ->
                assertEquals(2, rows.childCount)
                rows.amount(0).setText("5000")
                assertEquals("7000", rows.amount(1).text.toString())
            }
            onView(withId(R.id.btnCancelSplit)).inRoot(isDialog()).perform(click())
            scenario.onActivity { activity -> assertFalse(activity.isFinishing) }
            assertTrue(AndroidKeystoreQuickEditCommandOutboxStore(context).load().isEmpty())
        }
    }

    private fun editSplitRows(action: (LinearLayout) -> Unit) {
        onView(withId(R.id.splitItemsContainer)).inRoot(isDialog()).perform(object : ViewAction {
            override fun getConstraints(): Matcher<View> = isAssignableFrom(LinearLayout::class.java)
            override fun getDescription() = "분할 dialog의 실제 금액 입력과 TextWatcher 확인"
            override fun perform(uiController: UiController, view: View) {
                action(view as LinearLayout)
                uiController.loopMainThreadUntilIdle()
            }
        })
    }

    private fun LinearLayout.amount(index: Int): EditText = getChildAt(index).findViewById(R.id.etAmount)

    @Test
    fun splitFreezesWholeFormAtDialogOpenAndCommitsOneEnvelope() {
        prepareLocalCommandSession()
        val categoryId = "category-aBcD_123"
        launchQuickEdit(categoryId).use { scenario ->
            scenario.onActivity { activity ->
                activity.findViewById<EditText>(R.id.etMerchant).setText("분할 초안")
                activity.findViewById<EditText>(R.id.etAmount).setText("12000")
                activity.findViewById<EditText>(R.id.etMemo).setText("버튼 시점 메모")
                activity.findViewById<Button>(R.id.btnSplit).performClick()
                // A later form refresh must not mutate the already opened draft.
                activity.findViewById<EditText>(R.id.etMemo).setText("이후 변경")
            }
            onView(withId(R.id.btnConfirmSplit)).inRoot(isDialog()).perform(click())
            val store = AndroidKeystoreQuickEditCommandOutboxStore(context)
            waitUntil("분할 암호화 outbox commit") { store.load().isNotEmpty() }
            val envelope = store.load().single().envelope
            assertEquals(HouseholdCommandKind.SPLIT, envelope.command)
            assertEquals(3, (envelope.payload["expectedVersion"] as Number).toInt())
            val operation = envelope.payload["operation"] as Map<*, *>
            val draft = operation["baseDraft"] as Map<*, *>
            assertEquals("분할 초안", draft["merchant"])
            assertEquals(12000, (draft["amountInWon"] as Number).toInt())
            assertEquals("버튼 시점 메모", draft["memo"])
            assertEquals(categoryId, draft["categoryId"])
            assertEquals(setOf("merchant", "amountInWon", "categoryId", "memo"), draft.keys)
            val items = operation["items"] as List<*>
            assertEquals(12000, items.sumOf { ((it as Map<*, *>)["amountInWon"] as Number).toInt() })
            assertTrue(items.all { (it as Map<*, *>)["categoryId"] == categoryId })
            waitUntil("Worker 영속 예약 후 QuickEdit 닫기") { scenario.state == Lifecycle.State.DESTROYED }
            assertWorkerReservationExists()
        }
    }

    @Test
    fun customCategoryIsSelectedByExactIdAndMemoSavePreservesIt() {
        prepareLocalCommandSession()
        val categoryId = "category-aBcD_123"
        launchQuickEdit(categoryId).use { scenario ->
            scenario.onActivity { activity ->
                // 조회 결과만 주입하고 Intent 해석, 버튼 생성·선택, 저장은 실제 Activity로 검증합니다.
                val catalog = listOf(
                    CategoryData(key = "category-abcd_123", label = "다른 카테고리"),
                    CategoryData(key = categoryId, label = "간식/디저트/커피")
                )
                QuickEditActivity::class.java.getDeclaredField("categories").apply {
                    isAccessible = true
                    set(activity, catalog)
                }
                QuickEditActivity::class.java.getDeclaredMethod("setupCategoryButtons").apply {
                    isAccessible = true
                    invoke(activity)
                }

                val categories = activity.findViewById<FlexboxLayout>(R.id.categoryContainer)
                assertEquals(2, categories.childCount)
                assertFalse(categories.getChildAt(0).isSelected)
                assertTrue(categories.getChildAt(1).isSelected)
                assertTrue(categories.getChildAt(1).descendantTexts().contains("간식"))
                activity.findViewById<EditText>(R.id.etMemo).setText("메모 추가")
                activity.findViewById<Button>(R.id.btnSave).performClick()
            }

            val store = AndroidKeystoreQuickEditCommandOutboxStore(context)
            waitUntil("메모 수정 암호화 outbox commit") { store.load().isNotEmpty() }
            val envelope = store.load().single().envelope
            assertEquals(HouseholdCommandKind.UPDATE, envelope.command)
            assertEquals(mapOf("memo" to "메모 추가"), envelope.payload["patch"])
            waitUntil("메모 수정 접수 후 QuickEdit 닫기") { scenario.state == Lifecycle.State.DESTROYED }
            assertWorkerReservationExists()
        }
    }

    private fun prepareLocalCommandSession() {
        // No authenticated remote request can leave this instrumentation test.
        check(FirebaseAuth.getInstance().currentUser == null)
        runBlocking {
            HouseholdPreferences.replaceAuthenticatedSession(context, "instrumentation-house", "instrumentation-member", "테스터")
        }
        AndroidKeystoreQuickEditCommandOutboxStore(context).clear()
    }

    private fun assertWorkerReservationExists() = runBlocking {
        withTimeout(5_000) {
            WorkManager.getInstance(context)
                .getWorkInfosForUniqueWorkFlow("quick-edit-command-delivery.v1")
                .first { it.isNotEmpty() }
        }
        Unit
    }

    @Test
    fun launchPaintsIntentSnapshotAndSelectedCategoryImmediately() {
        launchQuickEdit().use { scenario ->
            scenario.onActivity { activity ->
                assertEquals(
                    "롯데쇼핑동탄",
                    activity.findViewById<EditText>(R.id.etMerchant).text.toString()
                )
                assertEquals(
                    "20300",
                    activity.findViewById<EditText>(R.id.etAmount).text.toString()
                )
                assertEquals(
                    "테스트 메모",
                    activity.findViewById<EditText>(R.id.etMemo).text.toString()
                )
                assertEquals(
                    "07/31 17:40",
                    activity.findViewById<TextView>(R.id.tvDateTime).text.toString()
                )
                listOf(R.id.btnSave, R.id.btnDelete, R.id.btnSplit, R.id.btnNotify)
                    .forEach { buttonId ->
                        assertEquals(View.VISIBLE, activity.findViewById<Button>(buttonId).visibility)
                    }

                val categories =
                    activity.findViewById<FlexboxLayout>(R.id.categoryContainer)
                assertEquals(5, categories.childCount)
                val selected = (0 until categories.childCount)
                    .map(categories::getChildAt)
                    .filter(View::isSelected)
                assertEquals(1, selected.size)
                val selectedLabels = selected.single().descendantTexts()
                assertTrue(selectedLabels.contains("식비"))
            }
        }
    }

    @Test
    fun invalidInputStaysOpenAndCloseButtonFinishesTheQuickEdit() {
        launchQuickEdit().use { scenario ->
            scenario.onActivity { activity ->
                activity.findViewById<EditText>(R.id.etMerchant).setText("")
                activity.findViewById<Button>(R.id.btnSave).performClick()
                assertFalse(activity.isFinishing)
                assertFalse(activity.isDestroyed)
            }

            scenario.onActivity { activity ->
                activity.findViewById<EditText>(R.id.etMerchant).setText("롯데쇼핑동탄")
                activity.findViewById<EditText>(R.id.etAmount).setText("0")
                activity.findViewById<Button>(R.id.btnSave).performClick()
                assertFalse(activity.isFinishing)
                assertFalse(activity.isDestroyed)
            }

            scenario.onActivity { activity ->
                activity.findViewById<ImageButton>(R.id.btnClose).performClick()
            }
            waitUntil("Quick Edit 닫기") {
                scenario.state == Lifecycle.State.DESTROYED
            }
        }
    }

    private fun launchQuickEdit(categoryId: String = "food"): ActivityScenario<QuickEditActivity> {
        val intent = Intent(context, QuickEditActivity::class.java).apply {
            putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, "expense-quick-edit-test")
            putExtra(QuickEditActivity.EXTRA_MERCHANT, "롯데쇼핑동탄")
            putExtra(QuickEditActivity.EXTRA_AMOUNT, 20_300)
            putExtra(QuickEditActivity.EXTRA_DATE, "2026-07-31")
            putExtra(QuickEditActivity.EXTRA_TIME, "17:40")
            putExtra(QuickEditActivity.EXTRA_CATEGORY, categoryId)
            putExtra(QuickEditActivity.EXTRA_MEMO, "테스트 메모")
            putExtra(QuickEditActivity.EXTRA_VERSION, 3)
        }
        return ActivityScenario.launch(intent)
    }

    private fun View.descendantTexts(): List<String> {
        val values = mutableListOf<String>()
        if (this is TextView) values += text.toString()
        if (this is android.view.ViewGroup) {
            for (index in 0 until childCount) {
                values += getChildAt(index).descendantTexts()
            }
        }
        return values
    }

    private fun waitUntil(
        description: String,
        timeoutMillis: Long = 5_000,
        condition: () -> Boolean
    ) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(50)
        }
        assertTrue("$description 상태가 제한 시간 안에 확인되지 않았습니다.", condition())
    }
}
