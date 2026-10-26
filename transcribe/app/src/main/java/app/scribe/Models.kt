package app.scribe

import android.content.Context
import java.io.File

/** Copies a bundled Vosk model out of the APK assets into private storage the first time it is
 *  needed (Vosk needs a real filesystem path). Guarded by a .ready marker so it only copies once. */
object Models {

    fun ensure(ctx: Context, code: String): File {
        val dest = File(ctx.filesDir, "model-$code")
        val marker = File(dest, ".ready")
        if (marker.exists()) return dest
        if (dest.exists()) dest.deleteRecursively()
        copyAsset(ctx, "model-$code", dest)
        marker.writeText("ok")
        return dest
    }

    private fun copyAsset(ctx: Context, assetPath: String, dest: File) {
        val children = runCatching { ctx.assets.list(assetPath) }.getOrNull() ?: emptyArray()
        if (children.isEmpty()) {
            // leaf: it's a file
            dest.parentFile?.mkdirs()
            ctx.assets.open(assetPath).use { input -> dest.outputStream().use { input.copyTo(it) } }
        } else {
            dest.mkdirs()
            for (c in children) copyAsset(ctx, "$assetPath/$c", File(dest, c))
        }
    }
}
