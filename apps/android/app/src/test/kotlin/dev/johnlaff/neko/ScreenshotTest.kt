package dev.johnlaff.neko

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.ui.HojeScreen
import dev.johnlaff.neko.ui.LoginScreen
import dev.johnlaff.neko.ui.NekoTheme
import dev.johnlaff.neko.ui.TodayState
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RobolectricTestRunner

/**
 * Screens drawn from the contract fixture, light and dark. `./gradlew recordRoborazziDebug`
 * writes them to app/screenshots; `verifyRoborazziDebug` compares against those files.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class ScreenshotTest {
    @get:Rule val compose = createComposeRule()

    private val view: TodayView = json.decodeFromString(File("src/test/resources/today.json").readText())

    @Test fun hojeDark() = shot("hoje-dark", night = true) { HojeScreen(TodayState(view), {}, {}) }

    @Test fun hojeLight() = shot("hoje-light", night = false) { HojeScreen(TodayState(view), {}, {}) }

    @Test fun loginDark() = shot("login-dark", night = true) { LoginScreen {} }

    private fun shot(name: String, night: Boolean, content: @androidx.compose.runtime.Composable () -> Unit) {
        org.robolectric.RuntimeEnvironment.setQualifiers(if (night) "+night" else "+notnight")
        compose.setContent { NekoTheme(content) }
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }
}
