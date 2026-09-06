package com.household.account.util

import android.content.Context
import com.household.account.paymentcapture.AndroidCaptureDelivery
import com.household.account.paymentcapture.CaptureSessionScope
import com.household.account.session.AndroidSessionMirrorStore
import com.household.account.session.SessionMirror
import com.household.account.session.SessionMirrorSnapshot
import java.security.MessageDigest

/** Identity is stored only in the encrypted, versioned SessionMirror. */
object HouseholdPreferences {
    private const val PREF_NAME = "household_prefs"
    private const val OVERLAY_PREFIX = "quickEditOverlayEnabled"
    @Volatile private var mirrorInstance: SessionMirror? = null

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    private fun mirror(context: Context): SessionMirror = mirrorInstance ?: synchronized(this) {
        mirrorInstance ?: SessionMirror(AndroidSessionMirrorStore(context.applicationContext)).also {
            // Native legacy identity is not authority and cannot remain in plaintext.
            check(prefs(context).edit().remove("householdKey").remove("memberId")
                .remove("memberName").remove("partnerName").remove("sessionGeneration").commit())
            mirrorInstance = it
        }
    }

    fun snapshot(context: Context): SessionMirrorSnapshot? = mirror(context).snapshot()
    fun currentScope(context: Context): CaptureSessionScope {
        val current = snapshot(context)
        return CaptureSessionScope(current?.householdId.orEmpty(), current?.memberId.orEmpty(), current?.generation ?: 0L)
    }
    fun getHouseholdKey(context: Context): String = snapshot(context)?.householdId.orEmpty()
    fun getMemberId(context: Context): String = snapshot(context)?.memberId.orEmpty()
    fun getMemberName(context: Context): String = snapshot(context)?.memberName.orEmpty()
    fun getPartnerName(context: Context): String = ""
    fun getSessionGeneration(context: Context): Long = mirror(context).generation()
    fun hasHouseholdKey(context: Context): Boolean = snapshot(context) != null

    suspend fun replaceAuthenticatedSession(context: Context, householdId: String, memberId: String, memberName: String): Long {
        val next = mirror(context).replace(householdId, memberId, memberName) { previous ->
            AndroidCaptureDelivery.purgeForSessionTransition(context.applicationContext, previous?.toScope())
        }
        migrateOverlay(context, next)
        return next.generation
    }

    suspend fun clearHouseholdKey(context: Context) {
        mirror(context).clear { previous ->
            AndroidCaptureDelivery.purgeForSessionTransition(context.applicationContext, previous?.toScope())
        }
    }

    private fun SessionMirrorSnapshot.toScope() = CaptureSessionScope(householdId, memberId, generation)

    fun isQuickEditOverlayEnabled(context: Context): Boolean {
        val current = snapshot(context) ?: return true
        return isQuickEditOverlayEnabled(context, current.householdId, current.memberId)
    }
    fun isQuickEditOverlayEnabled(context: Context, householdId: String, memberId: String): Boolean {
        val key = overlayKey(householdId, memberId) ?: return true
        return prefs(context).getBoolean(key, true)
    }
    fun setQuickEditOverlayEnabled(context: Context, householdId: String, memberId: String, enabled: Boolean) {
        val key = overlayKey(householdId, memberId) ?: return
        check(prefs(context).edit().putBoolean(key, enabled).commit())
    }
    private fun migrateOverlay(context: Context, snapshot: SessionMirrorSnapshot) {
        val preferences = prefs(context)
        val key = overlayKey(snapshot.householdId, snapshot.memberId) ?: return
        val previousId = "${OVERLAY_PREFIX}_${snapshot.householdId}_${snapshot.memberId}"
        val previousName = "${OVERLAY_PREFIX}_${snapshot.householdId}_${snapshot.memberName}"
        if (!preferences.contains(previousId) && !preferences.contains(previousName)) return
        val enabled = when {
            preferences.contains(key) -> preferences.getBoolean(key, true)
            preferences.contains(previousId) -> preferences.getBoolean(previousId, true)
            else -> preferences.getBoolean(previousName, true)
        }
        check(preferences.edit().putBoolean(key, enabled).remove(previousId).remove(previousName).commit())
    }
    private fun overlayKey(householdId: String, memberId: String): String? {
        if (householdId.isBlank() || memberId.isBlank()) return null
        val digest = MessageDigest.getInstance("SHA-256")
            .digest("$householdId\u0000$memberId".toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
        return "${OVERLAY_PREFIX}_v2_$digest"
    }
}
