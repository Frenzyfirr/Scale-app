package app.scribe

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * Scribe — offline speech-to-text powered by whisper.cpp. One multilingual model (ggml-base),
 * bundled in the APK, runs entirely on the phone with no internet permission. Transcribes audio
 * files and live microphone (in ~12-second bursts), with automatic punctuation.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private val io = Executors.newSingleThreadExecutor()
    private val nThreads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)

    @Volatile private var ctxPtr: Long = 0L
    @Volatile private var modelReady = false
    @Volatile private var lang = "auto"

    @Volatile private var recording = false
    private var recThread: Thread? = null
    private var pendingSaveBytes: ByteArray? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        initModel()
    }

    private fun initModel() {
        postState("loading")
        io.execute {
            try {
                val f = WhisperModel.ensure(this)
                val ptr = WhisperJni.initContext(f.absolutePath)
                if (ptr == 0L) { postState("error", msg = "model failed to load"); return@execute }
                ctxPtr = ptr
                modelReady = true
                postState("ready")
            } catch (e: Throwable) {
                postState("error", msg = e.message ?: "init failed")
            }
        }
    }

    // ---- microphone (chunked bursts) ------------------------------------------------------

    private fun startMic() {
        if (!modelReady) { err("Still loading the model…"); return }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        if (recording) return
        recording = true
        postState("ready", mic = "recording")
        recThread = thread(start = true) {
            val rate = 16000
            val minBuf = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val rec = try {
                AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, rate * 2))
            } catch (e: Exception) { err("Mic error: ${e.message}"); recording = false; postState("ready", mic = "idle"); return@thread }
            val chunkSamples = rate * 12   // ~12 s bursts
            val acc = ArrayList<Short>(chunkSamples)
            val buf = ShortArray(minBuf.coerceAtLeast(1024))
            try {
                rec.startRecording()
                while (recording) {
                    val read = rec.read(buf, 0, buf.size)
                    for (i in 0 until read) acc.add(buf[i])
                    if (acc.size >= chunkSamples) { flushChunk(acc); acc.clear() }
                }
            } catch (e: Exception) {
                err("Mic error: ${e.message}")
            } finally {
                runCatching { rec.stop() }
                runCatching { rec.release() }
            }
            if (acc.size > rate / 2) flushChunk(acc)   // tail, if > 0.5 s
            postState("ready", mic = "idle")
        }
    }

    private fun flushChunk(samples: ArrayList<Short>) {
        val floats = FloatArray(samples.size)
        for (i in samples.indices) floats[i] = samples[i] / 32768.0f
        io.execute {
            if (ctxPtr == 0L) return@execute
            val t = runCatching { WhisperJni.transcribe(ctxPtr, nThreads, floats, lang, 1) }.getOrDefault("")
            if (t.isNotBlank()) post("window.onSegment(${q(t.trim())})")
        }
    }

    private fun stopMic() {
        recording = false
    }

    // ---- file transcription ---------------------------------------------------------------

    private fun transcribeFile(uri: Uri) {
        if (!modelReady) { err("Still loading the model…"); return }
        postState("ready", busy = true)
        io.execute {
            try {
                val pcm = ByteArrayOutputStream()
                PcmDecoder().decode(this, uri, object : PcmDecoder.Sink {
                    override fun onPcm(bytes: ByteArray, len: Int) { pcm.write(bytes, 0, len) }
                    override fun onProgress(pct: Int) { post("window.onFileProgress(${(pct * 70) / 100})") }
                })
                post("window.onFileProgress(78)")
                val floats = pcm16ToFloats(pcm.toByteArray())
                val secs = floats.size / 16000.0
                post("window.onFileInfo(${q("Audio length: %.1fs  —  should match the clip".format(secs))})")
                val text = if (ctxPtr != 0L) WhisperJni.transcribe(ctxPtr, nThreads, floats, lang, 5) else ""
                post("window.onFileProgress(100)")
                post("window.onFileText(${q(text.trim())})")
                postState("ready", busy = false)
            } catch (e: Throwable) {
                err("Could not transcribe: ${e.message}")
                postState("ready", busy = false)
            }
        }
    }

    private fun pcm16ToFloats(bytes: ByteArray): FloatArray {
        val sb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val n = sb.remaining()
        val out = FloatArray(n)
        for (i in 0 until n) out[i] = sb.get(i) / 32768.0f
        return out
    }

    // ---- bridge ---------------------------------------------------------------------------

    inner class Bridge {
        @JavascriptInterface fun setLang(code: String) { lang = if (code.isBlank()) "auto" else code }
        @JavascriptInterface fun startMic() { runOnUiThread { startMic() } }
        @JavascriptInterface fun stopMic() { runOnUiThread { stopMic() } }

        @JavascriptInterface
        fun pickFile() {
            if (!modelReady) { err("Still loading the model…"); return }
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
        fun copyText(text: String) = runOnUiThread {
            val cm = getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("transcript", text))
            post("window.onToast(${q("Copied")})")
        }

        @JavascriptInterface
        fun saveText(name: String, text: String) {
            pendingSaveBytes = text.toByteArray(Charsets.UTF_8)
            runOnUiThread {
                val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE); type = "text/plain"
                    putExtra(Intent.EXTRA_TITLE, name)
                }
                runCatching { startActivityForResult(i, REQ_SAVE) }.onFailure { pendingSaveBytes = null }
            }
        }
    }

    // ---- results / permissions ------------------------------------------------------------

    @Deprecated("startActivityForResult")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_OPEN -> (if (resultCode == RESULT_OK) data?.data else null)?.let { transcribeFile(it) }
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
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) startMic()
            else err("Microphone permission is needed to record.")
        }
    }

    override fun onPause() { super.onPause(); stopMic() }

    override fun onDestroy() {
        super.onDestroy()
        stopMic()
        val p = ctxPtr; ctxPtr = 0L
        io.execute { if (p != 0L) runCatching { WhisperJni.freeContext(p) } }
        io.shutdown()
    }

    // ---- helpers --------------------------------------------------------------------------

    private fun postState(state: String, mic: String = "idle", busy: Boolean = false, msg: String = "") {
        post("window.onState && window.onState(${q(state)}, ${q(mic)}, $busy, ${q(msg)})")
    }
    private fun err(m: String) = post("window.onError(${q(m)})")
    private fun post(js: String) { runOnUiThread { runCatching { web.evaluateJavascript(js, null) } } }
    private fun q(s: String?): String = JSONObject.quote(s ?: "")

    companion object {
        private const val REQ_MIC = 1
        private const val REQ_OPEN = 2
        private const val REQ_SAVE = 3
    }
}
