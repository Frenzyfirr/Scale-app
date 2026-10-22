package com.sketchtoplan.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/** Shows the bundled Sketch to Plan page full screen and lets it open pictures and save files. */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingBytes: ByteArray? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        setContentView(web)

        // A fixed https origin, so projects saved in the page's storage stay put between updates.
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
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val accept = params.acceptTypes.joinToString(",")
                val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (accept.contains("image")) "image/*" else "*/*"
                }
                return try { startActivityForResult(Intent.createChooser(pick, "Choose a file"), REQ_OPEN); true } catch (_: Exception) {
                    fileCallback = null; false
                }
            }
        }
        web.addJavascriptInterface(Bridge(), "AndroidApp")
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    inner class Bridge {
        /** The page hands over a file as base64; Android asks where to save it. */
        @JavascriptInterface
        fun saveFile(name: String, base64: String, mime: String) {
            val bytes = try { Base64.decode(base64, Base64.DEFAULT) } catch (_: Exception) { null } ?: return
            runOnUiThread {
                pendingBytes = bytes
                val create = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime.ifBlank { "application/octet-stream" }
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                try { startActivityForResult(create, REQ_SAVE) } catch (_: Exception) { pendingBytes = null; toast("No app to save files was found.") }
            }
        }
    }

    private fun toast(msg: String) {
        web.evaluateJavascript("(function(m){var d=document.createElement('div');d.className='toast';d.textContent=m;document.body.appendChild(d);setTimeout(function(){d.remove()},2600)})(${JSONObject.quote(msg)})", null)
    }

    @Deprecated("Simple activity results")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_OPEN -> {
                val uri = if (resultCode == RESULT_OK) data?.data else null
                fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
                fileCallback = null
            }
            REQ_SAVE -> {
                val uri = data?.data; val bytes = pendingBytes; pendingBytes = null
                if (resultCode == RESULT_OK && uri != null && bytes != null) {
                    try { contentResolver.openOutputStream(uri)?.use { it.write(bytes) }; toast("Saved") }
                    catch (e: Exception) { toast("Could not save: ${e.message}") }
                }
            }
        }
    }

    @Deprecated("Back closes open dialogs in the page first")
    override fun onBackPressed() {
        web.evaluateJavascript("(function(){var m=document.getElementById('modal');if(m&&!m.hidden){m.hidden=true;return 'closed'}return 'none'})()") { r ->
            if (r != null && r.contains("closed")) return@evaluateJavascript
            @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    companion object { private const val REQ_OPEN = 1; private const val REQ_SAVE = 2 }
}
