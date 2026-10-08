package dev.johnlaff.neko.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.Device
import dev.johnlaff.neko.data.HistoryView
import dev.johnlaff.neko.data.InstallmentSimulation
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.UserSettings
import dev.johnlaff.neko.widget.WidgetRefresh
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface Session {
    data object Checking : Session
    data object SignedOut : Session
    data object SignedIn : Session
}

/** Why the last read failed, in the terms the screen speaks to. */
enum class ReadError { Offline, SheetStructure, Other }

/** One screen's last read, whether a new one is on the way and why the last one failed. */
data class ScreenState<T>(
    val view: T? = null,
    val loading: Boolean = false,
    val error: ReadError? = null,
    /** The sheet's message when its structure changed. */
    val detail: String? = null,
)

typealias TodayState = ScreenState<TodayView>

/** How the Ajustes autosave went, for the chip next to the title. */
enum class SaveState { Idle, Saving, Saved, Failed }

class AppModel(app: Application) : AndroidViewModel(app) {
    private val neko = app as NekoApp
    private val _session = MutableStateFlow<Session>(Session.Checking)
    val session: StateFlow<Session> = _session
    private val _today = MutableStateFlow(TodayState(view = neko.today.cached()))
    val today: StateFlow<TodayState> = _today
    private val _invoices = MutableStateFlow(ScreenState<InvoicesView>())
    val invoices: StateFlow<ScreenState<InvoicesView>> = _invoices
    private val _months = MutableStateFlow(ScreenState<MonthsView>())
    val months: StateFlow<ScreenState<MonthsView>> = _months
    private val _ajustes = MutableStateFlow(ScreenState<AjustesView>())
    val ajustes: StateFlow<ScreenState<AjustesView>> = _ajustes
    /** How this month's end moved since its first reading, under Mês's figure; null until read. */
    private val _history = MutableStateFlow<HistoryView?>(null)
    val history: StateFlow<HistoryView?> = _history
    /** Devices signed in, for Ajustes; null until read. */
    private val _devices = MutableStateFlow<List<Device>?>(null)
    val devices: StateFlow<List<Device>?> = _devices
    private val _save = MutableStateFlow(SaveState.Idle)
    val save: StateFlow<SaveState> = _save

    init {
        viewModelScope.launch {
            // A cached Hoje means this phone signed in before: show it while the session is checked.
            if (_today.value.view != null) _session.value = Session.SignedIn
            val signedIn = runCatching { neko.api.me().email != null }
            _session.value = when {
                signedIn.getOrNull() == true -> Session.SignedIn
                // Offline: keep what was shown; the next refresh will tell.
                signedIn.isFailure && _today.value.view != null -> Session.SignedIn
                else -> Session.SignedOut
            }
            if (_session.value == Session.SignedIn) refresh()
        }
    }

    fun refresh() = load(_today, { neko.today.refresh() }) { WidgetRefresh.redraw(getApplication()) }

    /** Reads the screen on show; what was read before stays on screen until the new read lands. */
    fun refresh(tab: Tab) = when (tab) {
        Tab.Hoje -> refresh()
        Tab.Faturas -> load(_invoices, { neko.api.invoices() })
        Tab.Mes -> {
            load(_months, { neko.api.months() })
            side { _history.value = neko.api.history() }
        }
        Tab.Ajustes -> {
            load(_ajustes, { neko.api.ajustes() })
            readDevices()
        }
    }

    /** A read that only adds to a screen: when it fails, the screen just goes without it. */
    private fun side(read: suspend () -> Unit) {
        viewModelScope.launch {
            runCatching { read() }.onFailure { e ->
                if (e is ApiException && e.status == 401) signedOut()
            }
        }
    }

    private fun readDevices() = side { _devices.value = neko.api.sessions() }

    fun endSession(id: String) = side {
        neko.api.endSession(id)
        _devices.value = neko.api.sessions()
    }

    fun endOtherSessions() = side {
        neko.api.endOtherSessions()
        _devices.value = neko.api.sessions()
    }

    /** Hoje's simulator; the Worker does the math, as for every other figure. */
    suspend fun simulate(amount: Long, count: Int): InstallmentSimulation? = neko.api.simulate(amount, count)

    private fun <T> load(
        state: MutableStateFlow<ScreenState<T>>,
        read: suspend () -> T,
        done: (T) -> Unit = {},
    ) {
        if (state.value.loading) return
        state.update { it.copy(loading = true) }
        viewModelScope.launch {
            val result = runCatching { read() }
            result.onSuccess { v ->
                state.value = ScreenState(view = v)
                done(v)
            }
            result.onFailure { e ->
                if (e is ApiException && e.status == 401) {
                    signedOut()
                    return@onFailure
                }
                state.update { it.copy(loading = false, error = readError(e), detail = (e as? ApiException)?.message) }
            }
        }
    }

    private var saved: UserSettings? = null
    private var saving: kotlinx.coroutines.Job? = null

    /**
     * Saves Ajustes whole, as the site does; the same settings twice in a row send nothing. The
     * latest call wins: a save still on its way is cancelled by a newer one.
     */
    fun saveSettings(settings: UserSettings) {
        if (settings == (saved ?: _ajustes.value.view?.settings)) return
        saved = settings
        saving?.cancel()
        _save.value = SaveState.Saving
        saving = viewModelScope.launch {
            val result = runCatching { neko.api.saveSettings(settings) }
            result.onSuccess { s ->
                _ajustes.update { st -> st.copy(view = st.view?.copy(settings = s)) }
                _save.value = SaveState.Saved
                // Settings change Hoje (pace, diário): read it again so the widget follows.
                refresh()
            }
            result.onFailure { e ->
                if (e is kotlinx.coroutines.CancellationException) throw e
                saved = null
                if (e is ApiException && e.status == 401) signedOut() else _save.value = SaveState.Failed
            }
        }
    }

    fun signedIn() {
        _session.value = Session.SignedIn
        refresh()
    }

    fun logout() {
        viewModelScope.launch {
            neko.api.logout()
            signedOut()
        }
    }

    private fun signedOut() {
        neko.today.clear()
        neko.cookies.clear()
        _today.value = TodayState()
        _invoices.value = ScreenState()
        _months.value = ScreenState()
        _ajustes.value = ScreenState()
        _history.value = null
        _devices.value = null
        _save.value = SaveState.Idle
        saved = null
        _session.value = Session.SignedOut
        WidgetRefresh.redraw(getApplication())
    }
}

private fun readError(e: Throwable) = when {
    e is ApiException && e.code == "sheet-structure" -> ReadError.SheetStructure
    e is ApiException -> ReadError.Other
    else -> ReadError.Offline
}

/** The app's four places, in dock order. */
enum class Tab(val label: String) { Hoje("Hoje"), Faturas("Faturas"), Mes("Mês"), Ajustes("Ajustes") }
