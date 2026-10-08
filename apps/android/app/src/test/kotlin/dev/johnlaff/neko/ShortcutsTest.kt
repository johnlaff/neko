package dev.johnlaff.neko

import dev.johnlaff.neko.shortcuts.Launch
import dev.johnlaff.neko.shortcuts.launchFor
import dev.johnlaff.neko.ui.Tab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShortcutsTest {
    @Test fun eachShortcutOpensItsPlace() {
        assertEquals(Launch(Tab.Hoje, simulate = true), launchFor("dev.johnlaff.neko.SIMULAR"))
        assertEquals(Launch(Tab.Faturas), launchFor("dev.johnlaff.neko.FATURAS"))
        assertEquals(Launch(Tab.Mes), launchFor("dev.johnlaff.neko.MES"))
    }

    @Test fun theLauncherIconOpensWhereTheAppWas() {
        assertNull(launchFor("android.intent.action.MAIN"))
        assertNull(launchFor(null))
    }

    @Test fun everyActionInShortcutsXmlIsHandled() {
        val xml = java.io.File("src/main/res/xml/shortcuts.xml").readText()
        Regex("""android:action="([^"]+)"""").findAll(xml).forEach { m ->
            assert(launchFor(m.groupValues[1]) != null) { "${m.groupValues[1]} opens nothing" }
        }
    }
}
