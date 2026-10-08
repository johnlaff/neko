package dev.johnlaff.neko

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.johnlaff.neko.share.WinCard
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The picture a month's wins become when shared: the wins and the cat, no amount. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class WinCardTest {
    @Test fun wrapsLongWinsByWidth() {
        assertEquals(listOf("aa bb", "cc"), WinCard.wrap("aa bb cc", 5f) { it.length.toFloat() })
        assertEquals(listOf("palavra"), WinCard.wrap("palavra", 3f) { it.length.toFloat() })
    }

    @Test fun drawsTheCard() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val bmp = WinCard.draw(
            context,
            "Setembro de 2026 fechou",
            // Four wins, three of them two lines long: the cat gives way, the footer stays clear.
            listOf(
                "3 meses seguidos no azul",
                "Recorde: o mês que mais guardou até aqui",
                "Faturas do cartão menores que as do mês anterior",
                "A reserva já cobre 3 meses de custo de vida",
            ),
        )
        assertEquals(1080, bmp.width)
        assertEquals(1350, bmp.height)
        bmp.captureRoboImage("screenshots/share/conquista.png")
    }
}
