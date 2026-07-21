package com.household.account.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** namespace별 별도 AndroidKeystore 키로 JSON snapshot 하나를 원자 암호화 저장합니다. */
class AndroidKeystoreEncryptedStore(
    context: Context,
    preferencesName: String,
    private val keyAlias: String
) {
    private val preferences = context.applicationContext.getSharedPreferences(
        preferencesName,
        Context.MODE_PRIVATE
    )

    fun read(): String? {
        val encrypted = preferences.getString(KEY_CIPHERTEXT, null) ?: return null
        return try {
            decrypt(encrypted)
        } catch (_: Exception) {
            // 키 무효화·복호화 실패 시 ciphertext와 키를 함께 폐기해 fail-closed 복구합니다.
            preferences.edit().remove(KEY_CIPHERTEXT).commit()
            runCatching {
                KeyStore.getInstance(KEYSTORE_PROVIDER).apply {
                    load(null)
                    deleteEntry(keyAlias)
                }
            }
            null
        }
    }

    fun write(plaintext: String) {
        check(preferences.edit().putString(KEY_CIPHERTEXT, encrypt(plaintext)).commit()) {
            "Encrypted store commit failed"
        }
    }

    fun clear() {
        check(preferences.edit().remove(KEY_CIPHERTEXT).commit()) {
            "Encrypted store clear failed"
        }
    }

    private fun encrypt(plaintext: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return listOf(cipher.iv, ciphertext)
            .joinToString(SEPARATOR) { Base64.encodeToString(it, Base64.NO_WRAP) }
    }

    private fun decrypt(value: String): String {
        val parts = value.split(SEPARATOR, limit = 2)
        require(parts.size == 2)
        val iv = Base64.decode(parts[0], Base64.NO_WRAP)
        val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }

        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER).run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            )
            generateKey()
        }
    }

    companion object {
        private const val KEY_CIPHERTEXT = "ciphertext"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val SEPARATOR = "."
    }
}
