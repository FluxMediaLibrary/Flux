plugins {
    id("com.android.application")
}

val fluxKeystorePassword = rootProject.file("../.twa-keystore-password.txt")
    .takeIf { it.exists() }
    ?.readText()
    ?.trim()
    ?: providers.gradleProperty("FLUX_KEYSTORE_PASSWORD").orElse("").get()

android {
    namespace = "xyz.deadstudios.flux"
    compileSdk = 35

    defaultConfig {
        applicationId = "xyz.deadstudios.flux"
        minSdk = 21
        targetSdk = 35
        versionCode = 11
        versionName = "1.1.6"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            storeFile = file("../../flux-release.keystore")
            storePassword = fluxKeystorePassword
            keyAlias = "flux"
            keyPassword = fluxKeystorePassword
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }
}

configurations.configureEach {
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk7")
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk8")
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core:1.15.0")
    implementation("androidx.mediarouter:mediarouter:1.7.0")
    implementation("com.google.android.gms:play-services-cast-framework:22.0.0")
}
