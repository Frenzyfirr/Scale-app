package app.scribe

import android.content.Context
import java.io.File

/** Copies the bundled ggml Whisper model out of the APK to a real file path on first run
 *  (whisper needs a filesystem path). Guarded so it only copies once. */
object WhisperModel {
    private const val ASSET = "whisper/ggml-base.bin"
    private const val NAME = "ggml-base.bin"

    fun ensure(ctx: Context): File {
        val dest = File(ctx.filesDir, NAME)
        val marker = File(ctx.filesDir, "$NAME.ready")
        if (marker.exists() && dest.exists()) return dest
        ctx.assets.open(ASSET).use { input -> dest.outputStream().use { input.copyTo(it, 1 shl 20) } }
        marker.writeText("ok")
        return dest
    }
}
