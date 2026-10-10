package dev.johnlaff.neko.ui

import android.os.SystemClock
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
import dev.johnlaff.neko.data.MiaEntry
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
import kotlinx.serialization.json.JsonObject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.async
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
    /** A read the screen shows as such: asked for, or with nothing to show yet. */
    val loading: Boolean = false,
    val error: ReadError? = null,
    /** The sheet's message when its structure changed. */
    val detail: String? = null,
)

typealias TodayState = ScreenState<TodayView>

/**
 * How long a screen's reading counts as fresh: showing it again within this reads nothing, and
 * after it the read is silent, the reading staying on screen (stale-while-revalidate).
 */
const val FRESH_FOR = 60_000L

/** How the Ajustes autosave went, for the chip next to the title. */
enum class SaveState { Idle, Saving, Saved, Failed }

class AppModel(
    private val neko: Neko,
    /** A monotonic clock in ms, for how fresh each reading is; tests drive their own. */
    private val clock: () -> Long = SystemClock::elapsedRealtime,
    private val effects: Effects,
) : ViewModel() {
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
            if (_session.value == Session.SignedIn) readToday(shown = false)
        }
    }

    /** Hoje read now, as asked (the refresh button, a pull, "Tentar de novo"). */
    fun refresh() = readToday(shown = true)

    private fun readToday(shown: Boolean, after: Boolean = false) = load(_today, { neko.today.refresh() }, shown, after) { v ->
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
        read(Tab.Faturas, shown = false)
        read(Tab.Mes, shown = false)
    }

    /** Reads the screen now, as asked; what was read before stays on screen until the new read lands. */
    fun refresh(tab: Tab) = read(tab, shown = true)

    /**
     * A tab shown or the app back in front: a fresh reading is kept as is, an older one is read
     * again in the background without a spinner, as Gmail does, and lands quietly.
     */
    fun show(tab: Tab) {
        val at = readAt[stateOf(tab)]
        if (at == null || clock() - at >= FRESH_FOR) read(tab, shown = false)
    }

    private fun stateOf(tab: Tab): MutableStateFlow<out ScreenState<*>> = when (tab) {
        Tab.Hoje -> _today
        Tab.Faturas -> _invoices
        Tab.Mes -> _months
        Tab.Ajustes -> _ajustes
    }

    private fun read(tab: Tab, shown: Boolean, after: Boolean = false) = when (tab) {
        Tab.Hoje -> readToday(shown, after)
        Tab.Faturas -> load(_invoices, { neko.api.invoices().also { neko.caches.invoices.write(it) } }, shown, after)
        Tab.Mes -> {
            load(_months, { neko.api.months().also { neko.caches.months.write(it) } }, shown, after)
            side { _history.value = neko.api.history().also { neko.caches.history.write(it) } }
        }
        Tab.Ajustes -> {
            load(_ajustes, { neko.api.ajustes().also { neko.caches.ajustes.write(it) } }, shown, after)
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

    /** Which Ajustes group's last change failed ("banks", "devices"), so it can say so in place. */
    private val _changeFailed = MutableStateFlow<String?>(null)
    val changeFailed: StateFlow<String?> = _changeFailed

    /** A change the owner asked for: unlike a read, its failure is said, under its own group. */
    private fun change(group: String, run: suspend () -> Unit) {
        viewModelScope.launch {
            _changeFailed.value = null
            runCatching { run() }.onFailure { e ->
                if (e is ApiException && e.status == 401) signedOut() else _changeFailed.value = group
            }
        }
    }

    fun endSession(id: String) = change("devices") {
        neko.api.endSession(id)
        _devices.value = neko.api.sessions()
    }

    /** Ajustes › Bancos: the Worker reads a newly linked bank in the background. */
    fun saveBanks(items: List<BankLink>) = change("banks") {
        neko.api.saveBanks(items)
        _banks.value = neko.api.banks()
    }

    fun saveBankCards(cards: List<BankCard>) = change("banks") {
        neko.api.saveBankCards(cards)
        _banks.value = neko.api.banks()
    }

    /** Ajustes › Bancos: whether an account keeps savings; Para lançar changes with it. */
    fun saveAccountUse(account: String, use: String) = change("banks") {
        neko.api.accountUse(account, use)
        _banks.value = neko.api.banks()
        readToday(shown = false, after = true)
    }

    fun endOtherSessions() = change("devices") {
        neko.api.endOtherSessions()
        _devices.value = neko.api.sessions()
    }

    /** Ids of writes whose answer never came: tapping again sends the same id, which writes once. */
    private val unanswered = mutableMapOf<String, String>()

    /**
     * A write to the sheet. It runs on the model's scope, so leaving the screen or scrolling the
     * item away does not cancel it halfway; the caller only waits for it. When the connection
     * drops, the id is kept for the same write, and the Worker reports the first one.
     */
    private suspend fun <T> write(what: String, block: suspend (String) -> T): T =
        viewModelScope.async {
            val id = unanswered.getOrPut(what) { java.util.UUID.randomUUID().toString() }
            try {
                block(id).also { unanswered.remove(what) }
            } catch (e: ApiException) {
                // A refusal is final; after a 5xx the write may have landed, so the retry keeps the id.
                if (e.status < 500) unanswered.remove(what)
                throw e
            }
        }.await()

    /** Para lançar and Lançar à mão; each answer reads Hoje again, which drops what was done. */
    val launcher = object : Launcher {
        override val fill: (suspend (String, List<String>) -> MiaEntry?)?
            get() = _mia.value?.takeIf { it.ligada && it.pausadaAte == null }?.let { { f, c -> neko.api.miaEntry(f, c) } }

        override suspend fun launch(draft: JsonObject, key: String?): String = write("launch:$draft") { id ->
            val r = neko.api.launch(id, draft, key)
            if (r.state != "done") throw ApiException(422, "write", r.error ?: "Não gravou. A planilha ficou como estava.")
            readToday(shown = false, after = true)
            r.entryId
        }

        override suspend fun refreshBanks(): Boolean =
            neko.api.refreshBanks().also { readToday(shown = false, after = true) }

        override suspend fun undo(id: String): Boolean =
            if (id.startsWith(IGNORED)) {
                neko.api.unignore(id.removePrefix(IGNORED))
                readToday(shown = false, after = true)
                true
            } else write("undo:$id") { _ ->
                (neko.api.undo(id).state == "undone").also {
                    readToday(shown = false, after = true)
                    // Desfazer after the Diário previsto also puts its setting back.
                    read(Tab.Ajustes, shown = false, after = true)
                }
            }

        override suspend fun ignore(key: String) {
            neko.api.ignore(key)
            readToday(shown = false, after = true)
        }

        override suspend fun account(account: String, use: String) {
            neko.api.accountUse(account, use)
            readToday(shown = false, after = true)
        }

        override suspend fun previsto(value: Long): String = write("previsto:$value") { id ->
            val r = neko.api.previsto(id, value)
            if (r.state != "done") throw ApiException(422, "write", r.error ?: "Não gravou. A planilha ficou como estava.")
            readToday(shown = false, after = true)
            read(Tab.Ajustes, shown = false, after = true)
            r.entryId
        }

        override suspend fun keepPrevisto() {
            neko.api.keepPrevisto()
            readToday(shown = false, after = true)
        }
    }

    /** Hoje's "Perguntar à Mia"; the Worker runs the tools and checks the answer. */
    suspend fun askMia(ask: MiaAsk): MiaReply = neko.api.askMia(ask)

    /** Mia's conversation, kept while the app lives, so leaving her screen and coming back finds it. */
    val miaChat = MiaChat()

    /** Hoje's simulator; the Worker does the math, as for every other figure. */
    suspend fun simulate(amount: Long, count: Int): InstallmentSimulation? = neko.api.simulate(amount, count)

    /** When each screen was last read well, on [clock]; a screen not read this run is missing. */
    private val readAt = mutableMapOf<MutableStateFlow<out ScreenState<*>>, Long>()

    /** Screens with a read on its way, shown or silent: a second one is never started. */
    private val reading = mutableSetOf<MutableStateFlow<out ScreenState<*>>>()

    /**
     * Screens asked to read again while a read was on its way. That read may have left before a
     * write (Lançar, Desfazer), so one more follows it: the screen never settles on the old sheet.
     */
    private val again = mutableSetOf<MutableStateFlow<out ScreenState<*>>>()

    /**
     * Reads one screen. A [shown] read (asked for) spins the head; a silent one does only when
     * there is nothing to show yet, and when it fails the last reading stays, marked offline.
     */
    private fun <T> load(
        state: MutableStateFlow<ScreenState<T>>,
        read: suspend () -> T,
        shown: Boolean,
        /** The sheet just changed (a write): a read already on its way may predate it. */
        after: Boolean = false,
        done: (T) -> Unit = {},
    ) {
        val spin = shown || state.value.view == null
        // Already reading: a refresh asked meanwhile spins until that read lands.
        if (!reading.add(state)) {
            if (spin) state.update { it.copy(loading = true) }
            if (after) again.add(state)
            return
        }
        if (spin) state.update { it.copy(loading = true) }
        viewModelScope.launch {
            val result = runCatching { read() }
            reading.remove(state)
            result.onSuccess { v ->
                readAt[state] = clock()
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
            if (again.remove(state)) load(state, read, shown = false, done = done)
        }
    }

    private var saved: UserSettings? = null
    private var saving: kotlinx.coroutines.Job? = null

    /**
     * Saves Ajustes whole, as the site does; the same settings twice in a row send nothing. The
     * latest call wins: a save still on its way is cancelled by a newer one.
     */
    fun saveSettings(form: UserSettings) {
        // Conferência points are set aside on Hoje: the latest list wins over the one the form read.
        val settings = form.copy(reviewed = (saved ?: _ajustes.value.view?.settings)?.reviewed ?: form.reviewed)
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
                readToday(shown = false)
            }
            result.onFailure { e ->
                if (e is kotlinx.coroutines.CancellationException) throw e
                saved = null
                if (e is ApiException && e.status == 401) signedOut() else _save.value = SaveState.Failed
            }
        }
    }

    /**
     * Hoje › Conferência: sets points aside (hide) or brings them back, on the settings as the
     * Worker has them now, since the site may have checked others. True once saved; Hoje is then
     * read again, as the Worker filters the points it sends.
     */
    suspend fun review(keys: List<String>, hide: Boolean): Boolean =
        editReviewed { if (hide) (it + keys).takeLast(300) else it - keys.toSet() }

    /** Ajustes › Como funciona: every point set aside comes back on Hoje at once (as on the site). */
    suspend fun restoreReviewed(): Boolean = editReviewed { emptyList() }

    private suspend fun editReviewed(change: (List<String>) -> List<String>): Boolean {
        val result = runCatching {
            val s = neko.api.settings()
            neko.api.saveSettings(s.copy(reviewed = change(s.reviewed)))
        }
        result.onSuccess { s ->
            saved = s
            _ajustes.update { st -> st.copy(view = st.view?.copy(settings = s)) }
            _ajustes.value.view?.let { neko.caches.ajustes.write(it) }
            readToday(shown = false)
        }
        result.onFailure { e ->
            if (e is kotlinx.coroutines.CancellationException) throw e
            if (e is ApiException && e.status == 401) signedOut()
        }
        return result.isSuccess
    }

    fun signedIn() {
        _session.value = Session.SignedIn
        readToday(shown = false)
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
        readAt.clear()
        _today.value = TodayState()
        _invoices.value = ScreenState()
        _months.value = ScreenState()
        _ajustes.value = ScreenState()
        _history.value = null
        _devices.value = null
        _banks.value = null
        _mia.value = null
        miaChat.clear()
        miaChat.limited = false
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
        AppModel(app.neko, effects = { view ->
            WidgetRefresh.redraw(app)
            Shortcuts.lancar(app, view?.todayUrl)
            dev.johnlaff.neko.tile.LancarTile.refresh(app)
        })
    }
}

private fun readError(e: Throwable) = when {
    e is ApiException && e.code == "sheet-structure" -> ReadError.SheetStructure
    e is ApiException -> ReadError.Other
    else -> ReadError.Offline
}

/** The app's four places, in dock order. */
enum class Tab(val label: String) { Hoje("Hoje"), Faturas("Faturas"), Mes("Mês"), Ajustes("Ajustes") }
