package dev.johnlaff.neko.data

import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * A private file whose text is sealed with AES-GCM under [key], so the session cookie and the
 * cached figures can't be read off a copied or rooted phone's storage. Files written before
 * sealing existed are read once as plain text and sealed on the next write. A file that no longer
 * opens (the key was lost, the bytes were changed) reads as empty: the app signs in again.
 */
class SealedFile(private val file: File, keyStore: Lazy<SecretKey?>) {
    /** Opened on the first read or write, off the main thread: Keystore calls can take a while. */
    private val key by keyStore

    fun read(): String? {
        if (!file.exists()) return null
        val bytes = runCatching { file.readBytes() }.getOrNull() ?: return null
        if (!bytes.startsWith(MAGIC)) return bytes.decodeToString()
        val k = key ?: return null
        return runCatching {
            val iv = bytes.copyOfRange(MAGIC.size, MAGIC.size + IV)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(TAG_BITS, iv))
            cipher.doFinal(bytes, MAGIC.size + IV, bytes.size - MAGIC.size - IV).decodeToString()
        }.getOrNull()
    }

    fun write(text: String) {
        val data = key?.let { k ->
            // The provider picks the IV: Android Keystore refuses caller-chosen ones.
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.ENCRYPT_MODE, k)
            MAGIC + cipher.iv + cipher.doFinal(text.encodeToByteArray())
        } ?: text.encodeToByteArray()
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeBytes(data)
        tmp.renameTo(file)
    }

    fun delete() {
        file.delete()
    }

    private fun ByteArray.startsWith(prefix: ByteArray) =
        size >= prefix.size && prefix.indices.all { this[it] == prefix[it] }

    companion object {
        private val MAGIC = "NK1".encodeToByteArray()
        private const val IV = 12
        private const val TAG_BITS = 128
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val ALIAS = "neko-local"

        /**
         * The app's key in Android Keystore: made on first use, never leaves the secure hardware.
         * Null where there is no Keystore (Robolectric), so files stay plain there.
         */
        fun keystoreKey(): SecretKey? = runCatching {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
                init(
                    android.security.keystore.KeyGenParameterSpec.Builder(
                        ALIAS,
                        android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                            android.security.keystore.KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build(),
                )
                generateKey()
            }
        }.getOrNull()
    }
}
