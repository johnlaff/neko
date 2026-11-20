@file:OptIn(ExperimentalLayoutApi::class)

package dev.johnlaff.neko.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R
import dev.johnlaff.neko.data.Subscription
import dev.johnlaff.neko.data.SubscriptionMark
import dev.johnlaff.neko.data.Subscriptions
import dev.johnlaff.neko.ui.Format.bankText
import dev.johnlaff.neko.ui.Format.merchantName
import dev.johnlaff.neko.ui.Format.money
import dev.johnlaff.neko.ui.Format.shortDate
import kotlinx.coroutines.launch

/** The site's Assinaturas (web/faturas/Subscriptions.tsx), word for word. */

private fun nameOf(description: String) = bankText(merchantName(description))
private fun dayOf(r: Subscription) = r.last.substring(8, 10).toInt()

/** What asks for a look first: charged after the mark, went up, or new. */
private fun flagged(r: Subscription) = r.again != null || r.before != null || r.isNew

/** The one or two words a row needs besides its name; the sheet has the rest. */
@Composable
private fun SubChips(r: Subscription) {
    when {
        r.again != null -> Chip("Cobrou de novo", ChipTone.Bad)
        r.before != null -> Chip("Subiu", ChipTone.Warn)
        r.isNew -> Chip("Nova", ChipTone.Ok)
    }
    if (r.cancel && r.again == null) Chip("A cancelar", ChipTone.Plain)
    if (r.split != null) Chip("Dividida", ChipTone.Plain)
}

private const val SHOWN = 3

/**
 * Charges of the same value that came back each month on the owner's cards, in half a screen: what
 * asks for a look on top (charged after the mark, went up, new), then the biggest, the rest one tap
 * away. A tap opens the subscription; deciding lives there and in "Revisar uma a uma".
 */
