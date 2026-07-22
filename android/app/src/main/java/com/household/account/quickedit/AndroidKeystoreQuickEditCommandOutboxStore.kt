package com.household.account.quickedit

import android.content.Context
import com.household.account.security.AndroidKeystoreEncryptedStore

/** QuickEdit command payload 전체를 AndroidKeystore AES-256-GCM snapshot으로 원자 저장합니다. */
class AndroidKeystoreQuickEditCommandOutboxStore(
    context: Context
) : QuickEditCommandOutboxStore {
    private val diagnostics = context.applicationContext.getSharedPreferences(
        DIAGNOSTICS_PREFERENCES_NAME,
        Context.MODE_PRIVATE
    )
    private val encryptedStore = AndroidKeystoreEncryptedStore(
        context = context,
        preferencesName = PREFERENCES_NAME,
        keyAlias = KEY_ALIAS
    )

    override fun load(): List<QuickEditCommandOutboxEntry> {
        val hadEncryptedPayload = encryptedStore.containsValue()
        val plaintext = encryptedStore.read()
        if (plaintext == null) {
            if (hadEncryptedPayload) markUnrecoverableLoss()
            return emptyList()
        }
        return runCatching { QuickEditCommandOutboxJsonCodec.decode(plaintext) }
            .getOrElse {
                encryptedStore.clear()
                markUnrecoverableLoss()
                emptyList()
            }
    }

    override fun replace(entries: List<QuickEditCommandOutboxEntry>) {
        if (entries.isEmpty()) {
            encryptedStore.clear()
        } else {
            encryptedStore.write(QuickEditCommandOutboxJsonCodec.encode(entries))
        }
    }

    override fun clear() {
        encryptedStore.clear()
        acknowledgeUnrecoverableLossNotification()
    }

    override fun hasUnrecoverableLossNotificationPending(): Boolean =
        diagnostics.getBoolean(KEY_UNRECOVERABLE_LOSS_PENDING, false)

    override fun acknowledgeUnrecoverableLossNotification() {
        check(
            diagnostics.edit().remove(KEY_UNRECOVERABLE_LOSS_PENDING).commit()
        ) { "QuickEdit outbox diagnostic clear failed" }
    }

    private fun markUnrecoverableLoss() {
        check(
            diagnostics.edit().putBoolean(KEY_UNRECOVERABLE_LOSS_PENDING, true).commit()
        ) { "QuickEdit outbox diagnostic commit failed" }
    }

    companion object {
        private const val PREFERENCES_NAME = "quick_edit_command_outbox.v1"
        private const val DIAGNOSTICS_PREFERENCES_NAME =
            "quick_edit_command_outbox.diagnostics.v1"
        private const val KEY_UNRECOVERABLE_LOSS_PENDING = "unrecoverableLossPending"
        private const val KEY_ALIAS = "household.quickedit.command.outbox.aes256gcm.v1"
    }
}
