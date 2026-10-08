package dev.johnlaff.neko.ui

import android.graphics.ImageDecoder
import android.graphics.drawable.AnimatedImageDrawable
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import dev.johnlaff.neko.R

/**
 * Neko (the brown tabby) and Mia (the cream one with glasses), drawn from the owner's two cats,
 * the same transparent pictures as the site (web/Mascot.tsx). Decorative: whatever sits next to
 * the cat says the same in words, so it has no content description.
 */
enum class Pose(@param:DrawableRes val res: Int, val ratio: Float) {
    Sitting(R.drawable.mascot_neko_sentado, 288f / 480f),
    Sleeping(R.drawable.mascot_neko_dormindo, 480f / 318f),
    Celebrating(R.drawable.mascot_neko_comemorando, 330f / 480f),
    MiaThinking(R.drawable.mascot_mia_pensando, 298f / 480f),
}

@Composable
fun Mascot(pose: Pose, modifier: Modifier = Modifier) {
    Image(painterResource(pose.res), null, modifier.aspectRatio(pose.ratio))
}

private const val BlinkRatio = 190f / 300f

/**
 * The login cat: Neko sits and blinks slowly, the cat way of saying "you are safe here". An
 * animated WebP played by the platform decoder; still when "Remove animations" is on or the
 * decoder can't play it (as in the JVM screenshot tests).
 */
@Composable
fun BlinkingCat(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val drawable = remember {
        val still = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        if (still) null
        else runCatching {
            ImageDecoder.decodeDrawable(ImageDecoder.createSource(context.resources, R.raw.neko_piscando)) as? AnimatedImageDrawable
        }.getOrNull()
    }
    if (drawable == null) {
        Image(painterResource(R.drawable.mascot_neko_piscando_parado), null, modifier.aspectRatio(BlinkRatio))
        return
    }
    // Each new frame bumps the counter the canvas reads, so only the canvas redraws.
    var frame by remember { mutableIntStateOf(0) }
    DisposableEffect(drawable) {
        val handler = Handler(Looper.getMainLooper())
        drawable.callback = object : Drawable.Callback {
            override fun invalidateDrawable(who: Drawable) { frame++ }
            override fun scheduleDrawable(who: Drawable, what: Runnable, `when`: Long) { handler.postAtTime(what, `when`) }
            override fun unscheduleDrawable(who: Drawable, what: Runnable) { handler.removeCallbacks(what) }
        }
        drawable.repeatCount = AnimatedImageDrawable.REPEAT_INFINITE
        drawable.start()
        onDispose {
            drawable.stop()
            drawable.callback = null
        }
    }
    Canvas(modifier.aspectRatio(BlinkRatio)) {
        frame
        drawable.setBounds(0, 0, size.width.toInt(), size.height.toInt())
        drawIntoCanvas { drawable.draw(it.nativeCanvas) }
    }
}
