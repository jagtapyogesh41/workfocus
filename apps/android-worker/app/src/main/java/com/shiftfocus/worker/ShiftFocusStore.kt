package com.shiftfocus.worker

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class AppRef(val packageName: String, val label: String)

data class FocusPolicyState(
    val employeeName: String = "",
    val companyName: String = "",
    val shiftState: String = "off_shift",
    val desiredMode: String = "unrestricted",
    val reasonLabel: String = "",
    val overrideActive: Boolean = false,
    val restrictedApps: List<AppRef> = emptyList(),
    val alwaysAllowedApps: List<AppRef> = emptyList(),
)

object ShiftFocusStore {
    private const val PREFS = "shiftfocus_worker_prefs"
    private const val KEY_SERVER_URL = "server_url"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_POLICY_JSON = "cached_policy_json"
    const val DEFAULT_SERVER_URL = "https://shiftfocus-6gaz.onrender.com"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun getServerUrl(ctx: Context): String =
        (prefs(ctx).getString(KEY_SERVER_URL, DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL).trimEnd('/')

    fun setServerUrl(ctx: Context, url: String) {
        prefs(ctx).edit().putString(KEY_SERVER_URL, url.trim().trimEnd('/')).apply()
    }

    fun getDeviceToken(ctx: Context): String? = prefs(ctx).getString(KEY_DEVICE_TOKEN, null)

    fun setDeviceToken(ctx: Context, token: String?) {
        prefs(ctx).edit().putString(KEY_DEVICE_TOKEN, token).apply()
    }

    fun savePolicy(ctx: Context, state: FocusPolicyState) {
        val obj = JSONObject().apply {
            put("employeeName", state.employeeName)
            put("companyName", state.companyName)
            put("shiftState", state.shiftState)
            put("desiredMode", state.desiredMode)
            put("reasonLabel", state.reasonLabel)
            put("overrideActive", state.overrideActive)
            put("restrictedApps", JSONArray().apply {
                state.restrictedApps.forEach { put(JSONObject().put("packageName", it.packageName).put("label", it.label)) }
            })
            put("alwaysAllowedApps", JSONArray().apply {
                state.alwaysAllowedApps.forEach { put(JSONObject().put("packageName", it.packageName).put("label", it.label)) }
            })
        }
        prefs(ctx).edit().putString(KEY_POLICY_JSON, obj.toString()).apply()
    }

    fun getPolicy(ctx: Context): FocusPolicyState {
        val raw = prefs(ctx).getString(KEY_POLICY_JSON, null) ?: return FocusPolicyState()
        return runCatching {
            val obj = JSONObject(raw)
            fun parseApps(arr: JSONArray?): List<AppRef> {
                if (arr == null) return emptyList()
                return (0 until arr.length()).map { i ->
                    val item = arr.getJSONObject(i)
                    AppRef(item.optString("packageName"), item.optString("label"))
                }
            }
            FocusPolicyState(
                employeeName = obj.optString("employeeName"),
                companyName = obj.optString("companyName"),
                shiftState = obj.optString("shiftState", "off_shift"),
                desiredMode = obj.optString("desiredMode", "unrestricted"),
                reasonLabel = obj.optString("reasonLabel"),
                overrideActive = obj.optBoolean("overrideActive", false),
                restrictedApps = parseApps(obj.optJSONArray("restrictedApps")),
                alwaysAllowedApps = parseApps(obj.optJSONArray("alwaysAllowedApps")),
            )
        }.getOrDefault(FocusPolicyState())
    }

    fun blockedLabelFor(ctx: Context, packageName: String): String? {
        if (packageName.isBlank() || packageName == ctx.packageName) return null
        val policy = getPolicy(ctx)
        if (policy.desiredMode != "focus" || policy.overrideActive) return null
        if (policy.alwaysAllowedApps.any { it.packageName == packageName }) return null
        return policy.restrictedApps.firstOrNull { it.packageName == packageName }?.label
    }
}
