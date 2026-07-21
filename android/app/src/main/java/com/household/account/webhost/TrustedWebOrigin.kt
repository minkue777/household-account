package com.household.account.webhost

import java.net.URI

object TrustedWebOrigin {
    const val APP_ORIGIN = "https://household-account-app-demo-v1.vercel.app"
    const val APP_URL = "$APP_ORIGIN/"

    fun contains(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals("household-account-app-demo-v1.vercel.app", ignoreCase = true) &&
            (uri.port == -1 || uri.port == 443) &&
            uri.userInfo == null
    }
}
