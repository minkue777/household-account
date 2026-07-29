package com.household.account

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.replaceText
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.runners.AndroidJUnit4
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
    fun launchPaintsIntentSnapshotAndSelectedCategoryImmediately() {
        launchQuickEdit().use { scenario ->
            onView(withId(R.id.etMerchant)).check(matches(withText("롯데쇼핑동탄")))
            onView(withId(R.id.etAmount)).check(matches(withText("20300")))
            onView(withId(R.id.etMemo)).check(matches(withText("테스트 메모")))
            onView(withId(R.id.tvDateTime)).check(matches(withText("07/31 17:40")))
            onView(withText("저장")).check(matches(isDisplayed()))
            onView(withText("삭제")).check(matches(isDisplayed()))
            onView(withText("분리")).check(matches(isDisplayed()))
            onView(withText("알림 보내기")).check(matches(isDisplayed()))

            scenario.onActivity { activity ->
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
            onView(withId(R.id.etMerchant)).perform(replaceText(""))
            onView(withId(R.id.btnSave)).perform(click())
            scenario.onActivity { activity ->
                assertFalse(activity.isFinishing)
                assertFalse(activity.isDestroyed)
            }

            onView(withId(R.id.etMerchant)).perform(replaceText("롯데쇼핑동탄"))
            onView(withId(R.id.etAmount)).perform(replaceText("0"))
            onView(withId(R.id.btnSave)).perform(click())
            scenario.onActivity { activity ->
                assertFalse(activity.isFinishing)
                assertFalse(activity.isDestroyed)
            }

            onView(withId(R.id.btnClose)).perform(click())
            waitUntil("Quick Edit 닫기") {
                scenario.state == Lifecycle.State.DESTROYED
            }
        }
    }

    private fun launchQuickEdit(): ActivityScenario<QuickEditActivity> {
        val intent = Intent(context, QuickEditActivity::class.java).apply {
            putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, "expense-quick-edit-test")
            putExtra(QuickEditActivity.EXTRA_MERCHANT, "롯데쇼핑동탄")
            putExtra(QuickEditActivity.EXTRA_AMOUNT, 20_300)
            putExtra(QuickEditActivity.EXTRA_DATE, "2026-07-31")
            putExtra(QuickEditActivity.EXTRA_TIME, "17:40")
            putExtra(QuickEditActivity.EXTRA_CATEGORY, "FOOD")
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
