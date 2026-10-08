package dev.johnlaff.neko.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * What a sheet line is about, read from its description, so each line gets an icon you know at a
 * glance (a house for the rent, a cap for the college) instead of one receipt for every bill.
 * Display only. The same table and matching as the site's shared/categories.ts; ScreensContractTest
 * reads its cases from the Worker's tests. `icon` is one stroke path on a 24px grid.
 */
data class Category(val slug: String, val words: List<String>, val icon: String)

/** The first match wins. */
val CATEGORIES = listOf(
    Category(
        "salario",
        listOf("salario", "ordenado", "holerite", "adiantamento", "plr", "decimo terceiro", "ferias", "bonus", "freela", "freelance"),
        "M4.5 7.5h15A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5zM9 7.5v-2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12.5h18",
    ),
    Category(
        "poupanca",
        listOf("poupanca", "reserva", "investimento", "investimentos", "previdencia", "tesouro", "cdb", "aporte", "caixinha"),
        "M5 12c0-3.6 3.1-6 7.3-6 3 0 5.4 1.2 6.6 3.2h1.6v4h-1.4c-.5 1.2-1.4 2.2-2.6 2.9V19h-2.5v-2.2c-.6.1-1.3.2-2 .2s-1.4-.1-2-.2V19H7.5v-3.1C6 14.9 5 13.6 5 12zM10 8.8h3.5M16 11h.01M5 12H3.5",
    ),
    Category(
        "transporte",
        listOf("uber", "99", "taxi", "onibus", "metro", "gasolina", "combustivel", "etanol", "posto", "estacionamento", "pedagio", "ipva", "licenciamento", "carro", "moto", "oficina", "auto"),
        "M4 16.5V12l1.8-4.6a1.5 1.5 0 0 1 1.4-.9h9.6a1.5 1.5 0 0 1 1.4.9L20 12v4.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 12h16M7.5 17.5v2M16.5 17.5v2M7.5 14.5h1M15.5 14.5h1",
    ),
    Category(
        "casa",
        listOf("aluguel", "condominio", "iptu", "moradia", "financiamento", "casa", "apartamento", "imobiliaria"),
        "M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z",
    ),
    Category(
        "luz",
        listOf("luz", "energia", "eletricidade", "cemig", "enel", "copel", "celpe", "coelba", "cpfl", "equatorial", "neoenergia"),
        "M13 3 5 13.5h6L10 21l8-10.5h-6z",
    ),
    Category(
        "agua",
        listOf("agua", "saneamento", "esgoto", "copasa", "sabesp", "cedae", "sanepar", "embasa", "daae", "codau"),
        "M12 3.5c3.5 4.2 6 7.5 6 10.5a6 6 0 0 1-12 0c0-3 2.5-6.3 6-10.5z",
    ),
    Category(
        "gas",
        listOf("gas", "botijao", "comgas"),
        "M12 2.5c.8 3.3 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-3 1.8-4.8 3-6 .3 1.8 1.2 3 2.4 3.6.6-3 .6-5.8.1-8.6z",
    ),
    Category(
        "internet",
        listOf("internet", "wifi", "wi fi", "fibra", "banda larga", "provedor"),
        "M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01",
    ),
    Category(
        "celular",
        listOf("celular", "telefone", "vivo", "tim", "claro", "recarga"),
        "M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM11 18h2",
    ),
    Category(
        "estudo",
        listOf("faculdade", "uniube", "universidade", "escola", "colegio", "curso", "cursos", "ingles", "aula", "aulas", "pos", "mba", "livro", "livros", "educacao", "estudo", "estudos"),
        "M2.5 9 12 4.5 21.5 9 12 13.5zM6.5 11v4.5c1.5 1.5 3.5 2.5 5.5 2.5s4-1 5.5-2.5V11M21.5 9v5",
    ),
    Category(
        "academia",
        listOf("academia", "gym", "smart fit", "smartfit", "crossfit", "pilates", "natacao", "treino", "personal"),
        "M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11",
    ),
    Category(
        "saude",
        listOf("saude", "plano de saude", "unimed", "amil", "hapvida", "bradesco saude", "sulamerica", "farmacia", "drogaria", "remedio", "remedios", "medico", "consulta", "dentista", "exame", "exames", "psicologo", "terapia", "hospital"),
        "M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20zM7.5 12.5h2.5l1.5-2.5 2 4 1.5-1.5h1.5",
    ),
    Category(
        "mercado",
        listOf("mercado", "supermercado", "feira", "hortifruti", "sacolao", "acougue", "padaria", "atacadao", "assai", "carrefour", "compras do mes"),
        "M3.5 9.5h17l-1.8 9a1.5 1.5 0 0 1-1.5 1.2H6.8a1.5 1.5 0 0 1-1.5-1.2zM8 9.5l3-6M16 9.5l-3-6M9 13v3.5M12 13v3.5M15 13v3.5",
    ),
    Category(
        "comida",
        listOf("restaurante", "ifood", "lanche", "lanchonete", "pizza", "delivery", "almoco", "jantar", "rappi", "cafe"),
        "M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 1-3.5 3.5-3.5 7v3H17",
    ),
    Category(
        "assinatura",
        listOf("netflix", "spotify", "youtube", "disney", "prime video", "hbo", "max", "globoplay", "deezer", "icloud", "google one", "chatgpt", "claude", "assinatura", "assinaturas", "streaming", "apple"),
        "M4.5 5.5h15A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17V7a1.5 1.5 0 0 1 1.5-1.5zM10 9.5v5l4.5-2.5z",
    ),
    Category(
        "pet",
        listOf("pet", "petshop", "racao", "veterinario", "vet", "gato", "gatos", "cachorro", "areia"),
        "M12 13c-2.5 0-5 3-5 5a2 2 0 0 0 2 2c1.2 0 2-.6 3-.6s1.8.6 3 .6a2 2 0 0 0 2-2c0-2-2.5-5-5-5zM4.5 10.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0M8 7a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0M13 7a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0M16.5 10.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0",
    ),
    Category(
        "imposto",
        listOf("imposto", "impostos", "darf", "irpf", "inss", "mei", "receita federal"),
        "M3.5 20.5h17M4.5 9.5h15L12 4zM6.5 9.5v8M10 9.5v8M14 9.5v8M17.5 9.5v8",
    ),
    Category(
        "seguro",
        listOf("seguro", "seguros"),
        "M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z",
    ),
    Category(
        "viagem",
        listOf("viagem", "viagens", "passagem", "passagens", "hotel", "airbnb", "voo", "hospedagem"),
        "M21 3 3 10.5l7 2.5 2.5 7zM10 13l4.5-4.5",
    ),
    Category(
        "beleza",
        listOf("cabelo", "cabeleireiro", "barbearia", "barbeiro", "salao", "manicure", "estetica"),
        "M3.5 6.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M3.5 17.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0M8 8l12 10M8 16 20 6",
    ),
    Category(
        "roupa",
        listOf("roupa", "roupas", "vestuario", "calcado", "calcados", "tenis", "sapato"),
        "M8.5 3.5 4 6l1.5 4 2-1v11.5h9V9l2 1L20 6l-4.5-2.5a3.5 3.5 0 0 1-7 0z",
    ),
    Category(
        "compras",
        listOf("compras", "shopping", "loja", "magalu", "shopee", "shein", "aliexpress", "presente", "presentes"),
        "M5.5 7.5h13l1 13h-15zM9 10V6.5a3 3 0 0 1 6 0V10",
    ),
)

/** The kind of expense a line's description names, by whole words only ("Luz" yes, "Luzia" no). */
fun categoryOf(description: String): Category? {
    val w = wordsOf(description)
    return CATEGORIES.firstOrNull { c -> c.words.any { w.contains(" $it ") } }
}

private val icons = mutableMapOf<String, ImageVector>()

/**
 * The category's icon, drawn like the site's (web/CategoryIcon.tsx): a 1.75 stroke with round caps
 * and joins, no fill. Black here; Icon tints it. Built once per category.
 */
val Category.vector: ImageVector
    get() = icons.getOrPut(slug) {
        ImageVector.Builder(name = "category-$slug", defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
            .addPath(
                pathData = PathParser().parsePathString(icon).toNodes(),
                fill = null,
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.75f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
            .build()
    }

/** The icon for a line's text, or null when it names no known kind. */
fun categoryIcon(text: String): ImageVector? = categoryOf(text)?.vector
