package dev.johnlaff.neko

import dev.johnlaff.neko.data.HealthIssue
import dev.johnlaff.neko.data.Insight
import dev.johnlaff.neko.data.Win
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.ui.Copy
import dev.johnlaff.neko.ui.Format
import dev.johnlaff.neko.ui.Learn
import java.io.File
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Every sentence and label the site and the app both show, as the site says it (written by
 * apps/neko/test/copy.test.ts): a word changed on one side only fails here.
 */
class CopyContractTest {
    private val c = json.parseToJsonElement(File("src/test/resources/copy.json").readText()).jsonObject

    private fun JsonObject.obj(key: String) = getValue(key).jsonObject
    private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content
    private fun JsonObject.cases(key: String): List<JsonArray> = getValue(key).jsonArray.map { it.jsonArray }
    private val JsonElement.s get() = jsonPrimitive.content

    @Test fun learn() {
        val l = c.obj("learn")
        val hints = l.obj("hints")
        assertEquals(hints.str("hoje"), Learn.HOJE)
        assertEquals(hints.str("hojeMes"), Learn.HOJE_MES)
        assertEquals(hints.str("hojeCartoes"), Learn.HOJE_CARTOES)
        assertEquals(hints.str("faturas"), Learn.FATURAS)
        assertEquals(hints.str("mes"), Learn.MES)
        assertEquals(l.str("intro"), Learn.INTRO)
        assertEquals(l.str("cardsComeFrom"), Learn.CARDS_COME_FROM)
        assertEquals(
            l.getValue("ideas").jsonArray.map { it.jsonObject.let { i -> Learn.Idea(i.str("title"), i.str("body")) } },
            Learn.IDEAS,
        )

        val habit = l.obj("habit")
        assertEquals(habit.str("rule"), Learn.HABIT_RULE)
        assertEquals(habit.str("atRisk"), Learn.HABIT_AT_RISK)
        assertEquals(habit.obj("days").mapValues { it.value.s }, Learn.HABIT_DAYS)
        habit.obj("milestones").forEach { (m, text) -> assertEquals(text.s, Learn.milestone(m.toInt())) }

        val reserve = l.obj("reserve")
        assertEquals(reserve.str("title"), Learn.RESERVE_TITLE)
        assertEquals(reserve.str("rule"), Learn.RESERVE_RULE)
        assertEquals(reserve.str("empty"), Learn.RESERVE_EMPTY)

        val totals = l.obj("totals")
        assertEquals(totals.str("saved"), Learn.SAVED)
        assertEquals(totals.str("nothingSaved"), Learn.NOTHING_SAVED)
        assertEquals(totals.str("goal"), Learn.SAVE_GOAL)
        assertEquals(totals.str("daily"), Learn.DAILY)
        assertEquals(totals.str("cost"), Learn.COST)
        assertEquals(totals.str("costNote"), Learn.COST_NOTE)
        assertEquals(totals.str("dailyNote"), Learn.DAILY_NOTE)
    }

    @Test fun format() {
        val f = c.obj("format")
        f.cases("money").forEach { (cents, want) -> assertEquals(want.s, Format.money(cents.jsonPrimitive.long)) }
        f.cases("signed").forEach { (cents, sign, want) ->
            assertEquals(want.s, Format.signed(cents.jsonPrimitive.long, sign.s.single()))
        }
        f.cases("shortDate").forEach { (d, want) -> assertEquals(want.s, Format.shortDate(d.s)) }
        f.cases("relativeDay").forEach { (d, today, want) -> assertEquals(want.s, Format.relativeDay(d.s, today.s)) }
        f.cases("days").forEach { (n, want) -> assertEquals(want.s, Format.days(n.jsonPrimitive.int)) }
        f.cases("closesIn").forEach { (n, want) -> assertEquals(want.s, Format.closesIn(n.jsonPrimitive.int)) }
        f.cases("bankText").forEach { (t, want) -> assertEquals(want.s, Format.bankText(t.s)) }
        f.cases("merchantName").forEach { (t, want) -> assertEquals(want.s, Format.merchantName(t.s)) }
    }

    @Test fun labels() {
        val l = c.obj("labels")
        l.cases("streak").forEach { (n, want) -> assertEquals(want.s, Learn.streakLabel(n.jsonPrimitive.int)) }
        l.cases("milestone").forEach { (m, want) -> assertEquals(want.s, Learn.milestone(m.jsonPrimitive.int)) }
        l.cases("covered").forEach { (t, want) -> assertEquals(want.s, Learn.coveredLabel(t.jsonPrimitive.int)) }
        l.cases("cost").forEach { (m, want) -> assertEquals(want.s, Learn.costLabel(m.jsonPrimitive.int)) }
        l.cases("result").forEach { (down, want) -> assertEquals(want.s, Learn.resultNote(down.jsonPrimitive.boolean)) }
        l.cases("dailySource").forEach { (s, want) -> assertEquals(want.s, Copy.dailySource(s.s)) }
    }

    @Test fun warnings() {
        c.getValue("insights").jsonArray.map { it.jsonObject }.forEach { o ->
            val line = Copy.insight(json.decodeFromJsonElement(Insight.serializer(), o.getValue("insight")))
            assertEquals(o.str("title"), line?.title)
            assertEquals(o.str("detail"), line?.detail)
        }
        c.getValue("issues").jsonArray.map { it.jsonObject }.forEach { o ->
            val line = Copy.issue(json.decodeFromJsonElement(HealthIssue.serializer(), o.getValue("issue")))
            assertEquals(o.str("title"), line.title)
            assertEquals(o.str("detail"), line.detail)
        }
    }

    @Test fun wins() {
        c.getValue("wins").jsonArray.map { it.jsonObject }.forEach { o ->
            val win = json.decodeFromJsonElement(Win.serializer(), o.getValue("win"))
            assertEquals(o.str("text"), Copy.win(win))
            assertEquals(o.str("share"), Copy.winShare(win))
        }
    }
}
