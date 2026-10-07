package dev.johnlaff.neko.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.data.ApiException
import dev.johnlaff.neko.data.TodayView
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

data class TodayState(
    val view: TodayView? = null,
    val loading: Boolean = false,
    val error: ReadError? = null,
    /** The sheet's message when its structure changed. */
    val detail: String? = null,
)

class AppModel(app: Application) : AndroidViewModel(app) {
    private val neko = app as NekoApp
    private val _session = MutableStateFlow<Session>(Session.Checking)
    val session: StateFlow<Session> = _session
    private val _today = MutableStateFlow(TodayState(view = neko.today.cached()))
    val today: StateFlow<TodayState> = _today

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

    fun refresh() {
        if (_today.value.loading) return
        _today.update { it.copy(loading = true) }
        viewModelScope.launch {
            val result = runCatching { neko.today.refresh() }
            result.onSuccess { v ->
                _today.value = TodayState(view = v)
                WidgetRefresh.redraw(getApplication())
            }
            result.onFailure { e ->
                if (e is ApiException && e.status == 401) {
                    signedOut()
                    return@onFailure
                }
                val kind = when {
                    e is ApiException && e.code == "sheet-structure" -> ReadError.SheetStructure
                    e is ApiException -> ReadError.Other
                    else -> ReadError.Offline
                }
                _today.update { it.copy(loading = false, error = kind, detail = (e as? ApiException)?.message) }
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
        _session.value = Session.SignedOut
        WidgetRefresh.redraw(getApplication())
    }
}
