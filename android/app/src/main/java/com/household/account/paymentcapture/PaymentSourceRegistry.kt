package com.household.account.paymentcapture

enum class RegisteredNotificationSource {
    KB,
    NH,
    NAVER_PAY,
    TOSS_BANK,
    KAKAOPAY,
    DIGITAL_ONNURI,
    PAYBOOC_ISP,
    SMS,
    SAMSUNG,
    LOTTE,
    GYEONGGI_LOCAL_CURRENCY,
    DAEJEON_LOCAL_CURRENCY,
    SEJONG_LOCAL_CURRENCY,
    CITY_GAS_BILL
}

/** 본문이 아니라 등록 package만으로 parser 하나를 선택하는 Source Registry입니다. */
object PaymentSourceRegistry {
    private val sourcesByPackage = mapOf(
        "com.kbcard.cxh.appcard" to RegisteredNotificationSource.KB,
        "com.kbcard.kbkookmincard" to RegisteredNotificationSource.KB,
        "nh.smart.nhallonepay" to RegisteredNotificationSource.NH,
        "com.naverfin.payapp" to RegisteredNotificationSource.NAVER_PAY,
        "viva.republica.toss" to RegisteredNotificationSource.TOSS_BANK,
        "com.kakaopay.app" to RegisteredNotificationSource.KAKAOPAY,
        "com.komsco.kpay" to RegisteredNotificationSource.DIGITAL_ONNURI,
        "kvp.jjy.MispAndroid320" to RegisteredNotificationSource.PAYBOOC_ISP,
        "com.google.android.apps.messaging" to RegisteredNotificationSource.SMS,
        "com.samsung.android.messaging" to RegisteredNotificationSource.SMS,
        "com.android.mms" to RegisteredNotificationSource.SMS,
        "com.samsung.android.spay" to RegisteredNotificationSource.SAMSUNG,
        "kr.co.samsungcard.mpocket" to RegisteredNotificationSource.SAMSUNG,
        "com.lcacApp" to RegisteredNotificationSource.LOTTE,
        "com.mobiletoong.gpay" to RegisteredNotificationSource.GYEONGGI_LOCAL_CURRENCY,
        "com.coocon.chakwallet" to RegisteredNotificationSource.GYEONGGI_LOCAL_CURRENCY,
        "gov.gyeonggi.ggcard" to RegisteredNotificationSource.GYEONGGI_LOCAL_CURRENCY,
        "kr.co.nmcs.daejeonpay" to RegisteredNotificationSource.DAEJEON_LOCAL_CURRENCY,
        "gov.sejong.yeominpay" to RegisteredNotificationSource.SEJONG_LOCAL_CURRENCY,
        "com.kakao.talk" to RegisteredNotificationSource.CITY_GAS_BILL
    )

    fun resolve(packageName: String): RegisteredNotificationSource? = sourcesByPackage[packageName]

    fun registeredPackages(): Set<String> = sourcesByPackage.keys
}
