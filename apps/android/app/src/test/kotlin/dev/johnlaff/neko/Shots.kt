package dev.johnlaff.neko

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.ui.Dock
import dev.johnlaff.neko.ui.NekoTheme
import dev.johnlaff.neko.ui.Tab
import java.io.File
import kotlinx.serialization.KSerializer
import org.robolectric.RuntimeEnvironment

/** A phone and a text size to draw a screen at. */
enum class Device(val qualifiers: String, val fontScale: Float) {
    /** A common large phone, as the app opens. */
    Phone("w412dp-h915dp", 1f),
    /** A small phone with large text, tall enough to show the whole list: where layouts break. */
    SmallLargeText("w360dp-h2400dp", 1.3f),
}

fun <T> readJson(file: File, s: KSerializer<T>): T = json.decodeFromString(s, file.readText())

/** Draws [content] like the app does (window background, dock over it) and saves it to [path]. */
fun ComposeContentTestRule.shot(
    path: String,
    night: Boolean,
    device: Device = Device.Phone,
    tab: Tab? = null,
    content: @Composable () -> Unit,
) {
    RuntimeEnvironment.setQualifiers("+${device.qualifiers}-${if (night) "night" else "notnight"}")
    RuntimeEnvironment.setFontScale(device.fontScale)
    setContent {
        NekoTheme {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                content()
                tab?.let { Dock(it, {}, Modifier.align(Alignment.BottomCenter)) }
            }
        }
    }
    onRoot().captureRoboImage(path)
}
