package com.household.account.e2e

import android.app.Application
import android.content.Context
import android.util.Base64
import androidx.test.runner.AndroidJUnitRunner
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.appcheck.AppCheckProvider
import com.google.firebase.appcheck.AppCheckProviderFactory
import com.google.firebase.appcheck.AppCheckToken
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.functions.FirebaseFunctions
import com.household.account.HouseholdAccountApplication
import com.household.account.server.FirebaseAuthenticatedCallableGateway
import org.json.JSONObject

@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class FirebaseEmulatorE2E

/** 실제 Application을 실행하며 Firebase 프로젝트와 외부 AppCheck 공급자만 격리합니다. */
class FirebaseEmulatorTestRunner : AndroidJUnitRunner() {
    override fun newApplication(cl: ClassLoader, className: String, context: Context): Application {
        check(className == HouseholdAccountApplication::class.java.name) {
            "Firebase E2E must run the production Application"
        }
        return super.newApplication(cl, className, context)
    }

    override fun callApplicationOnCreate(application: Application) {
        // LoadedApk has now attached the Application and installed its applicationContext.
        // Firebase Messaging initializes GoogleApi clients, which cannot use the pre-attach Context.
        check(application.javaClass == HouseholdAccountApplication::class.java)
        check(application.applicationContext === application)
        check(FirebaseApp.getApps(application).isEmpty()) {
            "A Firebase app was initialized before the isolated Emulator runner"
        }
        val app = FirebaseApp.initializeApp(application, FirebaseOptions.Builder()
            .setProjectId(PROJECT_ID)
            .setApplicationId("1:1234567890:android:0000000000000000000000")
            // Installations validates the API-key shape even when callable/Auth use Emulators.
            // A syntactically valid dummy is sufficient; no production key is used.
            .setApiKey("AIzaSy" + "0".repeat(33))
            .build())
        check(app.options.projectId == PROJECT_ID)
        FirebaseAuth.getInstance(app).useEmulator(HOST, 9099)
        FirebaseFirestore.getInstance(app).apply {
            firestoreSettings = FirebaseFirestoreSettings.Builder()
                .setPersistenceEnabled(false).build()
            useEmulator(HOST, 8080)
        }
        FirebaseFunctions.getInstance(app, FirebaseAuthenticatedCallableGateway.REGION)
            .useEmulator(HOST, 5001)
        // Preserve production startup scheduling and its real FCM/outbox recovery work.
        super.callApplicationOnCreate(application)
        // Replace only external Play Integrity attestation. The actual Functions SDK supplies
        // this header to the Emulator's normal callable App Check validation boundary.
        FirebaseAppCheck.getInstance(app).installAppCheckProviderFactory(AppCheckProviderFactory { requestedApp ->
            check(requestedApp.options.projectId == PROJECT_ID && HOST == "10.0.2.2")
            AppCheckProvider {
                val issuedAt = System.currentTimeMillis() / 1000
                val expiration = issuedAt + 3600
                fun encode(value: JSONObject) = Base64.encodeToString(value.toString().toByteArray(),
                    Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                val token = encode(JSONObject().put("alg", "none").put("typ", "JWT")) + "." +
                    encode(JSONObject().put("sub", requestedApp.options.applicationId)
                        .put("aud", PROJECT_ID).put("iat", issuedAt).put("exp", expiration)) + "."
                Tasks.forResult(object : AppCheckToken() {
                    override fun getToken(): String = token
                    override fun getExpireTimeMillis(): Long = expiration * 1000
                })
            }
        })
    }

    companion object {
        const val PROJECT_ID = "demo-household-account-e2e"
        private const val HOST = "10.0.2.2"
    }
}
