package app.scribe

/** Thin JNI bridge to whisper.cpp (compiled in src/main/cpp). */
object WhisperJni {
    init { System.loadLibrary("scribe-whisper") }

    external fun initContext(path: String): Long
    external fun freeContext(ptr: Long)

    /** Transcribe 16 kHz mono float PCM (range -1..1). lang is "auto" or a 2-letter code.
     *  beamSize > 1 uses beam search (more accurate, slower); 1 uses greedy. */
    external fun transcribe(ptr: Long, nThreads: Int, audio: FloatArray, lang: String, beamSize: Int): String
}
