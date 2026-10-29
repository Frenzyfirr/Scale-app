plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.tappay"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.tappay"
        minSdk = 26            // Stripe Terminal SDK requires 26+ (Tap to Pay needs Android 13+ at runtime)
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
    signingConfigs {
        create("shared") {
            storeFile = file("tappay.keystore")
            storePassword = "tappay-demo"
            keyAlias = "tappay"
            keyPassword = "tappay-demo"
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
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // Stripe Terminal + Tap to Pay on Android
    implementation("com.stripe:stripeterminal-taptopay:6.0.0")
    implementation("com.stripe:stripeterminal-core:6.0.0")
}
