package com.vscale.offline

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var ble: BleBridge
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: String? = null
    private var afterPermission: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        // Serves the bundled page from a fixed https origin, so its stored data stays put.
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == "appassets.androidplatform.net") return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: Exception) {}
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val pick = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                }
                return try { startActivityForResult(pick, REQ_OPEN); true } catch (_: Exception) {
                    fileCallback = null; false
                }
            }
        }

        ble = BleBridge(this, web)
        web.addJavascriptInterface(ble, "AndroidBle")
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    fun ensurePermissions(then: () -> Unit) {
        val needed = if (Build.VERSION.SDK_INT >= 31)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
        val missing = needed.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) then() else {
            afterPermission = then
            requestPermissions(missing.toTypedArray(), REQ_PERM)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIFY) return
        if (requestCode != REQ_PERM) return
        val ok = grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        val next = afterPermission
        afterPermission = null
        if (ok) next?.invoke()
        else ble.emitStatus("off", "Bluetooth permission was refused. Allow \"Nearby devices\" for VScale Offline in Android settings.")
    }

    fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }
    }

    fun pickBackupFolder() {
        try { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), REQ_TREE) } catch (_: Exception) {
            ble.emitError("This phone has no folder picker.")
        }
    }

    fun writeBackup(name: String, text: String) {
        val tree = getSharedPreferences("vscale", MODE_PRIVATE).getString("backupTree", null) ?: return
        try {
            val dir = androidx.documentfile.provider.DocumentFile.fromTreeUri(this, Uri.parse(tree)) ?: return
            val file = dir.findFile(name) ?: dir.createFile("application/json", name.removeSuffix(".json")) ?: return
            contentResolver.openOutputStream(file.uri, "wt")?.use { it.write(text.toByteArray()) }
        } catch (e: Exception) {
            ble.emitError("Automatic backup failed: ${e.message}. Choose the backup folder again in Settings.")
        }
    }

    fun saveText(name: String, text: String, mime: String) {
        pendingSave = text
        val create = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime.ifBlank { "text/plain" }
            putExtra(Intent.EXTRA_TITLE, name)
        }
        try { startActivityForResult(create, REQ_SAVE) } catch (_: Exception) { pendingSave = null }
    }

    @Deprecated("Activity result API kept simple on purpose")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_OPEN -> {
                val uri = if (resultCode == RESULT_OK) data?.data else null
                fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
                fileCallback = null
            }
            REQ_TREE -> {
                val uri = data?.data
                if (resultCode == RESULT_OK && uri != null) {
                    try {
                        contentResolver.takePersistableUriPermission(uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    } catch (_: Exception) {}
                    getSharedPreferences("vscale", MODE_PRIVATE).edit().putString("backupTree", uri.toString()).apply()
                    val label = androidx.documentfile.provider.DocumentFile.fromTreeUri(this, uri)?.name ?: "Chosen folder"
                    web.evaluateJavascript("window.__native&&window.__native.backupFolder(${org.json.JSONObject.quote(label)})", null)
                }
            }
            REQ_SAVE -> {
                val uri = data?.data
                val text = pendingSave
                pendingSave = null
                if (resultCode == RESULT_OK && uri != null && text != null) {
                    try {
                        contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
                        web.evaluateJavascript("window.__toast&&window.__toast('Saved')", null)
                    } catch (e: Exception) {
                        ble.emitError("Could not save the file: ${e.message}")
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        ble.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val REQ_PERM = 1
        private const val REQ_SAVE = 2
        private const val REQ_OPEN = 3
        private const val REQ_TREE = 4
        private const val REQ_NOTIFY = 5
    }
}
