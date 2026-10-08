package dev.johnlaff.neko

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.CompositionLocalProvider
import dev.johnlaff.neko.ui.LocalRail
import dev.johnlaff.neko.ui.RAIL_FROM
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.compose.animation.AnimatedContent
import dev.johnlaff.neko.ui.tabChange
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.johnlaff.neko.ui.AjustesScreen
import dev.johnlaff.neko.reminders.Reminders
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import dev.johnlaff.neko.security.AppLock
import dev.johnlaff.neko.shortcuts.Launch
import dev.johnlaff.neko.shortcuts.launchFor
import dev.johnlaff.neko.ui.AppModel
import dev.johnlaff.neko.ui.AppModelFactory
import dev.johnlaff.neko.ui.Dock
import dev.johnlaff.neko.ui.FaturasScreen
import dev.johnlaff.neko.ui.HojeScreen
import dev.johnlaff.neko.ui.LocalLedger
import dev.johnlaff.neko.ui.LockScreen
import dev.johnlaff.neko.ui.LockSwitch
import dev.johnlaff.neko.ui.LoginScreen
import dev.johnlaff.neko.ui.MesScreen
import dev.johnlaff.neko.ui.NekoTheme
import dev.johnlaff.neko.ui.BanksList
import dev.johnlaff.neko.ui.DevicesList
import dev.johnlaff.neko.ui.RemindersSwitch
import dev.johnlaff.neko.ui.Session
import dev.johnlaff.neko.ui.Tab

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels { AppModelFactory }
    private val clock get() = (application as NekoApp).lock
    /** The app lock is waiting: nothing but the lock screen is drawn. */
    private var locked by mutableStateOf(false)
    private var lockOn by mutableStateOf(false)
    /** A shortcut asked for this place; taken once. */
    private var request by mutableStateOf<Launch?>(null)
    /** Bumped by each "Simular" shortcut, so a second tap opens the simulator again. */
    private var simulateAsk by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        // The system splash stays until the session is known, instead of a blank page.
        installSplashScreen().setKeepOnScreenCondition { model.session.value == Session.Checking }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handle(intent)
        lockOn = AppLock.enabled(this)
        AppLock.guardWindow(this, lockOn)
        setContent {
            NekoTheme {
                val session by model.session.collectAsStateWithLifecycle()
                var tab by rememberSaveable { mutableStateOf(Tab.Hoje) }
                val go = { t: Tab ->
                    tab = t
                    model.refresh(t)
                }
                LaunchedEffect(request, session) {
                    val r = request ?: return@LaunchedEffect
                    if (session != Session.SignedIn) return@LaunchedEffect
                    go(r.tab)
                    if (r.simulate) simulateAsk++
                    request = null
                }
                // Signing out from Ajustes and back in lands on Hoje, which is read on sign-in.
                LaunchedEffect(session) { if (session == Session.SignedOut) tab = Tab.Hoje }
                // Coming back to the app after a while reads the sheet again, like the site does.
                LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
                    if (session == Session.SignedIn) model.refresh(tab)
                }
                // Back from another place returns to Hoje before leaving the app.
                BackHandler(enabled = session == Session.SignedIn && tab != Tab.Hoje) { go(Tab.Hoje) }
                BoxWithConstraints(Modifier.fillMaxSize().background(LocalLedger.current.bg)) {
                    val rail = maxWidth >= RAIL_FROM
                    when (session) {
                        Session.Checking -> Unit
                        Session.SignedOut -> LoginScreen(onSignedIn = model::signedIn)
                        Session.SignedIn if locked -> {
                            // Asks as soon as the lock shows; cancelling leaves the button to try again.
                            LaunchedEffect(Unit) { unlock() }
                            LockScreen(::unlock)
                        }
                        Session.SignedIn -> CompositionLocalProvider(LocalRail provides rail) {
                            // The screen slides a little toward the tab's side of the dock, as on the
                            // site; the dock stays put.
                            val shift = with(LocalDensity.current) { 24.dp.roundToPx() }
                            // Each tab keeps its scroll, picked month and open panels while away.
                            val saved = androidx.compose.runtime.saveable.rememberSaveableStateHolder()
                            AnimatedContent(tab, transitionSpec = { tabChange(initialState, targetState, shift) }, label = "tab") { t ->
                                saved.SaveableStateProvider(t.name) {
                                when (t) {
                                    Tab.Hoje -> {
                                        val today by model.today.collectAsStateWithLifecycle()
                                        val mia by model.mia.collectAsStateWithLifecycle()
                                        HojeScreen(
                                            today, model::refresh, { go(Tab.Ajustes) }, model::simulate,
                                            simulateAsk = simulateAsk,
                                            mia = mia,
                                            askMia = model::askMia,
                                            onScreen = { tela ->
                                                go(when (tela) { "faturas" -> Tab.Faturas; "mes" -> Tab.Mes; else -> Tab.Hoje })
                                            },
                                        )
                                    }
                                    Tab.Faturas -> {
                                        val invoices by model.invoices.collectAsStateWithLifecycle()
                                        FaturasScreen(invoices, { model.refresh(Tab.Faturas) }) { go(Tab.Ajustes) }
                                    }
                                    Tab.Mes -> {
                                        val months by model.months.collectAsStateWithLifecycle()
                                        val history by model.history.collectAsStateWithLifecycle()
                                        MesScreen(months, history) { model.refresh(Tab.Mes) }
                                    }
                                    Tab.Ajustes -> {
                                        val ajustes by model.ajustes.collectAsStateWithLifecycle()
                                        val save by model.save.collectAsStateWithLifecycle()
                                        val devices by model.devices.collectAsStateWithLifecycle()
                                        val banks by model.banks.collectAsStateWithLifecycle()
                                        AjustesScreen(
                                            ajustes, save, { model.refresh(Tab.Ajustes) }, model::saveSettings, model::logout,
                                            remindersSwitch(),
                                            DevicesList(devices, model::endSession, model::endOtherSessions),
                                            lockSwitch(),
                                            BanksList(banks, model::saveBanks, model::saveBankCards),
                                        )
                                    }
                                }
                                }
                            }
                            Dock(tab, go, Modifier.align(if (rail) Alignment.CenterStart else Alignment.BottomCenter))
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        launchFor(intent?.action)?.let { request = it }
    }

    override fun onStart() {
        super.onStart()
        locked = clock.locked(SystemClock.elapsedRealtime(), lockOn)
    }

    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations) clock.left(SystemClock.elapsedRealtime())
    }

    private fun unlock() {
        AppLock.prompt(this, "Desbloquear o Neko") { ok ->
            if (ok) {
                clock.unlock()
                locked = false
            }
        }
    }

    /** Ajustes' lock switch: turning it on asks first, so nobody locks themselves out. */
    private fun lockSwitch() = LockSwitch(lockOn, AppLock.unavailable(this)) { want ->
        if (!want) {
            setLock(false)
        } else {
            AppLock.prompt(this, "Bloquear o Neko") { ok ->
                if (ok) {
                    clock.unlock()
                    setLock(true)
                }
            }
        }
    }

    private fun setLock(on: Boolean) {
        lockOn = on
        AppLock.setEnabled(this, on)
        AppLock.guardWindow(this, on)
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
