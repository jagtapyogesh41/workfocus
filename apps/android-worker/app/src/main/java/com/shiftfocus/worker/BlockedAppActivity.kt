package com.shiftfocus.worker

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

class BlockedAppActivity : AppCompatActivity() {

    companion object {
        private const val EXTRA_APP_LABEL = "extra_app_label"
        private const val EXTRA_PACKAGE = "extra_package"

        fun launch(ctx: Context, appLabel: String, packageName: String) {
            val intent = Intent(ctx, BlockedAppActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(EXTRA_APP_LABEL, appLabel)
                putExtra(EXTRA_PACKAGE, packageName)
            }
            ctx.startActivity(intent)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val appLabel = intent.getStringExtra(EXTRA_APP_LABEL) ?: "This app"
        val policy = ShiftFocusStore.getPolicy(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xFF0A0F1A.toInt())
            setPadding(64, 64, 64, 64)
        }

        val badge = TextView(this).apply {
            text = "FOCUS MODE ACTIVE"
            textSize = 12f
            setTextColor(0xFF38BDF8.toInt())
            setPadding(24, 10, 24, 10)
            setBackgroundColor(0xFF0F2942.toInt())
        }

        val title = TextView(this).apply {
            text = "$appLabel is paused during your shift"
            textSize = 22f
            setTextColor(0xFFF1F5F9.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 32, 0, 16)
        }

        val subtitle = TextView(this).apply {
            text = "ShiftFocus pauses distracting apps while you are clocked in at ${policy.companyName.ifBlank { "work" }}.\n\nPhone, SMS, and WhatsApp remain available."
            textSize = 14f
            setTextColor(0xFF94A3B8.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, 40)
        }

        val homeBtn = Button(this).apply {
            text = "Go to Home Screen"
            setOnClickListener { goHome() }
        }

        val overrideBtn = Button(this).apply {
            text = "⚡ Emergency Override (Unlock All)"
            setTextColor(0xFFFCA5A5.toInt())
            setOnClickListener {
                isEnabled = false
                text = "Unlocking…"
                thread {
                    val token = ShiftFocusStore.getDeviceToken(this@BlockedAppActivity)
                    val baseUrl = ShiftFocusStore.getServerUrl(this@BlockedAppActivity)
                    if (!token.isNullOrBlank()) {
                        runCatching {
                            ShiftFocusApi.triggerOverride(baseUrl, token, "family")
                            val updated = ShiftFocusApi.fetchStatus(baseUrl, token)
                            ShiftFocusStore.savePolicy(this@BlockedAppActivity, updated)
                        }.onSuccess {
                            runOnUiThread {
                                Toast.makeText(this@BlockedAppActivity, "Emergency override active — apps unlocked", Toast.LENGTH_SHORT).show()
                                finish()
                            }
                        }.onFailure { err ->
                            runOnUiThread {
                                isEnabled = true
                                text = "⚡ Emergency Override (Unlock All)"
                                Toast.makeText(this@BlockedAppActivity, "Override failed: ${err.message}", Toast.LENGTH_SHORT).show()
                            }
                        }
                    }
                }
            }
        }

        root.addView(badge)
        root.addView(title)
        root.addView(subtitle)
        root.addView(homeBtn)
        root.addView(overrideBtn)
        setContentView(root)
    }

    private fun goHome() {
        val home = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(home)
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        goHome()
    }
}
