package dev.johnlaff.neko.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.johnlaff.neko.R

/**
 * The site's Sheet (web/Sheet.tsx): what a tap opens over the page, a bottom sheet with its
 * title, closed by a swipe down, back or a tap outside.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun Sheet(title: String, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val l = LocalLedger.current
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = l.surface,
        contentColor = l.text,
        dragHandle = { BottomSheetDefaults.DragHandle(color = l.borderInput) },
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
            content()
        }
    }
}

/** Back to the month's bills from a page of its own (the site's `.back-link`). */
@Composable
internal fun BackRow(label: String, onClick: () -> Unit) {
    val l = LocalLedger.current
    Row(
        Modifier.clickable(role = Role.Button, onClick = onClick).heightIn(min = 48.dp).padding(end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(painterResource(R.drawable.ic_chevron_left), contentDescription = null, tint = l.accent, modifier = Modifier.size(18.dp))
        Text(label, color = l.accent, style = MaterialTheme.typography.labelLarge)
    }
}

/**
 * A page's name, read first when the page opens, as a new screen's would be (the site moves the
 * focus to its heading).
 */
@Composable
internal fun PageTitle(text: String, modifier: Modifier = Modifier) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        // Laid out on the next frame; a page that is gone by then lets it go.
        withFrameNanos { }
        runCatching { focus.requestFocus() }
    }
    Text(
        text,
        style = MaterialTheme.typography.headlineSmall,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier.focusRequester(focus).focusable().semantics { heading() },
    )
}

/** What is yours and what each other person pays, side by side (the site's `.split-bar`). */
@Composable
internal fun SplitBar(mine: Long, theirs: List<Long>, description: String, modifier: Modifier = Modifier) {
    val l = LocalLedger.current
    Row(
        modifier.fillMaxWidth().height(8.dp).clearAndSetSemantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        val pill = RoundedCornerShape(50)
        // The owner's part in ink, someone else's in green: told apart by more than the hue.
        if (mine > 0) Box(Modifier.weight(mine.toFloat()).widthIn(min = 4.dp).height(8.dp).background(l.text, pill))
        theirs.filter { it > 0 }.forEach { t ->
            Box(Modifier.weight(t.toFloat()).widthIn(min = 4.dp).height(8.dp).background(l.accent, pill))
        }
    }
}

/** A person, not a card: one initial in the accent's tint (the site's `.avatar.person`). */
@Composable
internal fun PersonAvatar(name: String, size: Int = 36) {
    val l = LocalLedger.current
    Box(Modifier.size(size.dp).background(l.accent.copy(alpha = 0.16f), CircleShape), contentAlignment = Alignment.Center) {
        Text(name.take(1).uppercase(), color = l.accent, style = MaterialTheme.typography.labelLarge)
    }
}

/** A sample of what a color means, beside its words (the site's `.split-key`). */
@Composable
internal fun KeyDot(color: Color, text: String) {
    val l = LocalLedger.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).background(color, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(text, color = l.muted, style = MaterialTheme.typography.labelMedium)
    }
}

/** A save that failed, with the way to send it again beside the words (the site's "Tentar de novo"). */
@Composable
internal fun FailedRetry(text: String, onRetry: () -> Unit) {
    val l = LocalLedger.current
    androidx.compose.foundation.layout.FlowRow(
        verticalArrangement = Arrangement.Center,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Failed(text)
        TextAction("Tentar de novo", onRetry, color = l.accent)
    }
}
