package com.household.account.webhost

import java.net.URI
import com.household.account.BuildConfig

object TrustedWebOrigin {
    const val ENVIRONMENT_VERSION = BuildConfig.WEB_ENVIRONMENT_VERSION
    const val APP_URL = BuildConfig.WEB_APP_URL
    private val configured = URI(APP_URL)
    val APP_ORIGIN: String = URI(configured.scheme, null, configured.host, configured.port, null, null, null).toString()

    fun contains(rawUrl: String?): Boolean {
        if (rawUrl.isNullOrBlank()) return false
        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return false
        return uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(configured.host, ignoreCase = true) &&
            (if (uri.port == -1) 443 else uri.port) == (if (configured.port == -1) 443 else configured.port) &&
            uri.userInfo == null
    }
}
