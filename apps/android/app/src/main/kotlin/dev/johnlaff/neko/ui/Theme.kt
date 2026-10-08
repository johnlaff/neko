package dev.johnlaff.neko.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import dev.johnlaff.neko.R

/**
 * Warm Ledger, the site's look (apps/neko/src/web/styles.css): a warm near-black page, hairline
 * panels, Faustina for the sentence that answers the screen and Geist for what you scan. Sage is
 * spent only on the answer and the current place; status colors never follow it.
 */
@Immutable
data class Ledger(
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val border: Color,
    val text: Color,
    val muted: Color,
    val faint: Color,
    val accent: Color,
    val pos: Color,
    val warn: Color,
    val neg: Color,
    /** Mia's amber: only her eyes in the mark, so she reads apart from Neko without a picture. */
    val mia: Color,
)

val DarkLedger = Ledger(
    bg = Color(0xFF0F0E0D), surface = Color(0xFF161514), surface2 = Color(0xFF201E1C),
    border = Color(0xFF2A2826), text = Color(0xFFFAFAF9), muted = Color(0xFFBAB5AD),
    faint = Color(0xFF938E86), accent = Color(0xFF86D19F), pos = Color(0xFF86D19F),
    warn = Color(0xFFE7B765), neg = Color(0xFFF08F78), mia = Color(0xFFE0A85A),
)

val LightLedger = Ledger(
    bg = Color(0xFFF6F5F1), surface = Color(0xFFFFFEFC), surface2 = Color(0xFFEEECE7),
    border = Color(0xFFE2DFD8), text = Color(0xFF1C1A17), muted = Color(0xFF57534E),
    faint = Color(0xFF6D6861), accent = Color(0xFF2A7548), pos = Color(0xFF2A7548),
    warn = Color(0xFF96580B), neg = Color(0xFFB0412B), mia = Color(0xFFA8661A),
)

val LocalLedger = staticCompositionLocalOf { DarkLedger }

private fun weights(res: Int) = FontFamily(
    listOf(400, 500, 600).map { w ->
        Font(res, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
    },
)

val Geist = weights(R.font.geist)
val Faustina = weights(R.font.faustina)

@Composable
fun NekoTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val l = if (dark) DarkLedger else LightLedger
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = l.accent, onPrimary = l.bg, background = l.bg, onBackground = l.text,
        surface = l.surface, onSurface = l.text, surfaceVariant = l.surface2,
        onSurfaceVariant = l.muted, outline = l.border, error = l.neg,
    )
    val base = TextStyle(fontFamily = Geist, color = l.text)
    val type = Typography(
        displayLarge = base.copy(fontFamily = Faustina, fontSize = 30.sp, lineHeight = 34.sp),
        headlineSmall = base.copy(fontFamily = Faustina, fontSize = 22.sp, lineHeight = 26.sp),
        titleMedium = base.copy(fontSize = 16.sp, fontWeight = FontWeight.Medium, lineHeight = 22.sp),
        bodyLarge = base.copy(fontSize = 15.sp, lineHeight = 22.sp),
        bodyMedium = base.copy(fontSize = 14.sp, lineHeight = 20.sp),
        labelLarge = base.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium),
        labelMedium = base.copy(fontSize = 13.sp, lineHeight = 18.sp),
        // Roles a screen asks for must exist, or Material fills them with its own face.
        titleLarge = base.copy(fontSize = 18.sp, fontWeight = FontWeight.Medium, lineHeight = 24.sp),
        labelSmall = base.copy(fontSize = 12.sp, fontWeight = FontWeight.Medium, lineHeight = 16.sp),
    )
    androidx.compose.runtime.CompositionLocalProvider(LocalLedger provides l) {
        MaterialTheme(colorScheme = scheme, typography = type, content = content)
    }
}
