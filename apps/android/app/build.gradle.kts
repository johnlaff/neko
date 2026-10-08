import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.roborazzi)
}

/**
 * The upload key stays out of Git: anyone holding it could sign an app that assetlinks.json
 * vouches for. signing.properties (gitignored) points at it; without it, release builds are
 * unsigned and CI only checks that everything compiles and the tests pass.
 */
val signing = rootProject.file("signing.properties").takeIf { it.exists() }?.let { file ->
    Properties().apply { file.inputStream().use { load(it) } }
}

android {
    namespace = "dev.johnlaff.neko"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.johnlaff.neko"
        minSdk = 28
        targetSdk = 37
        versionCode = (System.getenv("NEKO_VERSION_CODE") ?: "1").toInt()
        versionName = "0.62.0"
        buildConfigField("String", "NEKO_URL", "\"https://neko.joaoaraxaiba.workers.dev\"")
    }

    signingConfigs {
        if (signing != null) {
            create("upload") {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("password")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("password")
            }
        }
    }

    buildTypes {
        // Debug builds carry the same certificate as release when the key is present, so a
        // sideloaded build can use the site's passkeys too.
        debug {
            signingConfigs.findByName("upload")?.let { signingConfig = it }
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("upload")?.let { signingConfig = it }
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // Robolectric renders the screens on the JVM, so screenshots need no phone or emulator.
        unitTests.isIncludeAndroidResources = true
        unitTests.all { test ->
            test.jvmArgs(
                "--add-opens=java.base/java.io=ALL-UNNAMED",
                "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED",
            )
            // Robolectric downloads Android itself from Maven Central; a mirror can stand in.
            System.getenv("ROBOLECTRIC_REPO")?.let { test.systemProperty("robolectric.dependency.repo.url", it) }
            // Private views of the real sheet for RealScreensTest; never set in CI.
            System.getenv("NEKO_ANDROID_VIEWS")?.let { test.systemProperty("neko.android.views", it) }
            System.getenv("NEKO_ANDROID_PRINTS")?.let { test.systemProperty("neko.android.prints", it) }
        }
    }
}

roborazzi {
    outputDir.set(file("screenshots"))
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.glance.appwidget)
    implementation(libs.glance.material3)
    implementation(libs.work.runtime)
    implementation(libs.androidx.splashscreen)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    debugImplementation(libs.compose.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
