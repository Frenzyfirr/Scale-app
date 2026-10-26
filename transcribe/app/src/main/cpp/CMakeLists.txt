cmake_minimum_required(VERSION 3.18)
project(scribe-whisper CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_C_STANDARD 11)

# whisper.cpp sources are placed here by CI (git clone of a pinned tag).
set(W ${CMAKE_CURRENT_SOURCE_DIR}/whisper)

add_library(scribe-whisper SHARED
    jni.cpp
    ${W}/ggml.c
    ${W}/ggml-alloc.c
    ${W}/ggml-backend.c
    ${W}/ggml-quants.c
    ${W}/whisper.cpp
)

target_include_directories(scribe-whisper PRIVATE ${W})

target_compile_options(scribe-whisper PRIVATE -O3 -ffast-math -fvisibility=hidden -DNDEBUG)
# No GGML_USE_* backends defined: ggml uses its portable CPU path (NEON on arm64 by default).
# (Defining GGML_USE_ACCELERATE at all — even =0 — makes ggml include Apple's Accelerate header.)

find_library(log-lib log)
target_link_libraries(scribe-whisper ${log-lib})
