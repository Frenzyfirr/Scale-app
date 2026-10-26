package app.scribe

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Decodes any audio file Android can open (mp3, m4a/aac, ogg/opus, wav, flac…) into the format Vosk
 * needs: 16 kHz, mono, signed 16-bit little-endian PCM. Streams the PCM out in chunks so a long
 * recording doesn't have to fit in memory.
 */
class PcmDecoder {

    interface Sink {
        fun onPcm(bytes: ByteArray, len: Int)
        fun onProgress(pct: Int)
    }

    fun decode(ctx: Context, uri: Uri, sink: Sink) {
        val ex = MediaExtractor()
        ctx.contentResolver.openFileDescriptor(uri, "r").use { pfd ->
            ex.setDataSource(pfd!!.fileDescriptor)
        }
        var track = -1
        var format: MediaFormat? = null
        for (i in 0 until ex.trackCount) {
            val f = ex.getTrackFormat(i)
            if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
                track = i; format = f; break
            }
        }
        require(track >= 0 && format != null) { "No audio track in this file" }
        ex.selectTrack(track)

        val mime = format.getString(MediaFormat.KEY_MIME)!!
        var srcRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L

        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()

        var resampler = Resampler(srcRate, 16000, channels)
        val info = MediaCodec.BufferInfo()
        var inEos = false
        var outEos = false
        var lastPct = -1

        try {
            while (!outEos) {
                if (!inEos) {
                    val inIdx = codec.dequeueInputBuffer(10000)
                    if (inIdx >= 0) {
                        val buf = codec.getInputBuffer(inIdx)!!
                        val size = ex.readSampleData(buf, 0)
                        if (size < 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inEos = true
                        } else {
                            val pts = ex.sampleTime
                            codec.queueInputBuffer(inIdx, 0, size, pts, 0)
                            ex.advance()
                            if (durationUs > 0) {
                                val pct = (pts * 100 / durationUs).toInt().coerceIn(0, 99)
                                if (pct != lastPct) { lastPct = pct; sink.onProgress(pct) }
                            }
                        }
                    }
                }
                val outIdx = codec.dequeueOutputBuffer(info, 10000)
                when {
                    outIdx >= 0 -> {
                        if (info.size > 0) {
                            val outBuf = codec.getOutputBuffer(outIdx)!!
                            outBuf.position(info.offset)
                            outBuf.limit(info.offset + info.size)
                            val pcm = ByteArray(info.size)
                            outBuf.get(pcm)
                            val res = resampler.process(pcm)
                            if (res.isNotEmpty()) sink.onPcm(res, res.size)
                        }
                        codec.releaseOutputBuffer(outIdx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outEos = true
                    }
                    outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val nf = codec.outputFormat
                        val nr = if (nf.containsKey(MediaFormat.KEY_SAMPLE_RATE)) nf.getInteger(MediaFormat.KEY_SAMPLE_RATE) else srcRate
                        val nc = if (nf.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else channels
                        if (nr != srcRate || nc != channels) {
                            srcRate = nr; channels = nc
                            resampler = Resampler(srcRate, 16000, channels)
                        }
                    }
                }
            }
        } finally {
            runCatching { codec.stop() }
            runCatching { codec.release() }
            runCatching { ex.release() }
        }
        sink.onProgress(100)
    }

    /** Downmix to mono + linear resample to 16 kHz, carrying state across chunks. */
    private class Resampler(srcRate: Int, private val dstRate: Int, private val channels: Int) {
        private val ratio = srcRate.toDouble() / dstRate.toDouble()
        private var pos = 0.0
        private var prev = 0.0
        private var havePrev = false

        fun process(pcmBytes: ByteArray): ByteArray {
            val shorts = ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val total = pcmBytes.size / 2
            val ch = if (channels < 1) 1 else channels
            val frames = total / ch
            if (frames == 0) return ByteArray(0)
            val mono = DoubleArray(frames)
            for (f in 0 until frames) {
                var acc = 0
                for (c in 0 until ch) acc += shorts.get(f * ch + c).toInt()
                mono[f] = acc.toDouble() / ch
            }
            val out = ByteArrayOutputStream()
            while (pos < frames) {
                val i = Math.floor(pos).toInt()
                val frac = pos - i
                val s0 = sampleAt(i, mono)
                val s1 = sampleAt(i + 1, mono)
                var v = Math.round(s0 + (s1 - s0) * frac).toInt()
                if (v > 32767) v = 32767 else if (v < -32768) v = -32768
                out.write(v and 0xFF)
                out.write((v shr 8) and 0xFF)
                pos += ratio
            }
            prev = mono[frames - 1]; havePrev = true
            pos -= frames
            return out.toByteArray()
        }

        private fun sampleAt(i: Int, mono: DoubleArray): Double = when {
            i < 0 -> if (havePrev) prev else mono[0]
            i >= mono.size -> mono[mono.size - 1]
            else -> mono[i]
        }
    }
}
