package com.vscale.offline

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.UUID

/**
 * Talks to the VSCALE (Exingtech Y1 protocol) over Bluetooth LE and relays
 * everything to the page through window.__ble.status / notify / error.
 */
@SuppressLint("MissingPermission")
class BleBridge(private val act: MainActivity, private val web: WebView) {

    private val main = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var scanning = false
    private val ops = ArrayDeque<() -> Unit>()
    private var busy = false
    private var opToken = 0

    // ---------- called from the page ----------

    @JavascriptInterface
    fun connect() = main.post { act.ensurePermissions { startScan() } }

    @JavascriptInterface
    fun write(hex: String, withResponse: Boolean) = main.post { enqueue { doWrite(hex, withResponse) } }

    @JavascriptInterface
    fun disconnect() = main.post {
        stopScan()
        closeGatt()
        emitStatus("off", "Disconnected")
    }

    @JavascriptInterface
    fun saveFile(name: String, text: String, mime: String) = main.post { act.saveText(name, text, mime) }

    @JavascriptInterface
    fun setReminder(json: String) = main.post {
        Reminders.save(act, json)
        if (json.contains("\"on\":true")) act.ensureNotificationPermission()
    }

    @JavascriptInterface
    fun pickBackupFolder() = main.post { act.pickBackupFolder() }

    @JavascriptInterface
    fun writeBackup(name: String, text: String, overwrite: Boolean) = main.post { act.writeBackup(name, text) }

    @JavascriptInterface
    fun vibrate(ms: Int) = main.post {
        try {
            val v = act.getSystemService(android.os.Vibrator::class.java)
            if (Build.VERSION.SDK_INT >= 26) v?.vibrate(android.os.VibrationEffect.createOneShot(ms.toLong(), android.os.VibrationEffect.DEFAULT_AMPLITUDE))
            else { @Suppress("DEPRECATION") v?.vibrate(ms.toLong()) }
        } catch (_: Exception) {}
    }

    // ---------- to the page ----------

    private fun js(fn: String, vararg args: String) {
        val a = args.joinToString(",") { JSONObject.quote(it) }
        main.post { web.evaluateJavascript("window.__ble&&window.__ble.$fn($a)", null) }
    }

    fun emitStatus(state: String, text: String) = js("status", state, text)
    fun emitError(text: String) = js("error", text)

    // ---------- scanning ----------

