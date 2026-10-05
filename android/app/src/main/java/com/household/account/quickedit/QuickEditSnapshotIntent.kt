package com.household.account.quickedit

import android.content.Intent
import com.household.account.QuickEditActivity
import com.household.account.ledger.LedgerTransactionSnapshot

/** 기존 Intent 필드와 누락값 호환은 이 Android 전달 경계에서만 처리합니다. */
internal fun Intent.putQuickEditSnapshot(snapshot: LedgerTransactionSnapshot) = apply {
    putExtra(QuickEditActivity.EXTRA_EXPENSE_ID, snapshot.transactionId)
    putExtra(QuickEditActivity.EXTRA_VERSION, snapshot.aggregateVersion)
    putExtra(QuickEditActivity.EXTRA_MERCHANT, snapshot.merchant)
    putExtra(QuickEditActivity.EXTRA_AMOUNT, snapshot.amountInWon)
    putExtra(QuickEditActivity.EXTRA_DATE, snapshot.accountingDate)
    putExtra(QuickEditActivity.EXTRA_TIME, snapshot.localTime)
    putExtra(QuickEditActivity.EXTRA_CATEGORY, snapshot.categoryId)
    putExtra(QuickEditActivity.EXTRA_MEMO, snapshot.memo)
    putStringArrayListExtra(QuickEditActivity.EXTRA_TAGS, ArrayList(snapshot.tags))
}

internal fun Intent.readQuickEditSnapshot() = LedgerTransactionSnapshot(
    transactionId = getStringExtra(QuickEditActivity.EXTRA_EXPENSE_ID).orEmpty(),
    aggregateVersion = getIntExtra(QuickEditActivity.EXTRA_VERSION, 1).coerceAtLeast(1),
    lifecycleState = "active",
    transactionType = "expense",
    merchant = getStringExtra(QuickEditActivity.EXTRA_MERCHANT).orEmpty(),
    amountInWon = getIntExtra(QuickEditActivity.EXTRA_AMOUNT, 0),
    accountingDate = getStringExtra(QuickEditActivity.EXTRA_DATE).orEmpty(),
    localTime = getStringExtra(QuickEditActivity.EXTRA_TIME).orEmpty(),
    categoryId = getStringExtra(QuickEditActivity.EXTRA_CATEGORY) ?: "etc",
    memo = getStringExtra(QuickEditActivity.EXTRA_MEMO).orEmpty(),
    tags = normalizeQuickEditTags(getStringArrayListExtra(QuickEditActivity.EXTRA_TAGS).orEmpty())
)
