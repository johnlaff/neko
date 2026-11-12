package dev.johnlaff.neko

import dev.johnlaff.neko.data.Mia2Ask
import dev.johnlaff.neko.data.Mia2Line
import dev.johnlaff.neko.data.json
import dev.johnlaff.neko.ui.Mia2Block
import dev.johnlaff.neko.ui.Mia2Chat
import dev.johnlaff.neko.ui.Mia2Desenho
import dev.johnlaff.neko.ui.Mia2Talk
import dev.johnlaff.neko.ui.Mia2Texto
import dev.johnlaff.neko.ui.mia2Blocks
import dev.johnlaff.neko.ui.mia2Next
import dev.johnlaff.neko.ui.mia2Sources
import java.io.File
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.job
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mia 2's conversation as the app keeps it, fed with the lines the Worker sends: the file is
 * written by the site's tests (apps/neko/test/mia2.test.ts), so a renamed field fails here.
 */
class Mia2ChatTest {
    private fun lines(file: String) =
        File("src/test/resources/$file").readLines().filter { it.isNotBlank() }.map { json.decodeFromString(Mia2Line.serializer(), it) }

    private class Talk(val answer: (Mia2Ask) -> Flow<Mia2Line>) : Mia2Talk {
        val asked = mutableListOf<Mia2Ask>()
        val stopped = mutableListOf<String>()
        override fun ask(ask: Mia2Ask): Flow<Mia2Line> = answer(ask).also { asked += ask }
        override suspend fun stop(sessao: String) {
            stopped += sessao
        }
    }

    @Test fun readsTheWorkersAnswer() = runBlocking {
        val chat = Mia2Chat()
        val talk = Talk { lines("mia2.ndjson").asFlow() }
        chat.ask("Como foram os últimos meses?", this, talk)
        // runBlocking waits for the answer to be read.
        coroutineContext.job.children.forEach { it.join() }
        assertNull(chat.pending)
        assertEquals("sesn_0000000001", chat.sessao)
        val t = chat.turns.single()
        assertNull(t.end)
        val text = t.parts[0] as Mia2Texto
        assertTrue(text.valores!!.getValue("R$ 4.180,40").conferido)
        assertEquals("2026-10", text.valores!!.getValue("R$ 4.180,40").mes)
        val chart = (t.parts[1] as Mia2Desenho).grafico
        assertEquals(listOf(4630.55, 4180.4), chart.series.single().valores)
        val board = (t.parts[2] as dev.johnlaff.neko.ui.Mia2Numeros).numeros
        assertEquals(listOf("Saídas de outubro", "Saídas de setembro"), board.map { it.rotulo })
        assertEquals("o mês mais caro", board[1].nota)
        assertEquals(listOf("Ver outubro", "Ver setembro"), mia2Sources(t).map { it.label })
        // The next question goes to the same conversation.
        chat.ask("E setembro?", this, talk)
        coroutineContext.job.children.forEach { it.join() }
        assertEquals("sesn_0000000001", talk.asked.last().sessao)
    }

    /** GET /api/mia2/rotina, as the site's tests write it (apps/neko/test/mia2.test.ts). */
    @Test fun herRoutineBecomesTheConversation() = runBlocking {
        val view = json.decodeFromString(
            dev.johnlaff.neko.data.Mia2RotinaView.serializer(),
            File("src/test/resources/mia2-rotina.json").readText(),
        )
        val r = view.rotina!!
        val chat = Mia2Chat()
        val talk = Talk { flowOf(Mia2Line("fim")) }
        chat.ask("Quanto vem nas faturas?", this, talk)
        coroutineContext.job.children.forEach { it.join() }
        assertTrue(chat.takeRoutine(r))
        val t = chat.turns.single()
        assertEquals("Semana de 8 a 14 nov", t.pergunta)
        assertEquals("semana", t.rotina)
        // What one asks next is about that week first.
        assertEquals(
            listOf("Quanto vem nas próximas faturas?", "Este mês está melhor que o anterior?"),
            mia2Next(listOf(t.pergunta), rotina = t.rotina),
        )
        assertTrue((t.parts[0] as Mia2Texto).valores!!.getValue("R$ 812,40").conferido)
        assertEquals(listOf("Na semana", "Cabe no teto"), (t.parts[1] as dev.johnlaff.neko.ui.Mia2Numeros).numeros.map { it.rotulo })
        // The conversation that was open waits for Desfazer, and the next question goes on in hers.
        assertEquals(listOf("Quanto vem nas faturas?"), chat.cleared!!.second.map { it.pergunta })
        chat.ask("E a fatura de dezembro?", this, talk)
        coroutineContext.job.children.forEach { it.join() }
        assertEquals("sesn_0000000001", talk.asked.last().sessao)
        assertEquals(listOf(0, 1), chat.turns.map { it.n })
    }

    @Test fun aFailureKeepsTheQuestionAndAsksItAgainInPlace() = runBlocking {
        var fail = true
        val chat = Mia2Chat()
        val talk = Talk {
            flow {
                emit(Mia2Line("parcial", id = "m1", texto = "Outubro"))
                if (fail) emit(Mia2Line("erro", motivo = "falha")) else emit(Mia2Line("fim"))
            }
        }
        chat.ask("Quanto vem nas faturas?", this, talk)
        coroutineContext.job.children.forEach { it.join() }
        val t = chat.turns.single()
        assertEquals("falhou", t.end)
        assertTrue(t.parts.isEmpty())
        fail = false
        chat.retry(this, talk)
        coroutineContext.job.children.forEach { it.join() }
        assertEquals(listOf("Quanto vem nas faturas?"), chat.turns.map { it.pergunta })
        assertNull(chat.turns.single().end)
    }