@Composable
internal fun SubscriptionsPanel(
    subs: Subscriptions,
    /** The one "Não é assinatura" just took out, to put back with Desfazer. */
    gone: Subscription?,
    actions: FaturasActions,
    onOpen: (String) -> Unit,
    onUndone: () -> Unit,
    onReview: () -> Unit,
) {
    val l = LocalLedger.current
    var all by rememberSaveable { mutableStateOf(false) }
    var hiddenOpen by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val top = subs.items.filter(::flagged)
    val rest = subs.items.filterNot(::flagged)
    val shown = if (all) rest else rest.take(SHOWN)
    val unhide = { key: String, after: () -> Unit ->
        busy = true
        actions.subscription(key, null, false) { ok ->
            busy = false
            if (ok) after()
        }
    }
    Panel {
        PanelHead("Assinaturas") {
            Text("${money(subs.total)} por mês", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        (top + shown).forEach { r ->
            key(r.key) {
                ListRow(
                    name = nameOf(r.description),
                    value = money(r.amount),
                    modifier = Modifier.clickable(onClickLabel = "abrir") { onOpen(r.key) },
                    avatar = "",
                    avatarVector = categoryIcon(r.description),
                    avatarIcon = R.drawable.ic_repeat,
                    meta = "${r.card} · dia ${dayOf(r)}",
                    chips = { SubChips(r) },
                    next = true,
                )
            }
        }
        if (rest.size > shown.size) TextAction("Ver as outras ${rest.size - shown.size}", { all = true }, color = l.accent)
        Column(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
            gone?.let { g ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("${nameOf(g.description)} saiu da lista.", color = l.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f, fill = false))
                    TextAction("Desfazer", { unhide(g.key, onUndone) }, color = l.accent, enabled = !busy)
                }
            }
        }
        if (subs.toCancel > 0 || subs.cut.total > 0) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (subs.toCancel > 0) Text(
                    "${subs.items.count { it.cancel }} a cancelar: ${money(subs.toCancel)} a menos por mês",
                    color = l.pos,
                    style = MaterialTheme.typography.labelLarge,
                )
                if (subs.cut.total > 0) Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = l.pos, modifier = Modifier.padding(top = 1.dp).size(14.dp))
                    Text(
                        "Você já cortou ${money(subs.cut.total)} por mês (${subs.cut.items.joinToString(", ") { nameOf(it.description) }})",
                        color = l.muted,
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        OutlinedButton(
            onClick = onReview,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = l.text),
            border = BorderStroke(1.dp, l.borderInput),
        ) {
            Text("Revisar uma a uma", color = l.text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
            if (subs.undecided in 1 until subs.items.size) {
                Spacer(Modifier.width(8.dp))
                Text("${subs.undecided} sem decisão", color = l.faint, style = MaterialTheme.typography.labelMedium)
            }
        }
        if (subs.hidden.isNotEmpty()) {
            TextAction("Não são assinaturas (${subs.hidden.size})", { hiddenOpen = !hiddenOpen }, open = hiddenOpen)
            Reveal(hiddenOpen) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    subs.hidden.forEach { r ->
                        key(r.key) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text(nameOf(r.description), style = MaterialTheme.typography.bodyMedium)
                                    Text("${r.card} · ${money(r.amount)}", color = l.faint, style = MaterialTheme.typography.labelMedium)
                                }
                                Small("Voltar para a lista", filled = false, enabled = !busy) { unhide(r.key) {} }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Everything about one subscription, and the decisions about it: keep, cancel, split, hide. */
@Composable
internal fun SubscriptionDetail(
    r: Subscription,
    people: List<String>,
    waits: List<String>,
    actions: FaturasActions,
    onHide: () -> Unit,
) {
    val l = LocalLedger.current
    // The tap shows at once; the screen read again with the mark takes over.
    var pending by remember(r.cancel, r.kept) { mutableStateOf<SubscriptionMark?>(null) }
    var failed by remember { mutableStateOf(false) }
    var hiding by remember { mutableStateOf(false) }
    var owner by remember { mutableStateOf(false) }
    val choice = pending ?: if (r.cancel) SubscriptionMark.Cancel else if (r.kept) SubscriptionMark.Keep else null
    val name = nameOf(r.description)
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        ListRow(
            name = name,
            value = "",
            avatar = "",
            avatarVector = categoryIcon(r.description),
            avatarIcon = R.drawable.ic_repeat,
            meta = "${r.card} · cobra no dia ${dayOf(r)}",
        )
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BigMoney(r.amount)
                Text("por mês", color = l.muted, modifier = Modifier.padding(bottom = 10.dp))
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { SubChips(r) }
        }
        Text(
            "${money(r.amount * 12)} em um ano" +
                (r.before?.let { " · antes era ${money(it)}" } ?: "") +
                (r.again?.let { " · cobrou em ${shortDate(it)}, depois de marcada para cancelar" } ?: ""),
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
        )
        if (r.charged.isNotEmpty()) {
            val most = maxOf(1L, r.charged.maxOf { it.amount })
            Column(Modifier.semantics(mergeDescendants = true) { contentDescription = "Últimas cobranças: " + r.charged.joinToString(", ") { "${shortDate(it.date)}, ${money(it.amount)}" } }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                r.charged.forEach { c ->
                    Row(Modifier.clearAndSetSemantics {}, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(shortDate(c.date), color = l.faint, style = MaterialTheme.typography.labelMedium, modifier = Modifier.widthIn(min = 48.dp))
                        Box(Modifier.weight(1f)) {
                            Box(Modifier.fillMaxWidth(c.amount.toFloat() / most).height(6.dp).background(l.borderInput, RoundedCornerShape(50)))
                        }
                        Text(money(c.amount), style = MaterialTheme.typography.labelLarge, textAlign = androidx.compose.ui.text.style.TextAlign.End, modifier = Modifier.widthIn(min = 88.dp))
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().semantics { contentDescription = "O que fazer com $name" },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf(SubscriptionMark.Keep to "Manter", SubscriptionMark.Cancel to "Vou cancelar").forEach { (k, label) ->
                Box(Modifier.weight(1f)) {
                    Choice(label, choice == k, fill = true) {
                        if (choice == k) return@Choice
                        pending = k
                        failed = false
                        actions.subscription(r.key, k, null) { ok ->
                            if (!ok) {
                                pending = null
                                failed = true
                            }
                        }
                    }
                }
            }
        }
        if (choice == SubscriptionMark.Cancel) Text(
            "Cancele no app ou no site dela. Quando a cobrança parar, ela vai para \"Você já cortou\".",
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
        )
        r.splitKey?.let { splitKey ->
            HorizontalDivider(color = l.border)
            if (owner) {
                Text("De quem é, todo mês", style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
                OwnerForm(
                    amount = r.amount,
                    current = r.split?.let { OwnerNow(it.person, it.share) },
                    installments = null,
                    due = null,
                    monthly = true,
                    people = people,
                    waits = waits,
                    onSave = { p, s, after -> actions.owner(splitKey, p, s, after) },
                    onDone = { owner = false },
                )
            } else {
                val split = r.split
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button) { owner = true }.heightIn(min = 56.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(if (split != null) "Dividida com ${split.person}" else "Dividir com alguém")
                        Text(
                            when {
                                split == null -> "Metade todo mês, ou outro valor"
                                split.share < r.amount -> "${split.person} paga ${money(split.share)} todo mês"
                                else -> "${split.person} paga tudo todo mês"
                            },
                            color = l.faint,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                    Icon(painterResource(R.drawable.ic_chevron_right), contentDescription = null, tint = l.faint, modifier = Modifier.size(16.dp))
                }
            }
        }
        if (failed) Failed("Não salvou. Tente de novo.")
        TextAction(
            "Não é assinatura",
            {
                hiding = true
                failed = false
                actions.subscription(r.key, null, true) { ok ->
                    hiding = false
                    if (ok) onHide() else failed = true
                }
            },
            enabled = !hiding,
        )
    }
}

/** Past this, a swipe decides; less springs the card back. */
private val FLING = 90.dp

/**
 * "Revisar uma a uma": the subscriptions without a decision, one at a time and biggest first, with
 * what each costs in a year; Manter or Vou cancelar, by button or a swipe of the card (right keeps,
 * left cancels). All of them when every one has a decision already. The list is fixed when it
 * opens, so a decision never moves the next one. Each decision is saved as it is made; the screen
 * is read again once, at the end or on leaving.
 */
@Composable
internal fun Review(subs: Subscriptions, reading: Boolean, actions: FaturasActions, onBack: () -> Unit) {
    val l = LocalLedger.current
    val rows = remember {
        val open = subs.items.filter { !it.cancel && !it.kept }
        open.ifEmpty { subs.items }
    }
    var at by rememberSaveable { mutableIntStateOf(0) }
    val decided = remember { mutableStateMapOf<String, SubscriptionMark>() }
    var failed by remember { mutableStateOf(false) }
    val reviewed by rememberUpdatedState(actions.reviewed)
    DisposableEffect(Unit) { onDispose { reviewed() } }
    val r = rows.getOrNull(at)
    LaunchedEffect(r == null) { if (r == null) reviewed() }
    if (r == null) {
        ReviewDone(subs, rows, decided, reading, failed, onBack) {
            decided.clear()
            at = 0
        }
        return
    }
    val decide = { mark: SubscriptionMark ->
        decided[r.key] = mark
        at += 1
        actions.review(r.key, mark) { ok -> if (!ok) failed = true }
    }
    val marked = decided.values.count { it == SubscriptionMark.Cancel }
    val name = nameOf(r.description)
    Panel {
        PanelHead("Revisar assinaturas") {
            Text("${at + 1} de ${rows.size}", color = l.faint, style = MaterialTheme.typography.labelMedium)
        }
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            rows.forEachIndexed { i, x ->
                val color = when {
                    i < at -> if (decided[x.key] == SubscriptionMark.Cancel) l.warn else l.muted
                    i == at -> l.text
                    else -> l.border
                }
                Box(Modifier.weight(1f).height(4.dp).background(color, RoundedCornerShape(2.dp)))
            }
        }
        key(r.key) { ReviewCard(r, name, decide) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Small("Manter", filled = false, modifier = Modifier.weight(1f)) { decide(SubscriptionMark.Keep) }
            Small("Vou cancelar", filled = true, modifier = Modifier.weight(1f)) { decide(SubscriptionMark.Cancel) }
        }
        Text(
            "Ou deslize: direita mantém, esquerda cancela.",
            color = l.muted,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.fillMaxWidth(),
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        if (marked > 0) Text(
            "${countOf(marked, "marcada", "marcadas")} para cancelar nesta revisão",
            color = l.warn,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        if (at > 0) TextAction("Voltar uma", { at -= 1 }, color = l.accent)
    }
}

/** One subscription to decide: dragged sideways it tilts, and a stamp says what letting go does. */
@Composable
private fun ReviewCard(r: Subscription, name: String, decide: (SubscriptionMark) -> Unit) {
    val l = LocalLedger.current
    val scope = rememberCoroutineScope()
    val dx = remember { Animatable(0f) }
    val density = LocalDensity.current
    val fling = with(density) { FLING.toPx() }
    val stamp = with(density) { 30.dp.toPx() }
    val decideNow by rememberUpdatedState(decide)
    Box(
        Modifier
            .fillMaxWidth()
            .appear()
            .graphicsLayer {
                translationX = dx.value
                rotationZ = dx.value / density.density / 25f
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragEnd = {
                        if (kotlin.math.abs(dx.value) > fling) decideNow(if (dx.value > 0) SubscriptionMark.Keep else SubscriptionMark.Cancel)
                        else scope.launch { dx.animateTo(0f) }
                    },
                    onDragCancel = { scope.launch { dx.animateTo(0f) } },
                ) { change, amount ->
                    change.consume()
                    scope.launch { dx.snapTo(dx.value + amount) }
                }
            }
            .background(l.surface2, RoundedCornerShape(16.dp))
            // TalkBack decides with its own actions, as the buttons below do.
            .semantics {
                customActions = listOf(
                    CustomAccessibilityAction("Manter") { decideNow(SubscriptionMark.Keep); true },
                    CustomAccessibilityAction("Vou cancelar") { decideNow(SubscriptionMark.Cancel); true },
                )
            }
            .padding(start = 20.dp, top = 22.dp, end = 20.dp, bottom = 20.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(36.dp).background(l.surface, CircleShape), contentAlignment = Alignment.Center) {
                val icon = categoryIcon(r.description)
                if (icon != null) Icon(icon, contentDescription = null, tint = l.muted, modifier = Modifier.size(18.dp))
                else Icon(painterResource(R.drawable.ic_repeat), contentDescription = null, tint = l.muted, modifier = Modifier.size(18.dp))
            }
            Text(
                name,
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics {
                    heading()
                    liveRegion = LiveRegionMode.Polite
                },
            )
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BigMoney(r.amount)
                Text("por mês", color = l.muted, modifier = Modifier.padding(bottom = 10.dp))
            }
            Text("${money(r.amount * 12)} em um ano", fontWeight = FontWeight.Medium)
            Text(
                "${r.card} · cobra no dia ${dayOf(r)} · ${countOf(r.charges, "cobrança", "cobranças")}",
                color = l.muted,
                style = MaterialTheme.typography.bodySmall,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { SubChips(r) }
        }
        // The stamp shows on the side the card leaves from, as in a swipe deck.
        val keep = dx.value > stamp
        val cut = dx.value < -stamp
        if (keep || cut) {
            val color = if (keep) l.pos else l.warn
            Text(
                if (keep) "Manter" else "Vou cancelar",
                color = color,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.align(Alignment.TopEnd).clearAndSetSemantics {}
                    .border(2.dp, color, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 2.dp),
            )
        }
    }
}

/** The end of a review: what was marked to cancel, and what it takes off each month. */
@Composable
private fun ReviewDone(
    subs: Subscriptions,
    rows: List<Subscription>,
    decided: Map<String, SubscriptionMark>,
    reading: Boolean,
    failed: Boolean,
    onBack: () -> Unit,
    onAgain: () -> Unit,
) {
    val l = LocalLedger.current
    val cancel = rows.filter { (decided[it.key] ?: if (it.cancel) SubscriptionMark.Cancel else null) == SubscriptionMark.Cancel }
    Panel {
        Box(Modifier.size(40.dp).background(l.pos.copy(alpha = 0.16f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(painterResource(R.drawable.ic_check), contentDescription = null, tint = l.pos, modifier = Modifier.size(20.dp))
        }
        PageTitle("Pronto")
        Text(
            if (cancel.isEmpty()) "Você manteve todas."
            else "${countOf(cancel.size, "assinatura marcada", "assinaturas marcadas")} para cancelar. Cancele cada uma no app ou no site dela; quando a cobrança parar, ela vai para \"Você já cortou\".",
            color = l.muted,
        )
        cancel.forEach { x ->
            key(x.key) {
                ListRow(
                    name = nameOf(x.description),
                    value = money(x.amount),
                    avatar = "",
                    avatarVector = categoryIcon(x.description),
                    avatarIcon = R.drawable.ic_repeat,
                    meta = x.card,
                )
            }
        }
        // The total comes from the screen read again with the marks, not from adding them here.
        Text(
            if (!reading && subs.toCancel > 0) "Com todas as marcadas: ${money(subs.toCancel)} a menos por mês" else "",
            color = l.pos,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        if (failed) Failed("Alguma decisão não salvou. Abra a assinatura em Faturas e marque de novo.")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Small("Voltar para Faturas", filled = true, modifier = Modifier.weight(1f), onClick = onBack)
            Small("Revisar de novo", filled = false, modifier = Modifier.weight(1f), onClick = onAgain)
        }
    }
}
