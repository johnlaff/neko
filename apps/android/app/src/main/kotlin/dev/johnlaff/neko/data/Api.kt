package dev.johnlaff.neko.data

import java.io.IOException
import java.time.Duration
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.put
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

/** A refusal from the Worker: `code` is its `error` field ("unauthorized", "sheet-structure"…). */
class ApiException(val status: Int, val code: String, message: String) : IOException(message)

val json = Json { ignoreUnknownKeys = true }

/** The Worker's API, the same one the site uses. Every call runs off the main thread. */
class Api(
    private val baseUrl: String,
    private val client: OkHttpClient,
    private val cookies: CookieStore,
) {
    private val jsonType = "application/json".toMediaType()

    /** Mia's answer takes a few model calls, well past OkHttp's 10 s read timeout. */
    private val patient = client.newBuilder().readTimeout(MIA_WAIT).callTimeout(MIA_WAIT).build()

    private suspend fun call(
        path: String,
        body: RequestBody? = null,
        method: String? = null,
        via: OkHttpClient = client,
    ): String =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/api$path")
                .method(method ?: if (body != null) "POST" else "GET", body)
                .build()
            via.newCall(request).execute().use { res ->
                val text = res.body.string()
                if (!res.isSuccessful) {
                    val err = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                    throw ApiException(
                        res.code,
                        err?.get("error")?.jsonPrimitive?.content ?: "unknown",
                        err?.get("message")?.jsonPrimitive?.content ?: res.message,
                    )
                }
                text
            }
        }

    private fun JsonElement.asBody() = toString().toRequestBody(jsonType)

    suspend fun me(): Me = json.decodeFromString(call("/me"))

    suspend fun today(): TodayView = json.decodeFromString(call("/today"))

    suspend fun invoices(): InvoicesView = json.decodeFromString(call("/invoices"))

    suspend fun months(): MonthsView = json.decodeFromString(call("/months"))

    suspend fun ajustes(): AjustesView = json.decodeFromString(call("/ajustes"))

    suspend fun reminders(): RemindersView = json.decodeFromString(call("/reminders"))

    suspend fun history(): HistoryView = json.decodeFromString(call("/history"))

    suspend fun sessions(): List<Device> = json.decodeFromString(call("/sessions"))

    suspend fun endSession(id: String) {
        call("/sessions/${java.net.URLEncoder.encode(id, "UTF-8")}", method = "DELETE")
    }

    suspend fun endOtherSessions() {
        call("/sessions/others", method = "DELETE")
    }

    /** Null when the sheet has no usual card to put the purchase on. */
    suspend fun simulate(amount: Long, count: Int): InstallmentSimulation? =
        json.decodeFromString(call("/simulate?amount=$amount&count=$count"))

    suspend fun settings(): UserSettings = json.decodeFromString(call("/settings"))

    suspend fun saveSettings(settings: UserSettings): UserSettings {
        val body = json.encodeToString(UserSettings.serializer(), settings).toRequestBody(jsonType)
        return json.decodeFromString(call("/settings", body, "PUT"))
    }

    suspend fun banks(): BanksView = json.decodeFromString(call("/banks"))

    /** Replaces the linked banks; the Worker reads the new ones in the background. */
    suspend fun saveBanks(items: List<BankLink>) {
        val body = json.encodeToString(BanksBody.serializer(), BanksBody(items)).toRequestBody(jsonType)
        call("/banks", body, "PUT")
    }

    suspend fun saveBankCards(cards: List<BankCard>) {
        val body = json.encodeToString(BankCardsBody.serializer(), BankCardsBody(cards)).toRequestBody(jsonType)
        call("/banks/cards", body, "PUT")
    }

    /** The cells' fingerprints as they are now: the launch refuses if any changed since. */
    suspend fun preview(draft: JsonObject): List<String> {
        val body = JsonObject(mapOf("draft" to draft))
        val parts = json.parseToJsonElement(call("/entries/preview", body.asBody())).jsonObject["parts"]
        return parts?.jsonArray?.map { it.jsonObject["fingerprint"]!!.jsonPrimitive.content } ?: emptyList()
    }

    suspend fun launch(id: String, draft: JsonObject, fingerprints: List<String>, key: String?): LaunchResult {
        val body = buildJsonObject {
            put("id", id)
            put("draft", draft)
            put("fingerprints", JsonArray(fingerprints.map(::JsonPrimitive)))
            if (key != null) put("key", key)
        }
        return json.decodeFromString(call("/entries", body.asBody()))
    }

    suspend fun undo(id: String): LaunchResult =
        json.decodeFromString(call("/entries/$id/undo", JsonObject(emptyMap()).asBody()))

    suspend fun ignore(key: String) {
        call("/queue/ignore", buildJsonObject { put("key", key) }.asBody())
    }

    suspend fun accountUse(account: String, use: String) {
        call("/queue/account", buildJsonObject {
            put("account", account)
            put("use", use)
        }.asBody())
    }

    suspend fun mia(): MiaStatus = json.decodeFromString(call("/mia"))

    suspend fun askMia(ask: MiaAsk): MiaReply {
        val body = json.encodeToString(MiaAsk.serializer(), ask).toRequestBody(jsonType)
        return json.decodeFromString(call("/mia", body, via = patient))
    }

    /** WebAuthn request options, as JSON for Credential Manager. */
    suspend fun passkeyLoginOptions(): String = call("/passkey/login/options", JsonObject(emptyMap()).asBody())

    /** Sends the signed assertion; on success the Worker sets the session cookie. */
    suspend fun passkeyLogin(responseJson: String): Me {
        val body = JsonObject(mapOf("response" to json.parseToJsonElement(responseJson)))
        return json.decodeFromString(call("/passkey/login/verify", body.asBody()))
    }

    suspend fun logout() {
        runCatching { call("/auth/logout", JsonObject(emptyMap()).asBody()) }
        cookies.clear()
    }
}

/** How long a question to Mia may take before the app gives up. */
val MIA_WAIT: Duration = Duration.ofSeconds(90)

@Serializable
private data class BanksBody(val items: List<BankLink>)

@Serializable
private data class BankCardsBody(val cards: List<BankCard>)
