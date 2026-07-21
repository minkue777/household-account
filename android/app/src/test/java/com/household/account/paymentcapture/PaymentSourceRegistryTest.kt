package com.household.account.paymentcapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PaymentSourceRegistryTest {
    @Test
    fun `등록 package만 source와 전용 parser를 선택한다`() {
        assertEquals(
            RegisteredNotificationSource.KB,
            PaymentSourceRegistry.resolve("com.kbcard.cxh.appcard")
        )
        assertEquals(
            RegisteredNotificationSource.SAMSUNG,
            PaymentSourceRegistry.resolve("com.samsung.android.spay")
        )
        assertNull(PaymentSourceRegistry.resolve("com.unknown.card"))
    }

    @Test
    fun `registry의 모든 package는 source 하나에만 대응한다`() {
        val packages = PaymentSourceRegistry.registeredPackages()
        assertEquals(packages.size, packages.distinct().size)
        packages.forEach { packageName ->
            requireNotNull(PaymentSourceRegistry.resolve(packageName))
        }
    }
}
