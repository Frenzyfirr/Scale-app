plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.scribe"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.scribe"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
    }

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
    implementation("com.alphacephei:vosk-android:0.3.47")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
}
