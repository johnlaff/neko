package dev.johnlaff.neko.share

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import androidx.core.graphics.createBitmap
import androidx.core.graphics.withTranslation
import dev.johnlaff.neko.R
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * A closed month's wins as a picture to share, as on the site (web/Wins.tsx): 1080×1350, the
 * brand mark and the wins, never an amount. What is shared is the achievement, not the
 * finances.
 */
object WinCard {
    private const val W = 1080
    private const val H = 1350
    private const val BG = 0xFFF6F5F1.toInt()
    private const val MUTED = 0xFF57534E.toInt()
    private const val POS = 0xFF2A7548.toInt()
    private const val INK = 0xFF1C1A17.toInt()

    /** Word-wraps `text` to `width` pixels. */
    internal fun wrap(text: String, width: Float, measure: (String) -> Float): List<String> {
        val out = mutableListOf<String>()
        var line = ""
        for (word in text.split(" ")) {
            val next = if (line.isEmpty()) word else "$line $word"
            if (line.isNotEmpty() && measure(next) > width) {
                out += line
                line = word
            } else {
                line = next
            }
        }
        if (line.isNotEmpty()) out += line
        return out
    }

    /** The brand mark (ui/BrandMark.kt) drawn `width` pixels wide with its top-left at x, y. */
    private fun drawMark(c: Canvas, x: Float, y: Float, width: Float) {
        val line = Path().apply {
            moveTo(18f, 78f); lineTo(30f, 78f); lineTo(35f, 37f); lineTo(48f, 50f)
            lineTo(58f, 50f); lineTo(71f, 37f); lineTo(76f, 66f); lineTo(90f, 66f)
        }
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 6f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            color = INK
        }
        val eye = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = POS }
        val k = width / 80f
        c.withTranslation(x - 14f * k, y - 31f * k) {
            scale(k, k)
            drawPath(line, stroke)
            for (cx in listOf(46.5f, 59.5f)) drawOval(cx - 2.4f, 56f, cx + 2.4f, 67f, eye)
        }
    }

    fun draw(context: Context, title: String, wins: List<String>): Bitmap {
        val font = ResourcesCompat.getFont(context, R.font.geist) ?: Typeface.DEFAULT
        fun paint(size: Float, weight: Int, color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.create(font, weight, false)
            textSize = size
            textAlign = Paint.Align.CENTER
            this.color = color
        }
        val head = paint(44f, 500, MUTED)
        val win = paint(56f, 600, INK)
        val foot = paint(36f, 500, MUTED)
        val rows = wins.flatMapIndexed { i, w -> (if (i > 0) listOf("") else emptyList()) + wrap(w, W - 160f, win::measureText) }
        val rowsH = rows.sumOf { if (it.isEmpty()) 28 else 68 }
        val markW = 200f
        val markH = markW * 52f / 80f
        val bmp = createBitmap(W, H)
        val c = Canvas(bmp)
        c.drawColor(BG)
        // Mark, title and wins as one block above the footer.
        var y = maxOf(60f, (H - 140 - (markH + 80 + 44 + 90 + rowsH)) / 2f)
        drawMark(c, (W - markW) / 2f, y, markW)
        y += markH + 80 + 44
        c.drawText(title, W / 2f, y, head)
        y += 90
        for (r in rows) {
            if (r.isNotEmpty()) c.drawText(r, W / 2f, y, win)
            y += if (r.isEmpty()) 28 else 68
        }
        c.drawText("Neko · direto da minha planilha", W / 2f, H - 80f, foot)
        return bmp
    }

    /**
     * Opens the share sheet with the picture, kept in the app's cache (never in the gallery). The
     * drawing and the PNG run off the main thread.
     */
    suspend fun share(context: Context, title: String, wins: List<String>) {
        val uri = withContext(Dispatchers.Default) {
            val dir = File(context.cacheDir, "share").apply { mkdirs() }
            val file = File(dir, "neko-conquista.png")
            val bmp = draw(context, title, wins)
            try {
                file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            } finally {
                bmp.recycle()
            }
            FileProvider.getUriForFile(context, "${context.packageName}.share", file)
        }
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
