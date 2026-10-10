package dev.johnlaff.neko

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import dev.johnlaff.neko.ui.LocalMia
import dev.johnlaff.neko.ui.MiaButton
import dev.johnlaff.neko.ui.MiaEntry
import dev.johnlaff.neko.ui.MiaHead
import dev.johnlaff.neko.ui.NekoTheme
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Closing Mia hands the focus back to the way in that opened her, as on the site. */
@RunWith(RobolectricTestRunner::class)
@Config(application = android.app.Application::class)
class MiaReturnTest {
    @get:Rule val compose = createComposeRule()

    private val entry = MiaEntry(onOpen = { _, _ -> }, talking = { false })

    @Test fun headTakesTheFocusBack() {
        compose.setContent { NekoTheme { CompositionLocalProvider(LocalMia provides entry) { MiaHead("faturas") } } }
        entry.returning = "head"
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Perguntar à Mia sobre as faturas").assertIsFocused()
        assertNull(entry.returning)
    }

    @Test fun rowTakesTheFocusBack() {
        compose.setContent { NekoTheme { CompositionLocalProvider(LocalMia provides entry) { MiaButton(false) {} } } }
        entry.returning = "row"
        compose.waitForIdle()
        compose.onNodeWithText("Perguntar à Mia", substring = true).assertIsFocused()
        assertNull(entry.returning)
    }
}
