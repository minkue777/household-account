package com.household.account.data

import com.google.firebase.firestore.FirebaseFirestore
import com.household.account.util.CardLabelFormatter
import kotlinx.coroutines.tasks.await

class RegisteredCardRepository {

    private val firestore = FirebaseFirestore.getInstance()
    private val cardsCollection = firestore.collection("registered_cards")
    private val labelOnlyNotificationLabels = setOf("여민전")

    suspend fun matchesRegisteredCard(
        householdId: String,
        owner: String,
        cardValue: String
    ): Boolean {
        return findMatchedRegisteredCard(
            householdId = householdId,
            owner = owner,
            cardValue = cardValue
        ) != null
    }

    suspend fun findMatchedRegisteredCard(
        householdId: String,
        owner: String,
        cardValue: String
    ): RegisteredCard? {
        if (householdId.isBlank() || owner.isBlank() || cardValue.isBlank()) {
            return null
        }

        val expenseCardLabel = normalizeCardLabel(CardLabelFormatter.extractCardLabel(cardValue))
            ?: return null
        val registeredCards = getRegisteredCards(householdId)

        if (registeredCards.isEmpty()) {
            return null
        }

        return registeredCards.firstOrNull { card ->
            val registeredCardLabel = normalizeCardLabel(card.cardLabel)
            val expenseCardToken = CardLabelFormatter.extractCardToken(cardValue)

            normalizeOwner(card.owner) == normalizeOwner(owner) &&
                registeredCardLabel == expenseCardLabel &&
                (
                    card.cardLastFour.isBlank() ||
                        (
                            expenseCardToken == null &&
                                labelOnlyNotificationLabels.any { label ->
                                    normalizeCardLabel(label) == registeredCardLabel
                                }
                            ) ||
                        CardLabelFormatter.matchesCardToken(card.cardLastFour, cardValue)
                )
        }
    }

    private suspend fun getRegisteredCards(householdId: String): List<RegisteredCard> {
        return try {
            val snapshot = cardsCollection
                .whereEqualTo("householdId", householdId)
                .get()
                .await()

            snapshot.documents.mapNotNull { doc ->
                doc.toObject(RegisteredCard::class.java)?.copy(id = doc.id)
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun normalizeOwner(value: String): String {
        return value.trim()
    }

    private fun normalizeCardLabel(value: String?): String? {
        val normalized = value?.trim()?.lowercase()
        return normalized?.takeIf { it.isNotBlank() }
    }
}