    @Test fun stopKeepsWhatSheWrote() {
        val chat = Mia2Chat()
        val talk = Talk { flow { kotlinx.coroutines.awaitCancellation() } }
        runBlocking {
            chat.ask("Oi", this, talk)
            chat.take(0, Mia2Line("sessao", id = "sesn_0000000009"))
            chat.take(0, Mia2Line("parcial", id = "m1", texto = "Você tem"))
            chat.stop(this, talk)
        }
        assertEquals("parou", chat.turns.single().end)
        assertEquals("Você tem", (chat.turns.single().parts.single() as Mia2Texto).texto)
        assertEquals(listOf("sesn_0000000009"), talk.stopped)
        assertNull(chat.pending)
    }

    @Test fun aQuestionSentWhileSheAnswersGoesWhenSheIsDone() = runBlocking {
        val chat = Mia2Chat()
        val talk = Talk { listOf(Mia2Line("mensagem", id = "m1", texto = "Pronto.", valores = emptyMap()), Mia2Line("fim")).asFlow() }
        chat.ask("Oi", this, talk)
        // Typed and sent before she starts: it waits.
        chat.typed = "E setembro?"
        chat.held = true
        coroutineContext.job.children.forEach { it.join() }
        coroutineContext.job.children.forEach { it.join() }
        assertEquals(listOf("Oi", "E setembro?"), chat.turns.map { it.pergunta })
        assertEquals(false, chat.held)
    }

    @Test fun parouKeepsAHeldQuestionInTheFieldUnsent() {
        val chat = Mia2Chat()
        val talk = Talk { flow { kotlinx.coroutines.awaitCancellation() } }
        runBlocking {
            chat.ask("Quanto ainda cabe?", this, talk)
            // She has started answering.
            kotlinx.coroutines.yield()
            chat.typed = "E a fatura de dezembro?"
            chat.held = true
            chat.stop(this, talk)
        }
        assertEquals(listOf("Quanto ainda cabe?"), talk.asked.map { it.pergunta })
        assertEquals("E a fatura de dezembro?", chat.typed)
        assertEquals(false, chat.held)
        assertEquals("parou", chat.turns.single().end)
    }

    @Test fun aStoppedAnswerIsAskedAgainInPlace() = runBlocking {
        val chat = Mia2Chat()
        chat.turns = listOf(dev.johnlaff.neko.ui.Mia2Turno(0, "Oi", listOf(Mia2Texto("m1", "Ainda cabem R$ 1.240", null)), "parou"))
        assertTrue(dev.johnlaff.neko.ui.mia2StoppedValues(chat.turns.single()))
        chat.retry(this, Talk { listOf(Mia2Line("fim")).asFlow() })
        coroutineContext.job.children.forEach { it.join() }
        assertEquals(listOf("Oi"), chat.turns.map { it.pergunta })
        assertNull(chat.turns.single().end)
    }

    @Test fun newConversationCanBeUndone() {
        val chat = Mia2Chat()
        chat.sessao = "sesn_0000000001"
        chat.turns = listOf(dev.johnlaff.neko.ui.Mia2Turno(0, "Oi"))
        chat.clear()
        assertTrue(chat.turns.isEmpty())
        chat.undoClear()
        assertEquals("sesn_0000000001", chat.sessao)
        assertEquals(listOf("Oi"), chat.turns.map { it.pergunta })
        assertNull(chat.cleared)
    }

    @Test fun theMonthsCapKeepsTheQuestionForWhenSheIsBack() = runBlocking {
        val chat = Mia2Chat()
        chat.ask("Oi", this, Talk { listOf(Mia2Line("erro", motivo = "limite_mes")).asFlow() })
        coroutineContext.job.children.forEach { it.join() }
        assertTrue(chat.limited)
        assertEquals("descansa", chat.turns.single().end)
    }

    @Test fun aDroppedConnectionIsNotHerFailure() = runBlocking {
        val chat = Mia2Chat()
        chat.ask("Oi", this, Talk { flow { emit(Mia2Line("parcial", id = "m1", texto = "Ou")); throw java.io.IOException("reset") } })
        coroutineContext.job.children.forEach { it.join() }
        assertEquals("rede", chat.turns.single().end)
    }

    @Test fun aRedoStartsTheAnswerOver() {
        val chat = Mia2Chat()
        chat.turns = listOf(dev.johnlaff.neko.ui.Mia2Turno(0, "Oi", listOf(Mia2Texto("m1", "R$ 320", emptyMap()))))
        chat.take(0, Mia2Line("refazendo"))
        assertTrue(chat.turns.single().parts.isEmpty())
        assertTrue(chat.take(0, Mia2Line("erro", motivo = "limite_conversa")))
        assertEquals("cheia", chat.turns.single().end)
    }

    @Test fun herTextIsParagraphsAndListsOnly() {
        assertEquals(
            listOf(
                Mia2Block(false, listOf("Outubro fechou em **R$ 4.180,40**.")),
                Mia2Block(true, listOf("Faturas: R$ 3.020,15", "Pix: R$ 1.160,25")),
                Mia2Block(false, listOf("Resumo", "Novembro vai melhor.")),
            ),
            mia2Blocks("Outubro fechou em **R$ 4.180,40**.\n\n- Faturas: R$ 3.020,15\n* Pix: R$ 1.160,25\n\n## Resumo\nNovembro vai melhor."),
        )
        // A bold still being written shows plain until it closes.
        assertEquals(listOf(Mia2Block(false, listOf("Você tem R$ 1."))), mia2Blocks("Você tem **R$ 1."))
    }

    @Test fun aTypedQuestionIsNotSuggestedAgain() {
        assertTrue(mia2Next(listOf("como foram meus últimos 6 meses")).none { it.startsWith("Como foram") })
    }
}
