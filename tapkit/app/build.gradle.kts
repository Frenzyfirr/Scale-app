plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.tapkit"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.tapkit"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // One fixed key, so new builds install over the old one.
    signingConfigs {
        create("shared") {
            storeFile = file("tapkit.keystore")
            storePassword = "tapkit-nfc"
            keyAlias = "tapkit"
            keyPassword = "tapkit-nfc"
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
