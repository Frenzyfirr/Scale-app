plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sketchtoplan.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.sketchtoplan.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // One fixed key, so new builds install over the old one and keep your projects.
    signingConfigs {
        create("shared") {
            storeFile = file("sketchplan.keystore")
            storePassword = "sketch-to-plan"
            keyAlias = "sketchplan"
            keyPassword = "sketch-to-plan"
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
