plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.scribe"
    compileSdk = 34
    ndkVersion = "26.1.10909125"

    defaultConfig {
        applicationId = "app.scribe"
        minSdk = 24
        targetSdk = 34
        versionCode = 3
        versionName = "2.1"
        ndk { abiFilters += listOf("arm64-v8a") }   // whisper.cpp native build; covers all modern phones
        externalNativeBuild { cmake { cppFlags += "-std=c++17" } }
    }

    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" } }

    // One fixed key, so new builds install over the old one.
    signingConfigs {
        create("shared") {
            storeFile = file("scribe.keystore")
            storePassword = "scribe-offline"
            keyAlias = "scribe"
            keyPassword = "scribe-offline"
        }
    }
    buildTypes {
        getByName("release") { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("shared") }
        getByName("debug") { signingConfig = signingConfigs.getByName("shared") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}
