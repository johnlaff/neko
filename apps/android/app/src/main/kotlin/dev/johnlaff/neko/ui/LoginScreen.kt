package dev.johnlaff.neko.ui

import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.activity.compose.LocalActivity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import dev.johnlaff.neko.NekoApp
import dev.johnlaff.neko.data.ApiException
import kotlinx.coroutines.launch

/**
 * Signs in with the passkey the phone already holds for the site: Credential Manager offers it
 * because the site's assetlinks.json vouches for this app. The Worker checks it as it checks the
 * site's and sets the same session cookie.
 */
private suspend fun signIn(activity: Activity): String? {
    val api = (activity.application as NekoApp).api
    return try {
        val options = api.passkeyLoginOptions()
        val result = CredentialManager.create(activity).getCredential(
            activity,
            GetCredentialRequest(listOf(GetPublicKeyCredentialOption(options))),
        )
        val credential = result.credential as? PublicKeyCredential
            ?: return "Esta passkey não tem acesso ao Neko."
        api.passkeyLogin(credential.authenticationResponseJson)
        null
    } catch (_: GetCredentialCancellationException) {
        "Cancelado. Tente de novo quando quiser."
    } catch (_: NoCredentialException) {
        "Nenhuma passkey do Neko neste celular. Crie uma no site com o convite e volte aqui."
    } catch (e: ApiException) {
        if (e.status == 403) "Esta passkey não tem acesso ao Neko." else "Não deu para entrar agora. Tente de novo."
    } catch (_: Exception) {
        "Não deu para entrar agora. Confira a conexão e tente de novo."
    }
}

@Composable
fun LoginScreen(onSignedIn: () -> Unit) {
    val l = LocalLedger.current
    val activity = LocalActivity.current ?: return
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        BrandMark(Modifier.width(88.dp))
        Spacer(Modifier.height(20.dp))
        Text("Neko", style = MaterialTheme.typography.displayLarge, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(8.dp))
        Text("Sua planilha, lida todo dia.", color = l.muted, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = {
                busy = true
                error = null
                scope.launch {
                    val failure = signIn(activity)
                    busy = false
                    if (failure == null) onSignedIn() else error = failure
                }
            },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = l.accent, contentColor = l.bg),
        ) {
            // The theme's text styles carry a color, which would win over the button's content color.
            Text(
                if (busy) "Aguardando o aparelho…" else "Entrar com passkey",
                color = l.bg,
                style = MaterialTheme.typography.labelLarge,
            )
        }
        error?.let {
            Spacer(Modifier.height(12.dp))
            // Read out as it appears: the button gives no other sign that sign-in failed.
            Text(
                it,
                color = l.neg,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        Spacer(Modifier.height(24.dp))
        Text(
            "Só leitura: o Neko nunca altera a sua planilha.",
            color = l.faint,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}
