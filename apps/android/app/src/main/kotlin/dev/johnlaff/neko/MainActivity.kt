package dev.johnlaff.neko

import android.Manifest
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.johnlaff.neko.ui.AjustesScreen
import dev.johnlaff.neko.reminders.Reminders
import dev.johnlaff.neko.ui.AppModel
import dev.johnlaff.neko.ui.Dock
import dev.johnlaff.neko.ui.FaturasScreen
import dev.johnlaff.neko.ui.HojeScreen
import dev.johnlaff.neko.ui.LocalLedger
import dev.johnlaff.neko.ui.LoginScreen
import dev.johnlaff.neko.ui.MesScreen
import dev.johnlaff.neko.ui.NekoTheme
import dev.johnlaff.neko.ui.RemindersSwitch
import dev.johnlaff.neko.ui.Session
import dev.johnlaff.neko.ui.Tab

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            NekoTheme {
                val session by model.session.collectAsStateWithLifecycle()
                var tab by rememberSaveable { mutableStateOf(Tab.Hoje) }
                val go = { t: Tab ->
                    tab = t
                    model.refresh(t)
                }
                // Signing out from Ajustes and back in lands on Hoje, which is read on sign-in.
                LaunchedEffect(session) { if (session == Session.SignedOut) tab = Tab.Hoje }
                // Coming back to the app after a while reads the sheet again, like the site does.
                LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
                    if (session == Session.SignedIn) model.refresh(tab)
                }
                // Back from another place returns to Hoje before leaving the app.
                BackHandler(enabled = session == Session.SignedIn && tab != Tab.Hoje) { go(Tab.Hoje) }
                Box(Modifier.fillMaxSize().background(LocalLedger.current.bg)) {
                    when (session) {
                        Session.Checking -> Unit
                        Session.SignedOut -> LoginScreen(onSignedIn = model::signedIn)
                        Session.SignedIn -> {
                            when (tab) {
                                Tab.Hoje -> {
                                    val today by model.today.collectAsStateWithLifecycle()
                                    HojeScreen(today, model::refresh) { go(Tab.Ajustes) }
                                }
                                Tab.Faturas -> {
                                    val invoices by model.invoices.collectAsStateWithLifecycle()
                                    FaturasScreen(invoices, { model.refresh(Tab.Faturas) }) { go(Tab.Ajustes) }
                                }
                                Tab.Mes -> {
                                    val months by model.months.collectAsStateWithLifecycle()
                                    MesScreen(months) { model.refresh(Tab.Mes) }
                                }
                                Tab.Ajustes -> {
                                    val ajustes by model.ajustes.collectAsStateWithLifecycle()
                                    val save by model.save.collectAsStateWithLifecycle()
                                    AjustesScreen(
                                        ajustes, save, { model.refresh(Tab.Ajustes) }, model::saveSettings, model::logout,
                                        remindersSwitch(),
                                    )
                                }
                            }
                            Dock(tab, go, Modifier.align(Alignment.BottomCenter))
                        }
                    }
                }
            }
        }
    }

    /** Ajustes' reminders switch: asks Android for notifications the first time it is turned on. */
    @Composable
    private fun remindersSwitch(): RemindersSwitch {
        var on by remember { mutableStateOf(Reminders.enabled(this) && Reminders.permitted(this)) }
        var blocked by remember { mutableStateOf(false) }
        val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            blocked = !granted
            on = granted
            Reminders.setEnabled(this, granted)
        }
        return RemindersSwitch(on, blocked) { want ->
            // Below Android 13 there is nothing to ask: permitted() is already true.
            if (want && !Reminders.permitted(this)) {
                ask.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else {
                blocked = false
                on = want
                Reminders.setEnabled(this, want)
            }
        }
    }
}
