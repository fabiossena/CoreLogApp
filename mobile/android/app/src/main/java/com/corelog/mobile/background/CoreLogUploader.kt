package com.corelog.mobile.background

import java.io.BufferedReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import android.util.Log

/**
 * Minimal HTTP transport used by the background service.
 *
 * Deliberately dependency-free (`HttpURLConnection`) so the foreground service
 * never waits on OkHttp/React Native class loading. Payloads are pre-serialized
 * snake_case JSON exactly as defined in `docs/api-contract.md`.
 */
object CoreLogUploader {

    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 15_000

    /**
     * POSTs a JSON document and reports whether CoreLog accepted it (2xx).
     *
     * @param baseUrl `CORELOG_BASE_URL` without trailing slash.
     * @param path absolute API path, e.g. `/api/tracking/events`.
     * @param jsonBody request body (already snake_case JSON).
     * @return true when the response status is 2xx.
     */
    fun postJson(baseUrl: String, path: String, jsonBody: String): Boolean {
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")

            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { writer ->
                writer.write(jsonBody)
                writer.flush()
            }

            val status = connection.responseCode
            // Drain the stream so the connection can be reused/closed cleanly.
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            stream?.bufferedReader()?.use(BufferedReader::readText)
            if (status !in 200..299) {
                Log.w(TAG, "POST ${baseUrl.trimEnd('/')}$path rejected with HTTP $status")
            }
            status in 200..299
        } catch (error: Exception) {
            Log.w(TAG, "POST ${baseUrl.trimEnd('/')}$path failed: ${error.javaClass.simpleName}: ${error.message}")
            false
        } finally {
            connection.disconnect()
        }
    }

    private const val TAG = "CoreLogUploader"

    /**
     * Uploads a batch of position payloads as a JSON array body.
     *
     * @param baseUrl `CORELOG_BASE_URL`.
     * @param payloads snake_case position objects (one per array item).
     * @return true when the batch was accepted.
     */
    fun uploadPositionBatch(baseUrl: String, payloads: List<String>): Boolean {
        if (payloads.isEmpty()) return true
        val body = payloads.joinToString(separator = ",", prefix = "[", postfix = "]")
        return postJson(baseUrl, "/api/tracking/events", body)
    }

    /**
     * Uploads one high-priority panic payload.
     *
     * @param baseUrl `CORELOG_BASE_URL`.
     * @param payload snake_case panic object.
     * @return true when CoreLog accepted the panic.
     */
    fun uploadPanic(baseUrl: String, payload: String): Boolean {
        return postJson(baseUrl, "/api/panic", payload)
    }
}
