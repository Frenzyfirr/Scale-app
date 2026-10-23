package app.tapkit

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Tapkit. A WebView holds the simple UI; all NFC happens natively here, because NFC is not
 * available to web pages. The page sets a pending operation (scan / dump / write UID / read or
 * write NDEF); when a card is tapped, reader mode fires [onTagDiscovered] on a background thread,
 * we run the operation, and post the result back into the page via window.onNfcResult(...).
 */
class MainActivity : Activity(), NfcAdapter.ReaderCallback {

    private lateinit var web: WebView
    private var nfc: NfcAdapter? = null

    @Volatile private var pending: JSONObject = JSONObject().put("op", "scan")

    // Saved scans live in a small JSON file in the app's private storage.
    private val cardsFile by lazy { File(filesDir, "cards.json") }
    private var pendingExport: ByteArray? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        nfc = NfcAdapter.getDefaultAdapter(this)
        web = WebView(this)
        setContentView(web)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)
        }
        web.addJavascriptInterface(Bridge(), "Native")
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    override fun onResume() {
        super.onResume()
        startReader()
        postState()
    }

    private fun startReader() {
        val flags = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
                NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V or
                NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
        val extras = Bundle()
        extras.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250)
        runCatching { nfc?.enableReaderMode(this, this, flags, extras) }
    }

    /** Re-arm the reader so a card that is ALREADY on the phone gets re-delivered. Reader mode
     *  only fires for a tag newly entering the field, so without this, arming an action while the
     *  card sits on the phone would wait forever until the card is lifted and tapped again. */
    private fun rearm() {
        runOnUiThread {
            runCatching { nfc?.disableReaderMode(this) }
            runCatching { startReader() }
        }
    }

    override fun onPause() {
        super.onPause()
        runCatching { nfc?.disableReaderMode(this) }
    }

    /** Runs on a background thread while the card is in the field. */
    override fun onTagDiscovered(tag: Tag) {
        val op = pending
        val name = op.optString("op", "scan")
        val out = JSONObject()
        out.put("op", name)
        try {
            out.put("tag", NfcOps.identify(tag))
            when (name) {
                "magic" -> out.put("result", NfcOps.detectMagic(tag, keyList(op)))
                "dump" -> out.put("result", NfcOps.dumpClassic(tag, keyList(op)))
                "writeUid" -> {
                    out.put("result", NfcOps.writeUidMagic(tag, op.optString("uid"), keyList(op)))
                    pending = JSONObject().put("op", "scan")   // one-shot; don't re-write on the next tap
                }
                "readNdef" -> out.put("result", NfcOps.readNdef(tag))
                "writeNdef" -> {
                    out.put("result", NfcOps.writeNdef(tag, op.optString("kind"), op.optString("value")))
                    pending = JSONObject().put("op", "scan")
                }
                else -> { /* scan: identify only */ }
            }
        } catch (e: Exception) {
            out.put("result", JSONObject().put("ok", false).put("error", "Tag left the field too soon or is unreadable: ${e.message}"))
        }
        post("window.onNfcResult(" + out.toString() + ")")
    }

    private fun keyList(op: JSONObject): List<String> {
        val arr = op.optJSONArray("keys") ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }.filter { it.isNotBlank() }
    }

    private fun postState() {
        val s = when {
            nfc == null -> "absent"
            nfc?.isEnabled != true -> "disabled"
            else -> "ready"
        }
        post("window.onNfcState && window.onNfcState('$s')")
    }

    private fun post(js: String) {
        runOnUiThread { runCatching { web.evaluateJavascript(js, null) } }
    }

    inner class Bridge {
        @JavascriptInterface
        fun setOp(json: String) {
            pending = runCatching { JSONObject(json) }.getOrDefault(JSONObject().put("op", "scan"))
        }

        /** Set the operation AND re-read a card already on the phone, so the user can rest the
         *  card down and then tap an action without having to lift and re-present it. */
        @JavascriptInterface
        fun armOp(json: String) {
            pending = runCatching { JSONObject(json) }.getOrDefault(JSONObject().put("op", "scan"))
            rearm()
        }

        @JavascriptInterface
        fun getState(): String = when {
            nfc == null -> "absent"
            nfc?.isEnabled != true -> "disabled"
            else -> "ready"
        }

        @JavascriptInterface
        fun listCards(): String {
            val t = runCatching { if (cardsFile.exists()) cardsFile.readText() else "[]" }.getOrDefault("[]")
            return t.ifBlank { "[]" }
        }

        @JavascriptInterface
        fun saveCard(json: String): String {
            return try {
                val arr = JSONArray(listCards())
                val rec = JSONObject(json)
                val id = System.currentTimeMillis().toString()
                rec.put("id", id)
                arr.put(rec)
                cardsFile.writeText(arr.toString())
                id
            } catch (e: Exception) {
                ""
            }
        }

        @JavascriptInterface
        fun removeCard(id: String) {
            runCatching {
                val arr = JSONArray(listCards())
                val out = JSONArray()
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    if (o.optString("id") != id) out.put(o)
                }
                cardsFile.writeText(out.toString())
            }
        }

        @JavascriptInterface
        fun clearCards() {
            runCatching { cardsFile.writeText("[]") }
        }

        /** Hand the user a Save-As dialog (SAF) to write a text/CSV file wherever they choose. */
        @JavascriptInterface
        fun exportText(name: String, text: String, mime: String) {
            pendingExport = text.toByteArray(Charsets.UTF_8)
            runOnUiThread {
                val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (mime.isBlank()) "text/plain" else mime
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                runCatching { startActivityForResult(i, REQ_EXPORT) }.onFailure {
                    pendingExport = null
                    post("window.__toast && window.__toast('No file app to save with.')")
                }
            }
        }
    }

    @Deprecated("Simple SAF result")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_EXPORT) {
            val uri: Uri? = data?.data
            val bytes = pendingExport
            pendingExport = null
            if (resultCode == RESULT_OK && uri != null && bytes != null) {
                val ok = runCatching { contentResolver.openOutputStream(uri)?.use { it.write(bytes) } }.isSuccess
                post("window.__toast && window.__toast('" + (if (ok) "Saved" else "Could not save") + "')")
            }
        }
    }

    companion object { private const val REQ_EXPORT = 7 }
}
