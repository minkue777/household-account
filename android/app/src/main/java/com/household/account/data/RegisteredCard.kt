package com.household.account.data

import com.google.firebase.firestore.DocumentId

data class RegisteredCard(
    @DocumentId
    val id: String = "",
    val householdId: String = "",
    val owner: String = "",
    val cardLabel: String = "",
    val cardLastFour: String = "",
    val isActive: Boolean = true
)
