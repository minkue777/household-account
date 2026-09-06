package com.household.account.webhost

import android.content.ComponentName

internal object NotificationListenerAccess {
    fun isEnabled(flat: String?, expected: ComponentName): Boolean =
        flat?.split(':')?.any { ComponentName.unflattenFromString(it) == expected } == true
}
