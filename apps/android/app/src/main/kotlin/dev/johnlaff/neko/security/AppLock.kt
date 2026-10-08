package dev.johnlaff.neko.security

import android.annotation.SuppressLint
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.view.WindowManager
import androidx.core.content.edit

/**
 * The optional lock: the phone's own fingerprint, face or screen lock before Neko shows any
 * figure. A setting of this phone, like the reminders, so it is not saved to the account.
 */
object AppLock {
    private const val PREFS = "lock"
    private const val ON = "on"

    fun enabled(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(ON, false)

    fun setEnabled(context: Context, on: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putBoolean(ON, on) }
    }

    /** Why the lock can't be turned on here, or null when it can. */
    fun unavailable(context: Context): String? = when {
        // Android 9's prompt has no screen-lock fallback: a phone without biometrics would be stuck.
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q -> "Precisa do Android 10 ou mais novo"
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R -> {
            val result = context.getSystemService(BiometricManager::class.java).canAuthenticate(AUTHENTICATORS)
            if (result == BiometricManager.BIOMETRIC_SUCCESS) null else "Ative uma senha ou digital no Android"
        }
        context.getSystemService(KeyguardManager::class.java).isDeviceSecure -> null
        else -> "Ative uma senha ou digital no Android"
    }

    /** A strong biometric, or the screen lock when there is none or it fails. Read on Android 11+ only. */
    @SuppressLint("InlinedApi")
    private const val AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL

    /** Asks the phone to confirm it's the owner; [done] gets true only on success. */
    fun prompt(activity: Activity, title: String, done: (Boolean) -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return done(false)
        val builder = BiometricPrompt.Builder(activity).setTitle(title)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setAllowedAuthenticators(AUTHENTICATORS)
        } else {
            @Suppress("DEPRECATION")
            builder.setDeviceCredentialAllowed(true)
        }
        builder.build().authenticate(
            CancellationSignal(),
            activity.mainExecutor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = done(true)

                // Cancelled, too many tries or no lock set: the lock screen stays, with its button.
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = done(false)
            },
        )
    }

    /**
     * With the lock on, the Recents preview goes blank too, so the figures can't be read from the
     * app switcher. Android 13+ still lets the owner take screenshots; older phones can't tell the
     * two apart, so the window is marked secure.
     */
    fun guardWindow(activity: Activity, on: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.setRecentsScreenshotEnabled(!on)
        } else if (on) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
