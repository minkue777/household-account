package com.household.account.notifications

data class AndroidEndpointDeviceInfo(
    val model: String,
    val osVersion: String,
    val sdkVersion: String,
    val appVersion: String
)

/** Firebase callback와 서버 Command 사이의 공개 payload 계약입니다. */
object FidEndpointCommandPayloads {
    fun registration(
        fid: String,
        deviceInfo: AndroidEndpointDeviceInfo
    ): Map<String, Any?> {
        require(fid.isNotBlank())
        return mapOf(
            "fid" to fid,
            "platform" to "android",
            "deviceInfo" to mapOf(
                "model" to deviceInfo.model,
                "osVersion" to deviceInfo.osVersion,
                "sdkVersion" to deviceInfo.sdkVersion,
                "appVersion" to deviceInfo.appVersion
            )
        )
    }

    fun logout(fid: String): Map<String, Any?> {
        require(fid.isNotBlank())
        return mapOf("fid" to fid, "reason" to "logout")
    }

    fun sdkUnregistered(fid: String, expectedRegistrationVersion: Int): Map<String, Any?> {
        require(fid.isNotBlank())
        require(expectedRegistrationVersion > 0)
        return mapOf(
            "fid" to fid,
            "reason" to "sdk-unregistered",
            "expectedRegistrationVersion" to expectedRegistrationVersion
        )
    }
}
