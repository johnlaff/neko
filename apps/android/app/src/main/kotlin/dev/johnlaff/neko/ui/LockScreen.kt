package dev.johnlaff.neko.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** What shows while the app lock waits: no figure, only the way back in. */
@Composable
fun LockScreen(onUnlock: () -> Unit) {
    val l = LocalLedger.current
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Neko", style = MaterialTheme.typography.displayLarge, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(8.dp))
        Text("Bloqueado neste celular.", color = l.muted, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onUnlock,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = l.accent, contentColor = l.bg),
        ) {
            Text("Desbloquear", color = l.bg, style = MaterialTheme.typography.labelLarge)
        }
    }
}
