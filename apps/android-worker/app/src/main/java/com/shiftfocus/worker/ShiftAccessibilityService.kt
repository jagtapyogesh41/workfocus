package com.shiftfocus.worker

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

class ShiftAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        val blockedLabel = ShiftFocusStore.blockedLabelFor(this, pkg) ?: return
        BlockedAppActivity.launch(this, blockedLabel, pkg)
    }

    override fun onInterrupt() = Unit
}
