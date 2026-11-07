// SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

package com.leon.nexus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import dev.fluttercommunity.workmanager.BackgroundWorker

// Alarms are gone after a reboot and point to the wrong hour after a clock or time zone
// change, so the Dart side plans the reminders again. The task name matches
// kReminderPlanTask in background_service.dart.
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val input = Data.Builder()
            .putString(BackgroundWorker.DART_TASK_KEY, "reminderPlan")
            .build()
        val request = OneTimeWorkRequest.Builder(BackgroundWorker::class.java)
            .setInputData(input)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork("reminder_plan_now", ExistingWorkPolicy.REPLACE, request)
    }
}
