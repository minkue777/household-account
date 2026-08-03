package com.household.account

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.TextView
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
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
