package app.tapkit

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

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
        val flags = NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
                NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V or
                NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS
        val extras = Bundle()
        extras.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250)
        runCatching { nfc?.enableReaderMode(this, this, flags, extras) }
        postState()
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

        @JavascriptInterface
        fun getState(): String = when {
            nfc == null -> "absent"
            nfc?.isEnabled != true -> "disabled"
            else -> "ready"
        }
    }
}
