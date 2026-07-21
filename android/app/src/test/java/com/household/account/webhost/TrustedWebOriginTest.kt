package com.household.account.webhost

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustedWebOriginTest {
    @Test
    fun `배포 origin의 https 문서만 native host 범위에 포함한다`() {
        assertTrue(TrustedWebOrigin.contains(TrustedWebOrigin.APP_URL))
        assertTrue(TrustedWebOrigin.contains("${TrustedWebOrigin.APP_ORIGIN}/settings?tab=app"))
        assertFalse(TrustedWebOrigin.contains("http://household-account-app-demo-v1.vercel.app/"))
        assertFalse(TrustedWebOrigin.contains("https://household-account-app-demo-v1.vercel.app.evil.test/"))
        assertFalse(TrustedWebOrigin.contains("https://evil.test/?next=${TrustedWebOrigin.APP_ORIGIN}"))
    }
}
