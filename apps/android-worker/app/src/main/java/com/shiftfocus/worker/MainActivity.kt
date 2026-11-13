package com.shiftfocus.worker

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private lateinit var rootContainer: LinearLayout
    private val handler = Handler(Looper.getMainLooper())
    private val refreshRunnable = object : Runnable {
        override fun run() {
            if (!ShiftFocusStore.getDeviceToken(this@MainActivity).isNullOrBlank()) {
                refreshStatusFromServer()
            }
            handler.postDelayed(this, 3000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
        }

        val scroll = ScrollView(this).apply {
            setBackgroundColor(0xFF0A0F1A.toInt())
        }
        rootContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 56, 48, 56)
        }
        scroll.addView(rootContainer)
        setContentView(scroll)

        if (!ShiftFocusStore.getDeviceToken(this).isNullOrBlank()) {
            FocusMonitorService.start(this)
        }
        renderUi()
    }

    override fun onResume() {
        super.onResume()
        renderUi()
        handler.post(refreshRunnable)
    }

    override fun onPause() {
        handler.removeCallbacks(refreshRunnable)
        super.onPause()
    }

    private fun hasUsageAccess(): Boolean {
        val appOps = getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName)
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    private fun hasOverlayPermission(): Boolean = Settings.canDrawOverlays(this)

    private fun renderUi() {
        rootContainer.removeAllViews()

        val title = TextView(this).apply {
            text = "ShiftFocus Worker (Android)"
            textSize = 22f
            setTextColor(0xFFF1F5F9.toInt())
        }
        val subtitle = TextView(this).apply {
            text = "Real on-device app blocking linked to shift attendance"
            textSize = 13f
            setTextColor(0xFF94A3B8.toInt())
            setPadding(0, 4, 0, 28)
        }
        rootContainer.addView(title)
        rootContainer.addView(subtitle)

        // Permissions card
        val usageOk = hasUsageAccess()
        val overlayOk = hasOverlayPermission()

        val permHeader = TextView(this).apply {
            text = "1. Required Android Permissions"
            textSize = 15f
            setTextColor(0xFF38BDF8.toInt())
            setPadding(0, 8, 0, 8)
        }
        rootContainer.addView(permHeader)

        rootContainer.addView(Button(this).apply {
            text = if (usageOk) "✓ Usage Access Granted" else "Grant Usage Access (Required)"
            setOnClickListener { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
        })

        rootContainer.addView(Button(this).apply {
            text = if (overlayOk) "✓ Display Over Other Apps Granted" else "Grant Display Over Other Apps (Required)"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }
        })

        rootContainer.addView(Button(this).apply {
            text = "Accessibility Service (Optional Faster Block)"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        })

        val token = ShiftFocusStore.getDeviceToken(this)
        if (token.isNullOrBlank()) {
            renderPairingSection()
        } else {
            renderStatusSection()
        }
    }

    private fun renderPairingSection() {
        val header = TextView(this).apply {
            text = "2. Pair This Phone"
            textSize = 15f
            setTextColor(0xFF38BDF8.toInt())
            setPadding(0, 32, 0, 8)
        }
        rootContainer.addView(header)

        val serverInput = EditText(this).apply {
            setText(ShiftFocusStore.getServerUrl(this@MainActivity))
            hint = "Server URL"
            setTextColor(0xFFF1F5F9.toInt())
            setHintTextColor(0xFF64748B.toInt())
        }
        rootContainer.addView(serverInput)

        val tokenInput = EditText(this).apply {
            hint = "Enrollment token (sfe_...)"
            setTextColor(0xFFF1F5F9.toInt())
            setHintTextColor(0xFF64748B.toInt())
        }
        rootContainer.addView(tokenInput)

        rootContainer.addView(Button(this).apply {
            text = "Pair with Enrollment Token"
            setOnClickListener {
                val baseUrl = serverInput.text.toString().trim()
                val enrollTok = tokenInput.text.toString().trim()
                if (enrollTok.isBlank()) {
                    Toast.makeText(this@MainActivity, "Enter an sfe_... token", Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                ShiftFocusStore.setServerUrl(this@MainActivity, baseUrl)
                thread {
                    runCatching { ShiftFocusApi.enrollWithToken(baseUrl, enrollTok) }
                        .onSuccess { devTok ->
                            ShiftFocusStore.setDeviceToken(this@MainActivity, devTok)
                            runOnUiThread {
                                FocusMonitorService.start(this@MainActivity)
                                renderUi()
                            }
                        }
                        .onFailure { err ->
                            runOnUiThread { Toast.makeText(this@MainActivity, err.message, Toast.LENGTH_LONG).show() }
                        }
                }
            }
        })

        val demoBtn = Button(this).apply {
            text = "Load 1-Tap Pilot Workers"
            setOnClickListener {
                val baseUrl = serverInput.text.toString().trim()
                ShiftFocusStore.setServerUrl(this@MainActivity, baseUrl)
                thread {
                    runCatching { ShiftFocusApi.fetchDemoWorkers(baseUrl) }
                        .onSuccess { workers ->
                            runOnUiThread {
                                workers.forEach { w ->
                                    rootContainer.addView(Button(this@MainActivity).apply {
                                        text = "Pair as ${w.fullName} (#${w.externalEmployeeId})"
                                        setOnClickListener {
                                            thread {
                                                runCatching { ShiftFocusApi.demoPair(baseUrl, w.employeeId) }
                                                    .onSuccess { devTok ->
                                                        ShiftFocusStore.setDeviceToken(this@MainActivity, devTok)
                                                        runOnUiThread {
                                                            FocusMonitorService.start(this@MainActivity)
                                                            renderUi()
                                                        }
                                                    }
                                                    .onFailure { err ->
                                                        runOnUiThread { Toast.makeText(this@MainActivity, err.message, Toast.LENGTH_LONG).show() }
                                                    }
                                            }
                                        }
                                    })
                                }
                            }
                        }
                        .onFailure { err ->
                            runOnUiThread { Toast.makeText(this@MainActivity, "Failed: ${err.message}", Toast.LENGTH_LONG).show() }
                        }
                }
            }
        }
        rootContainer.addView(demoBtn)
    }

    private fun renderStatusSection() {
        val policy = ShiftFocusStore.getPolicy(this)

        val header = TextView(this).apply {
            text = "2. Live Shift & Focus Status"
            textSize = 15f
            setTextColor(0xFF38BDF8.toInt())
            setPadding(0, 32, 0, 8)
        }
        rootContainer.addView(header)

        val modeLabel = when {
            policy.overrideActive -> "OVERRIDE ACTIVE — All apps unlocked"
            policy.desiredMode == "focus" -> "FOCUS MODE ON — Restricted apps blocked"
            else -> "OFF SHIFT / BREAK — Normal access"
        }

        val info = TextView(this).apply {
            text = buildString {
                appendLine("App Version: v${ShiftFocusStore.INSTALLED_VERSION_NAME} (build ${ShiftFocusStore.INSTALLED_VERSION_CODE})")
                appendLine("Worker: ${policy.employeeName.ifBlank { "Syncing..." }}")
                appendLine("Site: ${policy.companyName.ifBlank { "-" }}")
                appendLine("Shift State: ${policy.shiftState}")
                appendLine("Policy Mode: $modeLabel")
                appendLine("Paused Apps: ${policy.restrictedApps.joinToString { it.label }.ifBlank { "None" }}")
                appendLine("Always Allowed: ${policy.alwaysAllowedApps.joinToString { it.label }.ifBlank { "Phone, SMS, WhatsApp" }}")
            }
            textSize = 14f
            setTextColor(0xFFE2E8F0.toInt())
            setPadding(0, 8, 0, 20)
        }
        rootContainer.addView(info)

        if (policy.latestVersionCode > ShiftFocusStore.INSTALLED_VERSION_CODE) {
            rootContainer.addView(Button(this).apply {
                text = "⬇️ Update App to v${policy.latestVersionName} (New Release)"
                setOnClickListener {
                    val baseUrl = ShiftFocusStore.getServerUrl(this@MainActivity)
                    val targetUrl = if (policy.apkUrl.startsWith("http")) policy.apkUrl else "$baseUrl${policy.apkUrl}"
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(targetUrl)))
                }
            })
        }

        rootContainer.addView(Button(this).apply {
            text = "🔄 Check for App & Policy Updates"
            setOnClickListener {
                val baseUrl = ShiftFocusStore.getServerUrl(this@MainActivity)
                val token = ShiftFocusStore.getDeviceToken(this@MainActivity) ?: return@setOnClickListener
                thread {
                    runCatching { ShiftFocusApi.fetchStatus(baseUrl, token) }
                        .onSuccess { updated ->
                            ShiftFocusStore.savePolicy(this@MainActivity, updated)
                            runOnUiThread {
                                renderUi()
                                if (updated.latestVersionCode > ShiftFocusStore.INSTALLED_VERSION_CODE) {
                                    val targetUrl = if (updated.apkUrl.startsWith("http")) updated.apkUrl else "$baseUrl${updated.apkUrl}"
                                    Toast.makeText(this@MainActivity, "Downloading v${updated.latestVersionName} update…", Toast.LENGTH_LONG).show()
                                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(targetUrl)))
                                } else {
                                    Toast.makeText(this@MainActivity, "Up to date (v${ShiftFocusStore.INSTALLED_VERSION_NAME}) — policy synced!", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }
                        .onFailure { err ->
                            runOnUiThread { Toast.makeText(this@MainActivity, "Sync error: ${err.message}", Toast.LENGTH_SHORT).show() }
                        }
                }
            }
        })

        rootContainer.addView(Button(this).apply {
            text = "⚡ Emergency Override (Unlock All)"
            setOnClickListener {
                val token = ShiftFocusStore.getDeviceToken(this@MainActivity) ?: return@setOnClickListener
                val baseUrl = ShiftFocusStore.getServerUrl(this@MainActivity)
                thread {
                    runCatching {
                        ShiftFocusApi.triggerOverride(baseUrl, token, "family")
                        val updated = ShiftFocusApi.fetchStatus(baseUrl, token)
                        ShiftFocusStore.savePolicy(this@MainActivity, updated)
                    }.onSuccess {
                        runOnUiThread {
                            Toast.makeText(this@MainActivity, "Emergency override active", Toast.LENGTH_SHORT).show()
                            renderUi()
                        }
                    }.onFailure { err ->
                        runOnUiThread { Toast.makeText(this@MainActivity, err.message, Toast.LENGTH_LONG).show() }
                    }
                }
            }
        })

        rootContainer.addView(Button(this).apply {
            text = "Unpair Device"
            setOnClickListener {
                FocusMonitorService.stop(this@MainActivity)
                ShiftFocusStore.setDeviceToken(this@MainActivity, null)
                renderUi()
            }
        })
    }

    private fun refreshStatusFromServer() {
        val token = ShiftFocusStore.getDeviceToken(this) ?: return
        val baseUrl = ShiftFocusStore.getServerUrl(this)
        thread {
            runCatching { ShiftFocusApi.fetchStatus(baseUrl, token) }
                .onSuccess { state ->
                    ShiftFocusStore.savePolicy(this, state)
                    runOnUiThread { renderUi() }
                }
        }
    }
}
