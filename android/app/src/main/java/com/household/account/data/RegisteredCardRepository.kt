package com.household.account.data

import com.google.firebase.firestore.FirebaseFirestore
import com.household.account.util.CardLabelFormatter
import kotlinx.coroutines.tasks.await

class RegisteredCardRepository {

    private val firestore = FirebaseFirestore.getInstance()
    private val cardsCollection = firestore.collection("registered_cards")

    suspend fun matchesRegisteredCard(
        householdId: String,
        owner: String,
        cardValue: String
    ): Boolean {
        if (householdId.isBlank() || owner.isBlank() || cardValue.isBlank()) {
            return false
        }

        val expenseCardLabel = normalizeCardLabel(CardLabelFormatter.extractCardLabel(cardValue))
            ?: return false
        val registeredCards = getRegisteredCards(householdId)

        if (registeredCards.isEmpty()) {
            return false
        }

        return registeredCards.any { card ->
            normalizeOwner(card.owner) == normalizeOwner(owner) &&
                normalizeCardLabel(card.cardLabel) == expenseCardLabel &&
                (
                    card.cardLastFour.isBlank() ||
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
