package com.leon.nexus

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.provider.MediaStore
import android.provider.Settings
import android.view.WindowManager
import androidx.core.content.FileProvider
import com.dexterous.flutterlocalnotifications.ScheduledNotificationReceiver
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.IOException

class MainActivity: FlutterActivity() {
    private val CHANNEL = "app/focus_mode"
    private val ASSISTANT_MODEL_CHANNEL = "app/assistant_model"
    private val DEVICE_CHANNEL = "app/device"
    private val LOCATION_REQUEST = 4711
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var locationResult: MethodChannel.Result? = null
    private var previousInterruptionFilter: Int = NotificationManager.INTERRUPTION_FILTER_ALL

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "enableFocusMode" -> {
                    result.success(enableDoNotDisturb())
                }
                "disableFocusMode" -> {
                    result.success(disableDoNotDisturb())
                }
                "hasPermission" -> {
                    result.success(hasDoNotDisturbPermission())
                }
                "requestPermission" -> {
                    requestDoNotDisturbPermission()
                    result.success(true)
                }
                else -> {
                    result.notImplemented()
                }
            }
        }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, ASSISTANT_MODEL_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "profile" -> result.success(assistantModelProfile())
                "memory" -> result.success(memorySnapshot())
                "freeSpace" -> {
                    val path = call.argument<String>("path")
                    result.success(if (path == null) null else freeBytes(path))
                }
                "keepScreenOn" -> {
                    val on = call.argument<Boolean>("on") ?: false
                    runOnUiThread {
                        if (on) {
                            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        } else {
                            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        }
                    }
                    result.success(null)
                }
                "excludeFromBackup" -> result.success(true)
                "network" -> result.success(networkStatus())
                else -> result.notImplemented()
            }
        }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, DEVICE_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "requestLocation" -> requestLocation(result)
                "missingAlarms" -> {
                    val ids = call.argument<List<Int>>("ids") ?: emptyList()
                    result.success(ids.filter { !alarmPlanned(it) })
                }
                "saveDownload" -> {
                    val name = call.argument<String>("name")
                    val type = call.argument<String>("type")
                    val bytes = call.argument<ByteArray>("bytes")
                    result.success(if (name == null || type == null || bytes == null) null else saveDownload(name, type, bytes))
                }
                "canInstall" -> result.success(canInstallPackages())
                "allowInstall" -> result.success(openInstallSettings())
                "install" -> {
                    val path = call.argument<String>("path")
                    result.success(path != null && installPackage(path))
                }
                else -> result.notImplemented()
            }
        }

        EventChannel(flutterEngine.dartExecutor.binaryMessenger, "$ASSISTANT_MODEL_CHANNEL/network").setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                    watchNetwork(events)
                }

                override fun onCancel(arguments: Any?) {
                    stopWatchingNetwork()
                }
            }
        )
    }

    override fun onDestroy() {
        stopWatchingNetwork()
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != LOCATION_REQUEST) return
        val waiting = locationResult ?: return
        locationResult = null
        waiting.success(grantResults.any { it == PackageManager.PERMISSION_GRANTED })
    }

    // flutter_local_notifications keys the alarm of a reminder by its id and its receiver; a
    // force stop or a reboot removes that PendingIntent together with the alarm.
    private fun alarmPlanned(id: Int): Boolean {
        val intent = Intent(this, ScheduledNotificationReceiver::class.java)
        return PendingIntent.getBroadcast(this, id, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE) != null
    }

    private fun locationGranted(): Boolean =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun requestLocation(result: MethodChannel.Result) {
        if (locationGranted()) {
            result.success(true)
            return
        }
        if (locationResult != null) {
            result.success(false)
            return
        }
        locationResult = result
        requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), LOCATION_REQUEST)
    }

    private fun saveDownload(name: String, type: String, bytes: ByteArray): Map<String, Any>? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, type)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
            return try {
                contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException("no stream")
                contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                mapOf("name" to (displayName(uri) ?: name), "folder" to Environment.DIRECTORY_DOWNLOADS)
            } catch (e: Exception) {
                contentResolver.delete(uri, null, null)
                null
            }
        }
        return try {
            val folder = File(cacheDir, "shared").apply { mkdirs() }
            val file = File(folder, name)
            file.writeBytes(bytes)
            val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
            val send = Intent(Intent.ACTION_SEND)
                .setType(type)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(Intent.createChooser(send, null))
            mapOf("name" to name, "shared" to true)
        } catch (e: Exception) {
            null
        }
    }

    private fun displayName(uri: Uri): String? =
        contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }

    private fun canInstallPackages(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()

    private fun openInstallSettings(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        return try {
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun installPackage(path: String): Boolean {
        return try {
            val uri = FileProvider.getUriForFile(this, "$packageName.files", File(path))
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(intent)
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun networkStatus(): Map<String, Boolean> {
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val capabilities = manager.activeNetwork?.let { manager.getNetworkCapabilities(it) }
        val connected = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        return mapOf("connected" to connected, "metered" to (connected && manager.isActiveNetworkMetered))
    }

    private fun watchNetwork(events: EventChannel.EventSink) {
        stopWatchingNetwork()
        val manager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val main = Handler(Looper.getMainLooper())
        var last: Map<String, Boolean>? = null
        fun report() {
            main.post {
                val status = networkStatus()
                if (status != last) {
                    last = status
                    events.success(status)
                }
            }
        }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = report()
            override fun onLost(network: Network) = report()
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = report()
        }
        try {
            manager.registerDefaultNetworkCallback(callback)
            networkCallback = callback
        } catch (e: Exception) {
            events.error("network", e.message, null)
            return
        }
        report()
    }

    private fun stopWatchingNetwork() {
        val callback = networkCallback ?: return
        networkCallback = null
        try {
            (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(callback)
        } catch (e: Exception) {
        }
    }

    private fun assistantModelProfile(): Map<String, Any?> {
        val directory = File(noBackupFilesDir, "assistant-model")
        directory.mkdirs()
        val memory = memorySnapshot()
        return mapOf(
            "directory" to directory.absolutePath,
            "freeBytes" to freeBytes(directory.absolutePath),
            "totalMemory" to memory["total"],
            "availableMemory" to memory["available"],
        )
    }

    private fun memorySnapshot(): Map<String, Any> {
        val info = ActivityManager.MemoryInfo()
        (getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(info)
        return mapOf(
            "total" to info.totalMem,
            "available" to info.availMem,
            "low" to info.lowMemory,
        )
    }

    private fun freeBytes(path: String): Long? {
        return try {
            StatFs(path).availableBytes
        } catch (e: Exception) {
            null
        }
    }

    private fun hasDoNotDisturbPermission(): Boolean {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return notificationManager.isNotificationPolicyAccessGranted
    }

    private fun requestDoNotDisturbPermission() {
        if (!hasDoNotDisturbPermission()) {
            val intent = Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
            startActivity(intent)
        }
    }

    private fun enableDoNotDisturb(): Boolean {
        if (!hasDoNotDisturbPermission()) {
            return false
        }

        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            previousInterruptionFilter = notificationManager.currentInterruptionFilter

            notificationManager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
            return true
        } catch (e: Exception) {
            return false
        }
    }

    private fun disableDoNotDisturb(): Boolean {
        if (!hasDoNotDisturbPermission()) {
            return false
        }

        try {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            notificationManager.setInterruptionFilter(previousInterruptionFilter)
            return true
        } catch (e: Exception) {
            return false
        }
    }
}
