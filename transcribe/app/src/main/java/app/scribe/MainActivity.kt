package app.scribe

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import org.vosk.LogLevel
import org.vosk.LibVosk
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.util.concurrent.Executors

/**
 * Scribe — fully offline speech-to-text. A WebView holds the UI; all recognition is native (Vosk),
 * on the phone, with no internet permission. Supports live microphone dictation and transcribing
 * an existing audio file, in English, Polish or Spanish (models bundled in the APK).
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val io = Executors.newSingleThreadExecutor()

    @Volatile private var model: Model? = null
    @Volatile private var modelLang: String = ""
    @Volatile private var loadingLang: String = ""

    private var micRec: Recognizer? = null
    private var speech: SpeechService? = null
    private var pendingMic = false

    private var pendingSaveBytes: ByteArray? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        LibVosk.setLogLevel(LogLevel.WARNINGS)
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
        web.addJavascriptInterface(Bridge(), "Scribe")
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    // ---- model loading --------------------------------------------------------------------

    private fun loadLang(code: String) {
        if (code == modelLang && model != null) { postState(code, "ready"); return }
        if (code == loadingLang) return
        loadingLang = code
        postState(code, "loading")
        io.execute {
            try {
                val dir = Models.ensure(this, code)
                val m = Model(dir.absolutePath)
                synchronized(this) {
                    model?.close()
                    model = m
                    modelLang = code
                }
                postState(code, "ready")
            } catch (e: Exception) {
                postState(code, "error", e.message ?: "could not load model")
            } finally {
                loadingLang = ""
            }
        }
    }

    // ---- microphone -----------------------------------------------------------------------

    private fun startMic() {
        val m = model
        if (m == null) { post("window.onError(${q("Pick a language first.")})"); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingMic = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        try {
            stopMicInternal()
            val rec = Recognizer(m, 16000.0f)
            val svc = SpeechService(rec, 16000.0f)
            micRec = rec
            speech = svc
            svc.startListening(micListener)
            postState(modelLang, "ready", mic = "recording")
        } catch (e: Exception) {
            post("window.onError(${q("Mic error: ${e.message}")})")
        }
    }

    private fun stopMicInternal() {
        runCatching { speech?.stop() }
        runCatching { speech?.shutdown() }
        speech = null
        runCatching { micRec?.close() }
        micRec = null
    }

    private val micListener = object : RecognitionListener {
        override fun onPartialResult(hypothesis: String?) {
            val t = JSONObject(hypothesis ?: "{}").optString("partial")
            post("window.onPartial(${q(t)})")
        }
        override fun onResult(hypothesis: String?) {
            val t = JSONObject(hypothesis ?: "{}").optString("text")
            if (t.isNotBlank()) post("window.onSegment(${q(t)})")
        }
        override fun onFinalResult(hypothesis: String?) {
            val t = JSONObject(hypothesis ?: "{}").optString("text")
            if (t.isNotBlank()) post("window.onSegment(${q(t)})")
            postState(modelLang, "ready", mic = "idle")
        }
        override fun onError(e: Exception?) { post("window.onError(${q("Mic error: ${e?.message}")})") }
        override fun onTimeout() {}
    }

    // ---- file transcription ---------------------------------------------------------------

    private fun transcribeFile(uri: Uri) {
        val m = model ?: run { post("window.onError(${q("Pick a language first.")})"); return }
        postState(modelLang, "ready", busy = true)
        io.execute {
            var rec: Recognizer? = null
            try {
                rec = Recognizer(m, 16000.0f)
                val sb = StringBuilder()
                val r = rec
                PcmDecoder().decode(this, uri, object : PcmDecoder.Sink {
                    override fun onPcm(bytes: ByteArray, len: Int) {
                        if (r.acceptWaveForm(bytes, len)) {
                            val t = JSONObject(r.result).optString("text")
                            if (t.isNotBlank()) { sb.append(t).append(' ') }
                        } else {
                            val p = JSONObject(r.partialResult).optString("partial")
                            post("window.onPartial(${q((sb.toString() + p).trim())})")
                        }
                    }
                    override fun onProgress(pct: Int) { post("window.onFileProgress($pct)") }
                })
                val fin = JSONObject(rec.finalResult).optString("text")
                if (fin.isNotBlank()) sb.append(fin)
                post("window.onFileText(${q(sb.toString().trim())})")
                postState(modelLang, "ready", busy = false)
            } catch (e: Exception) {
                post("window.onError(${q("Could not transcribe: ${e.message}")})")
                postState(modelLang, "ready", busy = false)
            } finally {
                runCatching { rec?.close() }
            }
        }
    }

    // ---- bridge ---------------------------------------------------------------------------

    inner class Bridge {
        @JavascriptInterface
        fun setLang(code: String) { runOnUiThread { loadLang(code) } }

        @JavascriptInterface
        fun startMic() { runOnUiThread { startMic() } }

        @JavascriptInterface
        fun stopMic() { runOnUiThread { stopMicInternal(); postState(modelLang, "ready", mic = "idle") } }

        @JavascriptInterface
        fun pickFile() {
            if (model == null) { post("window.onError(${q("Pick a language first.")})"); return }
            runOnUiThread {
                val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "application/ogg"))
                }
                runCatching { startActivityForResult(i, REQ_OPEN) }
            }
        }

        @JavascriptInterface
        fun copyText(text: String) {
            runOnUiThread {
                val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("transcript", text))
                post("window.onToast(${q("Copied")})")
            }
        }

        @JavascriptInterface
        fun saveText(name: String, text: String) {
            pendingSaveBytes = text.toByteArray(Charsets.UTF_8)
            runOnUiThread {
                val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                runCatching { startActivityForResult(i, REQ_SAVE) }.onFailure { pendingSaveBytes = null }
            }
        }
    }

    // ---- activity results / permissions ---------------------------------------------------

    @Deprecated("startActivityForResult")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_OPEN -> {
                val uri = if (resultCode == RESULT_OK) data?.data else null
                if (uri != null) transcribeFile(uri)
            }
            REQ_SAVE -> {
                val uri = data?.data; val bytes = pendingSaveBytes; pendingSaveBytes = null
                if (resultCode == RESULT_OK && uri != null && bytes != null) {
                    val ok = runCatching { contentResolver.openOutputStream(uri)?.use { it.write(bytes) } }.isSuccess
                    post("window.onToast(${q(if (ok) "Saved" else "Could not save")})")
                }
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            if (pendingMic && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                pendingMic = false
                startMic()
            } else {
                pendingMic = false
                post("window.onError(${q("Microphone permission is needed to record.")})")
            }
        }
    }

    override fun onPause() {
        super.onPause()
        stopMicInternal()
        post("window.onState && window.onState(${q(modelLang)}, 'ready', 'idle', false)")
    }

    override fun onDestroy() {
        super.onDestroy()
        stopMicInternal()
        runCatching { model?.close() }
        io.shutdownNow()
    }

    // ---- helpers --------------------------------------------------------------------------

    private fun postState(lang: String, state: String, mic: String = "idle", busy: Boolean = false, msg: String = "") {
        post("window.onState && window.onState(${q(lang)}, ${q(state)}, ${q(mic)}, $busy, ${q(msg)})")
    }

    private fun post(js: String) {
        runOnUiThread { runCatching { web.evaluateJavascript(js, null) } }
    }

    private fun q(s: String?): String = JSONObject.quote(s ?: "")

    companion object {
        private const val REQ_MIC = 1
        private const val REQ_OPEN = 2
        private const val REQ_SAVE = 3
    }
}
