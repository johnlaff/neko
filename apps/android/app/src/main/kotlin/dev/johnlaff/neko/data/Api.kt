package dev.johnlaff.neko.data

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
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

    private suspend fun call(path: String, body: RequestBody? = null, method: String? = null): String =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$baseUrl/api$path")
                .method(method ?: if (body != null) "POST" else "GET", body)
                .build()
            client.newCall(request).execute().use { res ->
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
