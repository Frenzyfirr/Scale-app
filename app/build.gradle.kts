plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.vscale.offline"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.vscale.offline"
        minSdk = 26
        targetSdk = 34
        versionCode = 2
        versionName = "0.4"
    }

    // One fixed key, so new builds install over the old one and keep your data.
    signingConfigs {
        create("shared") {
            storeFile = file("vscale.keystore")
            storePassword = "vscale-offline"
            keyAlias = "vscale"
            keyPassword = "vscale-offline"
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("shared")
        }
        getByName("debug") { signingConfig = signingConfigs.getByName("shared") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.documentfile:documentfile:1.0.1")
}
