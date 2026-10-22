plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.marginnotes.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.marginnotes.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // One fixed key, so new builds install over the old one and keep your notes.
    signingConfigs {
        create("shared") {
            storeFile = file("marginnotes.keystore")
            storePassword = "margin-notes"
            keyAlias = "marginnotes"
            keyPassword = "margin-notes"
        }
    }
    buildTypes {
        getByName("release") { isMinifyEnabled = false; signingConfig = signingConfigs.getByName("shared") }
        getByName("debug") { signingConfig = signingConfigs.getByName("shared") }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
}
