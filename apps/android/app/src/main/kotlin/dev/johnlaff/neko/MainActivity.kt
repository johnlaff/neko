package dev.johnlaff.neko

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.johnlaff.neko.ui.AppModel
import dev.johnlaff.neko.ui.HojeScreen
import dev.johnlaff.neko.ui.LocalLedger
import dev.johnlaff.neko.ui.LoginScreen
import dev.johnlaff.neko.ui.NekoTheme
import dev.johnlaff.neko.ui.Session

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NekoTheme {
                val session by model.session.collectAsStateWithLifecycle()
                val today by model.today.collectAsStateWithLifecycle()
                // Coming back to the app after a while reads the sheet again, like the site does.
                LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
                    if (session == Session.SignedIn) model.refresh()
                }
                Box(Modifier.fillMaxSize().background(LocalLedger.current.bg)) {
                    when (session) {
                        Session.Checking -> Unit
                        Session.SignedOut -> LoginScreen(onSignedIn = model::signedIn)
                        Session.SignedIn -> HojeScreen(today, model::refresh, model::logout)
                    }
                }
            }
        }
    }
}
