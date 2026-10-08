package dev.johnlaff.neko

import dev.johnlaff.neko.data.SealedFile
import java.io.File
import java.nio.file.Files
import javax.crypto.KeyGenerator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class SealedFileTest {
    private val dir = Files.createTempDirectory("sealed").toFile()
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    @Test fun roundTripsAndHidesTheText() {
        val file = File(dir, "cookies")
        SealedFile(file, lazyOf(key)).write("session=abc")
        assertEquals("session=abc", SealedFile(file, lazyOf(key)).read())
        assertFalse(file.readBytes().decodeToString().contains("session"))
    }

    @Test fun readsAFileWrittenBeforeSealingThenSealsIt() {
        val file = File(dir, "today.json").apply { writeText("{\"a\":1}") }
        val sealed = SealedFile(file, lazyOf(key))
        assertEquals("{\"a\":1}", sealed.read())
        sealed.write(sealed.read()!!)
        assertFalse(file.readBytes().decodeToString().contains("\"a\""))
        assertEquals("{\"a\":1}", sealed.read())
    }

    @Test fun aChangedOrForeignFileReadsAsEmpty() {
        val file = File(dir, "cookies")
        SealedFile(file, lazyOf(key)).write("session=abc")
        val other = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        assertNull(SealedFile(file, lazyOf(other)).read())
        val bytes = file.readBytes().also { it[it.size - 1] = (it.last() + 1).toByte() }
        file.writeBytes(bytes)
        assertNull(SealedFile(file, lazyOf(key)).read())
    }

    @Test fun missingFileIsNull() {
        assertNull(SealedFile(File(dir, "none"), lazyOf(key)).read())
    }
}
