package dev.johnlaff.neko.share

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import androidx.core.graphics.createBitmap
import dev.johnlaff.neko.R
import java.io.File

/**
 * A closed month's wins as a picture to share, as on the site (web/Wins.tsx): 1080×1350, the
 * celebrating Neko and the wins, never an amount. What is shared is the achievement, not the
 * finances.
 */
object WinCard {
    private const val W = 1080
    private const val H = 1350
    private const val BG = 0xFFF6F5F1.toInt()
    private const val MUTED = 0xFF57534E.toInt()
    private const val POS = 0xFF2A7548.toInt()

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

    fun draw(context: Context, title: String, wins: List<String>): Bitmap {
        val font = ResourcesCompat.getFont(context, R.font.geist) ?: Typeface.DEFAULT
        fun paint(size: Float, weight: Int, color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.create(font, weight, false)
            textSize = size
            textAlign = Paint.Align.CENTER
            this.color = color
        }
        val head = paint(44f, 500, MUTED)
        val win = paint(56f, 650, POS)
        val foot = paint(36f, 500, MUTED)
        val rows = wins.flatMapIndexed { i, w -> (if (i > 0) listOf("") else emptyList()) + wrap(w, W - 160f, win::measureText) }
        val rowsH = rows.sumOf { if (it.isEmpty()) 28 else 68 }
        val catH = 560
        val bmp = createBitmap(W, H)
        val c = Canvas(bmp)
        c.drawColor(BG)
        // Title, cat and wins as one block, centred above the footer.
        var y = maxOf(60f, (H - 140 - (44 + 40 + catH + 90 + rowsH)) / 2f) + 44
        c.drawText("$title fechou", W / 2f, y, head)
        ContextCompat.getDrawable(context, R.drawable.mascot_neko_comemorando)?.let { d ->
            val catW = d.intrinsicWidth * catH / d.intrinsicHeight
            val left = (W - catW) / 2
            val top = (y + 40).toInt()
            d.setBounds(left, top, left + catW, top + catH)
            d.draw(c)
        }
        y += 40 + catH + 90
        for (r in rows) {
            if (r.isNotEmpty()) c.drawText(r, W / 2f, y, win)
            y += if (r.isEmpty()) 28 else 68
        }
        c.drawText("Neko · direto da minha planilha", W / 2f, H - 80f, foot)
        return bmp
    }

    /** Opens the share sheet with the picture, kept in the app's cache (never in the gallery). */
    fun share(context: Context, title: String, wins: List<String>) {
        val dir = File(context.cacheDir, "share").apply { mkdirs() }
        val file = File(dir, "neko-conquista.png")
        file.outputStream().use { draw(context, title, wins).compress(Bitmap.CompressFormat.PNG, 100, it) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.share", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "image/png"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(send, "$title fechou").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
