package dev.johnlaff.neko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.data.DayMove
import dev.johnlaff.neko.data.MonthItem
import dev.johnlaff.neko.data.Saving
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.monthName
import dev.johnlaff.neko.ui.Format.shortDate
import dev.johnlaff.neko.ui.Format.signed
import java.time.LocalDate

private val BANDS = listOf(
    "negative" to "No vermelho",
    "attention" to "Apertado",
    "healthy" to "Folgado",
    "surplus" to "Sobrando",
)
private val WEEK = listOf("D", "S", "T", "Q", "Q", "S", "S")

/** The sheet's band as a color, the same mapping as the site's termômetro. */
@Composable
private fun bandColor(band: String): Color {
    val l = LocalLedger.current
    return when (band) {
        "negative" -> l.neg
        "attention" -> l.warn
        "healthy" -> lerp(l.accent, l.warn, 0.45f)
        else -> l.accent
    }
}

/**
 * The site's termômetro (web/Thermo.tsx): the month as a calendar, one neutral tile per day with
 * the band of its balance as a stroke under the number. Days ahead are outlined because they are
 * a forecast; today is ringed. Tap a day to read what moved it. In the month of the next payday
 * it also says how much the flow lets you set aside that day.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Thermo(m: MonthItem, today: String, saving: Saving?) {
    val l = LocalLedger.current
    val monthKey = m.key
    val todayDay = if (today.take(7) == monthKey) today.drop(8).toIntOrNull() else null
    var picked by remember(monthKey) { mutableStateOf<Int?>(null) }
    val shown = m.days.find { it.day == (picked ?: todayDay) }
    val mon = monthName(m.month).take(3)
    val save = saving?.takeIf { it.date.take(7) == monthKey }
    val payday = save?.date?.drop(8)?.toIntOrNull()
    // Sunday first, as on the site: blanks before day 1.
    val offset = LocalDate.of(m.year, m.month, 1).dayOfWeek.value % 7
    val cells: List<Int?> = List(offset) { null } + m.days.map { it.day }

    Panel {
        PanelHead("Saldo dia a dia") {
            if (shown != null) {
                Row {
                    Text("${shown.day} $mon · ", color = l.faint, style = MaterialTheme.typography.labelMedium)
                    Text(
                        money(shown.balance),
                        color = bandColor(shown.band),
                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    )
                }
            } else {
                Text("Escolha um dia", color = l.faint, style = MaterialTheme.typography.labelMedium)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                WEEK.forEach {
                    Text(it, color = l.faint, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                }
            }
            cells.chunked(7).forEach { week ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 0 until 7) {
                        val day = week.getOrNull(i)
                        val d = day?.let { n -> m.days.find { it.day == n } }
                        Box(Modifier.weight(1f)) {
                            if (d != null) {
                                DayTile(
                                    day = d.day,
                                    band = d.band,
                                    future = d.future,
                                    today = d.day == todayDay,
                                    picked = shown?.day == d.day,
                                    payday = d.day == payday,
                                    description = "${d.day} $mon: ${money(d.balance)}, " +
                                        BANDS.first { it.first == d.band }.second.lowercase() +
                                        (if (d.future) ", previsão" else "") +
                                        (if (d.day == payday) ", dia de guardar" else ""),
                                ) { picked = d.day }
                            }
                        }
                    }
                }
            }
        }
        if (picked != null && shown != null) Moves(shown.moves)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            // Only the colors this month uses: the legend explains what is on screen, nothing more.
            BANDS.filter { (band, _) -> m.days.any { it.band == band } }.forEach { (band, label) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(12.dp).height(3.dp).background(bandColor(band), RoundedCornerShape(2.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(label, color = l.faint, style = MaterialTheme.typography.labelSmall)
                }
            }
            if (save != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(4.dp).background(l.muted, CircleShape))
                    Spacer(Modifier.width(6.dp))
                    Text("Dia de guardar", color = l.faint, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        if (save != null) {
            HorizontalDivider(color = l.border)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text("Dá para guardar ${money(save.amount)} no dia $payday.", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "Menor saldo até ${shortDate(save.until)}: ${money(save.leftAtLowest)}",
                    color = l.muted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
        Hint("mes", Learn.MES)
    }
}

@Composable
private fun DayTile(
    day: Int,
    band: String,
    future: Boolean,
    today: Boolean,
    picked: Boolean,
    payday: Boolean,
    description: String,
    onClick: () -> Unit,
) {
    val l = LocalLedger.current
    val shape = RoundedCornerShape(10.dp)
    Box(
        Modifier
            .fillMaxWidth()
            // Square: as tall as the column allows, closer to a finger's size than a wide strip.
            .aspectRatio(1f)
            .then(if (picked) Modifier.border(2.dp, l.muted, shape) else Modifier)
            .padding(if (picked) 3.dp else 0.dp)
            .background(if (future) Color.Transparent else lerp(l.surface, l.text, 0.05f), shape)
            .then(
                when {
                    today -> Modifier.border(2.dp, l.text, shape)
                    // Days still ahead are plain numbers: no box, so the month reads as one calm grid.
                    else -> Modifier
                },
            )
            .clickable(onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = description
                selected = picked
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "$day",
            color = if (future) l.muted else l.text,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 5.dp)
                .width(14.dp)
                .height(3.dp)
                .background(bandColor(band).copy(alpha = if (future) 0.4f else 1f), RoundedCornerShape(2.dp)),
        )
        if (payday) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 5.dp, end = 6.dp)
                    .size(4.dp)
                    .background(if (future) l.muted else l.text, CircleShape),
            )
        }
    }
}

/** What moved the picked day's balance, the way the sheet holds it. */
@Composable
private fun Moves(moves: List<DayMove>) {
    val l = LocalLedger.current
    if (moves.isEmpty()) {
        Text("Nada entrou nem saiu neste dia.", color = l.muted, style = MaterialTheme.typography.bodyMedium)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        moves.forEach { m ->
            val income = m.kind == "income"
            val name = if (m.kind == "diario") "Diário" else m.description.ifBlank { "Sem detalhe" }
            ListRow(
                name = name,
                value = signed(m.amount, if (income) '+' else '−'),
                avatar = when (m.kind) {
                    "card" -> monogram(name)
                    "diario" -> "D"
                    else -> name.take(1).uppercase()
                },
                valueColor = if (income) l.pos else l.text,
                accent = income,
            )
        }
    }
}
