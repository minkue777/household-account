package com.household.account.paymentcapture

enum class RegisteredNotificationSource(
    val sourceType: String,
    val parserId: String,
    val parserVersion: String,
    val companyLabel: String,
    val localCurrencyType: String? = null
) {
    KB("kb-card", "kb-card-parser", "2.0.0", "국민"),
    NH("nh-card", "nh-pay-parser", "1.0.0", "농협"),
    NAVER_PAY("naver-pay", "naver-pay-parser", "1.0.0", "네이버페이"),
    TOSS_BANK("toss-bank", "toss-bank-parser", "1.0.0", "토스뱅크"),
    KAKAOPAY("kakao-pay", "kakao-pay-parser", "1.0.0", "카카오페이"),
    DIGITAL_ONNURI("digital-onnuri", "digital-onnuri-parser", "1.0.0", "디지털온누리"),
    PAYBOOC_ISP("paybooc-isp", "paybooc-isp-parser", "1.0.0", "BC"),
    SMS("sms-card-message", "sms-card-message-parser", "1.0.0", "카드"),
    SAMSUNG("samsung-card", "samsung-card-parser", "1.0.0", "삼성"),
    LOTTE("lotte-card", "lotte-card-parser", "1.0.0", "롯데"),
    GYEONGGI_LOCAL_CURRENCY(
        "gyeonggi-local-currency",
        "gyeonggi-local-currency-parser",
        "1.0.0",
        "경기지역화폐",
        "gyeonggi"
    ),
    DAEJEON_LOCAL_CURRENCY(
        "daejeon-local-currency",
        "daejeon-local-currency-parser",
        "1.0.0",
        "대전사랑카드",
        "daejeon"
    ),
    SEJONG_LOCAL_CURRENCY(
        "sejong-local-currency",
        "sejong-local-currency-parser",
        "1.0.0",
        "세종지역화폐",
        "sejong"
    ),
    CITY_GAS_BILL("city-gas-bill", "city-gas-bill-parser", "1.0.0", "도시가스")
}

/** 본문이 아니라 등록 package만으로 parser 하나를 선택하는 Source Registry입니다. */
object PaymentSourceRegistry {
    const val VERSION = "source-registry.v1"

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
