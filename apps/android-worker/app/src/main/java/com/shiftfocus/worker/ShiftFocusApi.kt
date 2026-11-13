package com.shiftfocus.worker

import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

data class DemoWorker(val employeeId: String, val fullName: String, val externalEmployeeId: String)

object ShiftFocusApi {
    private fun request(
        baseUrl: String,
        path: String,
        method: String = "GET",
        token: String? = null,
        body: JSONObject? = null,
    ): JSONObject {
        val url = URL("$baseUrl$path")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("Accept", "application/json")
            if (!token.isNullOrBlank()) {
                setRequestProperty("Authorization", "Bearer $token")
            }
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (body != null) {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.let { BufferedReader(InputStreamReader(it, Charsets.UTF_8)).readText() }.orEmpty()
            if (code !in 200..299) {
                val msg = runCatching { JSONObject(text).optString("message") }.getOrNull().orEmpty()
                throw RuntimeException(msg.ifBlank { "HTTP $code" })
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }

    fun fetchDemoWorkers(baseUrl: String): List<DemoWorker> {
        val obj = request(baseUrl, "/v1/device/demo-workers")
        val arr = obj.optJSONArray("workers") ?: JSONArray()
        return (0 until arr.length()).map { i ->
            val w = arr.getJSONObject(i)
            DemoWorker(
                employeeId = w.optString("employeeId"),
                fullName = w.optString("fullName"),
                externalEmployeeId = w.optString("externalEmployeeId"),
            )
        }
    }

    fun demoPair(baseUrl: String, employeeId: String): String {
        val body = JSONObject()
            .put("employeeId", employeeId)
            .put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
        val obj = request(baseUrl, "/v1/device/demo-pair", method = "POST", body = body)
        return obj.getString("deviceToken")
    }

    fun enrollWithToken(baseUrl: String, enrollmentToken: String): String {
        val body = JSONObject()
            .put("enrollmentToken", enrollmentToken)
            .put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
        val obj = request(baseUrl, "/v1/device/enroll", method = "POST", body = body)
        return obj.getString("deviceToken")
    }

    fun fetchStatus(baseUrl: String, deviceToken: String): FocusPolicyState {
        val obj = request(baseUrl, "/v1/device/status", method = "GET", token = deviceToken)
        fun parseApps(arr: JSONArray?): List<AppRef> {
            if (arr == null) return emptyList()
            return (0 until arr.length()).map { i ->
                val item = arr.getJSONObject(i)
                AppRef(item.optString("packageName"), item.optString("label"))
            }
        }
        val release = obj.optJSONObject("appRelease")
        return FocusPolicyState(
            employeeName = obj.optJSONObject("employee")?.optString("fullName").orEmpty(),
            companyName = obj.optJSONObject("company")?.optString("name").orEmpty(),
            shiftState = obj.optString("shiftState", "off_shift"),
            desiredMode = obj.optString("desiredMode", "unrestricted"),
            reasonLabel = obj.optString("reasonLabel"),
            overrideActive = obj.optJSONObject("override") != null,
            restrictedApps = parseApps(obj.optJSONArray("restrictedApps")),
            alwaysAllowedApps = parseApps(obj.optJSONArray("alwaysAllowedApps")),
            latestVersionCode = release?.optInt("versionCode", 1) ?: 1,
            latestVersionName = release?.optString("versionName", "1.0.0") ?: "1.0.0",
            apkUrl = release?.optString("apkUrl", "/shiftfocus-worker.apk") ?: "/shiftfocus-worker.apk",
        )
    }

    fun triggerOverride(baseUrl: String, deviceToken: String, reasonCategory: String = "family") {
        val body = JSONObject().put("reasonCategory", reasonCategory)
        request(baseUrl, "/v1/device/override", method = "POST", token = deviceToken, body = body)
    }
}
