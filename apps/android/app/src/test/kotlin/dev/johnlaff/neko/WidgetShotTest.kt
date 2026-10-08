package dev.johnlaff.neko

import android.content.Context
import android.widget.FrameLayout
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.ExperimentalGlanceApi
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.compose
import androidx.glance.appwidget.provideContent
import androidx.test.core.app.ApplicationProvider
import com.github.takahirom.roborazzi.captureRoboImage
import dev.johnlaff.neko.data.TodayView
import dev.johnlaff.neko.widget.PREVIEW
import dev.johnlaff.neko.widget.TodayWidget
import dev.johnlaff.neko.widget.widgetText
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** The widget in its three sizes, drawn through RemoteViews as the launcher would. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w412dp-h915dp-xxhdpi", application = android.app.Application::class)
class WidgetShotTest {
    private val view: TodayView = readJson(File("src/test/resources/today.json"), TodayView.serializer())

    @OptIn(ExperimentalGlanceApi::class)
    private fun draw(name: String, size: DpSize, night: Boolean, text: dev.johnlaff.neko.widget.WidgetText) = runBlocking {
        RuntimeEnvironment.setQualifiers(if (night) "+night" else "+notnight")
        val context = ApplicationProvider.getApplicationContext<Context>()
        val widget = object : GlanceAppWidget() {
            override suspend fun provideGlance(context: Context, id: GlanceId) {
                provideContent { TodayWidget().Content(text) }
            }
        }
        val remote = widget.compose(context, size = size)
        val density = context.resources.displayMetrics.density
        val host = FrameLayout(context)
        val child = remote.apply(context, host)
        host.addView(child, FrameLayout.LayoutParams((size.width.value * density).toInt(), (size.height.value * density).toInt()))
        host.measure(
            android.view.View.MeasureSpec.makeMeasureSpec((size.width.value * density).toInt(), android.view.View.MeasureSpec.EXACTLY),
            android.view.View.MeasureSpec.makeMeasureSpec((size.height.value * density).toInt(), android.view.View.MeasureSpec.EXACTLY),
        )
        host.layout(0, 0, host.measuredWidth, host.measuredHeight)
        // No activity hosts a widget here, so draw it straight to a bitmap, as the launcher does.
        val bitmap = android.graphics.Bitmap.createBitmap(host.width, host.height, android.graphics.Bitmap.Config.ARGB_8888)
        host.draw(android.graphics.Canvas(bitmap))
        bitmap.captureRoboImage("screenshots/widget/$name.png")
    }

    @Test fun small() = draw("small-dark", DpSize(140.dp, 70.dp), true, widgetText(view))

    @Test fun wide() = draw("wide-light", DpSize(300.dp, 80.dp), false, widgetText(view))

    @Test fun tall() = draw("tall-dark", DpSize(300.dp, 190.dp), true, widgetText(view))

    @Test fun preview() = draw("preview-light", DpSize(300.dp, 190.dp), false, PREVIEW)
}
