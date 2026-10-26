#include <jni.h>
#include <string>
#include <vector>
#include "whisper.h"

extern "C" JNIEXPORT jlong JNICALL
Java_app_scribe_WhisperJni_initContext(JNIEnv* env, jclass, jstring path) {
    const char* p = env->GetStringUTFChars(path, nullptr);
    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;
    whisper_context* ctx = whisper_init_from_file_with_params(p, cparams);
    env->ReleaseStringUTFChars(path, p);
    return (jlong)(intptr_t) ctx;
}

extern "C" JNIEXPORT void JNICALL
Java_app_scribe_WhisperJni_freeContext(JNIEnv*, jclass, jlong ptr) {
    if (ptr) whisper_free((whisper_context*)(intptr_t) ptr);
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_scribe_WhisperJni_transcribe(JNIEnv* env, jclass, jlong ptr, jint nThreads,
                                      jfloatArray audio, jstring lang) {
    whisper_context* ctx = (whisper_context*)(intptr_t) ptr;
    if (!ctx) return env->NewStringUTF("");

    jsize n = env->GetArrayLength(audio);
    std::vector<float> samples((size_t) n);
    if (n > 0) env->GetFloatArrayRegion(audio, 0, n, samples.data());

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_realtime   = false;
    params.print_progress   = false;
    params.print_timestamps = false;
    params.print_special    = false;
    params.translate        = false;
    params.no_context       = true;
    params.single_segment   = false;
    params.n_threads        = nThreads > 0 ? nThreads : 4;

    const char* l = env->GetStringUTFChars(lang, nullptr);
    // "auto" lets whisper detect; otherwise a 2-letter code like "pl".
    params.language = l;
    params.detect_language = false;

    std::string out;
    if (whisper_full(ctx, params, samples.data(), (int) n) == 0) {
        int segs = whisper_full_n_segments(ctx);
        for (int i = 0; i < segs; i++) {
            const char* t = whisper_full_get_segment_text(ctx, i);
            if (t) out += t;
        }
    }
    env->ReleaseStringUTFChars(lang, l);

    // trim leading space whisper often adds
    size_t start = out.find_first_not_of(' ');
    if (start != std::string::npos && start > 0) out = out.substr(start);
    return env->NewStringUTF(out.c_str());
}
