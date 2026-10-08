package dev.johnlaff.neko.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.lifecycle.viewModelScope
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.AjustesView
import dev.johnlaff.neko.data.BankCard
import dev.johnlaff.neko.data.BankLink
import dev.johnlaff.neko.data.BanksView
import dev.johnlaff.neko.data.Device
import dev.johnlaff.neko.data.HistoryView
import dev.johnlaff.neko.data.InstallmentSimulation
import dev.johnlaff.neko.data.InvoicesView
import dev.johnlaff.neko.data.MiaAsk
import dev.johnlaff.neko.data.MiaReply
import dev.johnlaff.neko.data.MiaStatus
import dev.johnlaff.neko.data.MonthsView
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.UserSettings
import dev.johnlaff.neko.data.Effects
import dev.johnlaff.neko.data.Neko
import dev.johnlaff.neko.shortcuts.Shortcuts
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

class AppModel(private val neko: Neko, private val effects: Effects) : ViewModel() {
    private val _session = MutableStateFlow<Session>(Session.Checking)
    val session: StateFlow<Session> = _session
    private val _today = MutableStateFlow(TodayState())
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
    private val _banks = MutableStateFlow<BanksView?>(null)
    val banks: StateFlow<BanksView?> = _banks
    private val _mia = MutableStateFlow<MiaStatus?>(null)
    val mia: StateFlow<MiaStatus?> = _mia
    private val _save = MutableStateFlow(SaveState.Idle)
    val save: StateFlow<SaveState> = _save

    init {
        viewModelScope.launch {
            // Every screen opens with its last reading, read off the main thread while the splash shows.
            _today.value = TodayState(view = neko.today.cached())
            _invoices.value = ScreenState(view = neko.caches.invoices.read())
            _months.value = ScreenState(view = neko.caches.months.read())
            _ajustes.value = ScreenState(view = neko.caches.ajustes.read())
            _history.value = neko.caches.history.read()
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

    fun refresh() = load(_today, { neko.today.refresh() }) { v ->
        effects.todayChanged(v)
        prefetch()
        side { _mia.value = neko.api.mia() }
    }

    private var prefetched = false

    /**
     * After the first Hoje of a run, Faturas and Mês are read in the background, so the first tap
     * on them shows today's numbers instead of a skeleton. The Worker caches per sheet version, so
     * this costs no extra Google read when the sheet hasn't changed.
     */
    private fun prefetch() {
        if (prefetched) return
        prefetched = true
        refresh(Tab.Faturas)
        refresh(Tab.Mes)
    }

    /** Reads the screen on show; what was read before stays on screen until the new read lands. */
    fun refresh(tab: Tab) = when (tab) {
        Tab.Hoje -> refresh()
        Tab.Faturas -> load(_invoices, { neko.api.invoices().also { neko.caches.invoices.write(it) } })
        Tab.Mes -> {
            load(_months, { neko.api.months().also { neko.caches.months.write(it) } })
            side { _history.value = neko.api.history().also { neko.caches.history.write(it) } }
        }
        Tab.Ajustes -> {
            load(_ajustes, { neko.api.ajustes().also { neko.caches.ajustes.write(it) } })
            readDevices()
            side { _banks.value = neko.api.banks() }
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

    /** Ajustes › Bancos: the Worker reads a newly linked bank in the background. */
    fun saveBanks(items: List<BankLink>) = side {
        neko.api.saveBanks(items)
        _banks.value = neko.api.banks()
    }

    fun saveBankCards(cards: List<BankCard>) = side {
        neko.api.saveBankCards(cards)
        _banks.value = neko.api.banks()
    }

    fun endOtherSessions() = side {
        neko.api.endOtherSessions()
        _devices.value = neko.api.sessions()
    }

    /** Hoje's "Perguntar à Mia"; the Worker runs the tools and checks the answer. */
    suspend fun askMia(ask: MiaAsk): MiaReply = neko.api.askMia(ask)

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
                _ajustes.value.view?.let { neko.caches.ajustes.write(it) }
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
        neko.caches.clear()
        neko.cookies.clear()
        prefetched = false
        _today.value = TodayState()
        _invoices.value = ScreenState()
        _months.value = ScreenState()
        _ajustes.value = ScreenState()
        _history.value = null
        _devices.value = null
        _banks.value = null
        _mia.value = null
        _save.value = SaveState.Idle
        saved = null
        _session.value = Session.SignedOut
        effects.todayChanged(null)
    }
}

/** How the activity gets its AppModel: the app's one Neko, and the widget and shortcut effects. */
val AppModelFactory = viewModelFactory {
    initializer {
        val app = this[APPLICATION_KEY] as NekoApp
        AppModel(app.neko) { view ->
            WidgetRefresh.redraw(app)
            Shortcuts.lancar(app, view?.todayUrl)
            dev.johnlaff.neko.tile.LancarTile.refresh(app)
        }
    }
}

private fun readError(e: Throwable) = when {
    e is ApiException && e.code == "sheet-structure" -> ReadError.SheetStructure
    e is ApiException -> ReadError.Other
    else -> ReadError.Offline
}

/** The app's four places, in dock order. */
enum class Tab(val label: String) { Hoje("Hoje"), Faturas("Faturas"), Mes("Mês"), Ajustes("Ajustes") }