    private fun startScan() {
        val adapter = act.getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null || !adapter.isEnabled) {
            emitStatus("off", "Bluetooth is off. Turn it on and tap Connect again.")
            return
        }
        val scanner = adapter.bluetoothLeScanner ?: run {
            emitStatus("off", "Bluetooth scanning is not available. Turn Bluetooth off and on, then try again.")
            return
        }
        closeGatt()
        stopScan()
        scanning = true
        emitStatus("busy", "Searching for the scale…")
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try { scanner.startScan(null, settings, scanCb) } catch (e: Exception) {
            scanning = false
            emitStatus("off", "Could not start scanning: ${e.message}")
            return
        }
        main.postDelayed({
            if (scanning) {
                stopScan()
                val hint = if (Build.VERSION.SDK_INT <= 30) " On this Android version, Location must also be switched on." else ""
                emitStatus("off", "Scale not found. Step on it to wake it, then tap Connect.$hint")
            }
        }, 15000)
    }

    private fun stopScan() {
        if (!scanning) return
        scanning = false
        try {
            act.getSystemService(BluetoothManager::class.java)?.adapter?.bluetoothLeScanner?.stopScan(scanCb)
        } catch (_: Exception) {}
    }

    private val scanCb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (!scanning) return
            val name = result.scanRecord?.deviceName ?: try { result.device.name } catch (_: Exception) { null }
            val hasService = result.scanRecord?.serviceUuids?.any { it.uuid == SVC } == true
            if (name.equals("VSCALE", ignoreCase = true) || hasService) {
                stopScan()
                emitStatus("busy", "Connecting…")
                main.post {
                    gatt = result.device.connectGatt(act, false, gattCb, BluetoothDevice.TRANSPORT_LE)
                }
            }
        }

        override fun onScanFailed(errorCode: Int) {
            scanning = false
            emitStatus("off", "Scanning failed (code $errorCode). Turn Bluetooth off and on, then try again.")
        }
    }

    // ---------- GATT ----------

    private val gattCb = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            main.post {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    g.discoverServices()
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    g.close()
                    if (gatt == g) gatt = null
                    ops.clear(); busy = false
                    emitStatus("off", "Disconnected")
                }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            main.post {
                val svc = g.getService(SVC)
                if (svc == null) {
                    emitError("This device does not have the VScale service.")
                    g.disconnect()
                    return@post
                }
                svc.getCharacteristic(CH_RES)?.let { ch -> enqueue { enableNotify(g, ch) } }
                svc.getCharacteristic(CH_AUX)?.let { ch -> enqueue { enableNotify(g, ch) } }
                enqueue {
                    emitStatus("ready", "Connected to ${g.device.name ?: "scale"}")
                    next()
                }
            }
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
            main.post { next() }
        }

        override fun onCharacteristicWrite(g: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
            main.post {
                if (status != BluetoothGatt.GATT_SUCCESS) emitError("The scale rejected the command (error $status).")
                next()
            }
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic, value: ByteArray) {
            js("notify", ch.uuid.toString(), toHex(value))
        }

        @Deprecated("Used on Android 12 and older")
        override fun onCharacteristicChanged(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
            if (Build.VERSION.SDK_INT < 33) {
                @Suppress("DEPRECATION")
                js("notify", ch.uuid.toString(), toHex(ch.value ?: ByteArray(0)))
            }
        }
    }

    private fun enableNotify(g: BluetoothGatt, ch: BluetoothGattCharacteristic) {
        g.setCharacteristicNotification(ch, true)
        val d = ch.getDescriptor(CCCD) ?: run { next(); return }
        val v = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
        val started = if (Build.VERSION.SDK_INT >= 33) {
            g.writeDescriptor(d, v) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run { d.value = v; g.writeDescriptor(d) }
        }
        if (!started) next()
    }

    private fun doWrite(hex: String, withResponse: Boolean) {
        val g = gatt
        val ch = g?.getService(SVC)?.getCharacteristic(CH_CMD)
        if (g == null || ch == null) {
            emitError("Not connected to the scale.")
            next(); return
        }
        val bytes = fromHex(hex)
        val type = if (withResponse) BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                   else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        val started = if (Build.VERSION.SDK_INT >= 33) {
            g.writeCharacteristic(ch, bytes, type) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            run { ch.writeType = type; ch.value = bytes; g.writeCharacteristic(ch) }
        }
        if (!started) {
            emitError("Could not send the command. Tap Get result to try again.")
            next()
        }
    }

    // ---------- one operation at a time, as Android BLE requires ----------

    private fun enqueue(op: () -> Unit) {
        ops.addLast(op)
        if (!busy) next()
    }

    private fun next() {
        val op = ops.removeFirstOrNull()
        if (op == null) { busy = false; return }
        busy = true
        val token = ++opToken
        main.postDelayed({ if (busy && opToken == token) next() }, 3000) // safety net if a callback never comes
        op()
    }

    private fun closeGatt() {
        gatt?.let { try { it.disconnect(); it.close() } catch (_: Exception) {} }
        gatt = null
        ops.clear(); busy = false
    }

    fun shutdown() { stopScan(); closeGatt() }

    companion object {
        val SVC: UUID = UUID.fromString("f433bd80-75b8-11e2-97d9-0002a5d5c51b")
        val CH_RES: UUID = UUID.fromString("1a2ea400-75b9-11e2-be05-0002a5d5c51b")
        val CH_AUX: UUID = UUID.fromString("23b4fec0-75b9-11e2-972a-0002a5d5c51b")
        val CH_CMD: UUID = UUID.fromString("29f11080-75b9-11e2-8bf6-0002a5d5c51b")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        fun toHex(b: ByteArray) = b.joinToString(" ") { "%02X".format(it.toInt() and 0xFF) }
        fun fromHex(s: String): ByteArray =
            s.trim().split(Regex("[\\s-]+")).filter { it.isNotEmpty() }.map { it.toInt(16).toByte() }.toByteArray()
    }
}
