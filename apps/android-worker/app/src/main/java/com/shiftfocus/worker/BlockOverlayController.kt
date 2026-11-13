package com.shiftfocus.worker

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import kotlin.concurrent.thread

/**
 * Draws a real full-screen system overlay (TYPE_APPLICATION_OVERLAY) directly over
 * restricted apps using WindowManager. Unlike Activity.startActivity(), WindowManager
 * overlays are allowed from background services on Android 10–15 as soon as
 * Settings.canDrawOverlays(ctx) ("Display over other apps") is granted.
 */
object BlockOverlayController {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var overlayView: View? = null
    private var currentBlockedPkg: String? = null

    fun show(ctx: Context, appLabel: String, packageName: String) {
        val appCtx = ctx.applicationContext
        mainHandler.post {
            if (!Settings.canDrawOverlays(appCtx)) {
                // Fallback to Activity if overlay permission was not granted yet
                BlockedAppActivity.launch(appCtx, appLabel, packageName)
                return@post
            }

            if (overlayView != null && currentBlockedPkg == packageName) {
                return@post
            }
            dismissInternal(appCtx)

            val wm = appCtx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val policy = ShiftFocusStore.getPolicy(appCtx)

            val root = LinearLayout(appCtx).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setBackgroundColor(0xFF0A0F1A.toInt())
                setPadding(64, 64, 64, 64)
            }

            val badge = TextView(appCtx).apply {
                text = "🛡️ SHIFTFOCUS SHIELD ACTIVE"
                textSize = 13f
                setTextColor(0xFF38BDF8.toInt())
                setPadding(28, 12, 28, 12)
                setBackgroundColor(0xFF0F2942.toInt())
            }

            val title = TextView(appCtx).apply {
                text = "$appLabel is paused during your shift"
                textSize = 22f
                setTextColor(0xFFF1F5F9.toInt())
                gravity = Gravity.CENTER
                setPadding(0, 36, 0, 16)
            }

            val subtitle = TextView(appCtx).apply {
                text = "You are currently clocked in (${policy.shiftState}) at ${policy.companyName.ifBlank { "your workplace" }}.\n\nDistracting social and video apps are paused. Phone, SMS, and WhatsApp remain open."
                textSize = 14f
                setTextColor(0xFF94A3B8.toInt())
                gravity = Gravity.CENTER
                setPadding(0, 0, 0, 44)
            }

            val closeBtn = Button(appCtx).apply {
                text = "Return to Home Screen"
                setOnClickListener {
                    sendToHomeScreen(appCtx)
                    dismissInternal(appCtx)
                }
            }

            val openShiftFocusBtn = Button(appCtx).apply {
                text = "Open ShiftFocus Worker App"
                setOnClickListener {
                    dismissInternal(appCtx)
                    val intent = Intent(appCtx, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    }
                    appCtx.startActivity(intent)
                }
            }

            val overrideBtn = Button(appCtx).apply {
                text = "⚡ Emergency Override (Unlock All Apps)"
                setTextColor(0xFFFCA5A5.toInt())
                setOnClickListener {
                    isEnabled = false
                    text = "Unlocking all apps…"
                    thread {
                        val token = ShiftFocusStore.getDeviceToken(appCtx)
                        val baseUrl = ShiftFocusStore.getServerUrl(appCtx)
                        if (!token.isNullOrBlank()) {
                            runCatching {
                                ShiftFocusApi.triggerOverride(baseUrl, token, "family")
                                val updated = ShiftFocusApi.fetchStatus(baseUrl, token)
                                ShiftFocusStore.savePolicy(appCtx, updated)
                            }.onSuccess {
                                mainHandler.post {
                                    Toast.makeText(appCtx, "Emergency override active — all apps unlocked", Toast.LENGTH_SHORT).show()
                                    dismissInternal(appCtx)
                                }
                            }.onFailure { err ->
                                mainHandler.post {
                                    isEnabled = true
                                    text = "⚡ Emergency Override (Unlock All Apps)"
                                    Toast.makeText(appCtx, "Override failed: ${err.message}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        } else {
                            mainHandler.post { dismissInternal(appCtx) }
                        }
                    }
                }
            }

            root.addView(badge)
            root.addView(title)
            root.addView(subtitle)
            root.addView(closeBtn)
            root.addView(openShiftFocusBtn)
            root.addView(overrideBtn)

            val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                layoutType,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_FULLSCREEN or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.CENTER
            }

            // Push restricted app to background home screen and show full-screen shield
            sendToHomeScreen(appCtx)
            runCatching {
                wm.addView(root, params)
                overlayView = root
                currentBlockedPkg = packageName
            }
        }
    }

    fun dismiss(ctx: Context) {
        val appCtx = ctx.applicationContext
        mainHandler.post { dismissInternal(appCtx) }
    }

    private fun dismissInternal(appCtx: Context) {
        val view = overlayView ?: return
        val wm = appCtx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        runCatching { wm.removeView(view) }
        overlayView = null
        currentBlockedPkg = null
    }

    private fun sendToHomeScreen(ctx: Context) {
        runCatching {
            val home = Intent(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            ctx.startActivity(home)
        }
    }
}
