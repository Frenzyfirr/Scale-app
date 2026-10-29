package app.tappay

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.stripe.stripeterminal.Terminal
import com.stripe.stripeterminal.external.callable.Callback
import com.stripe.stripeterminal.external.callable.ConnectionTokenCallback
import com.stripe.stripeterminal.external.callable.ConnectionTokenProvider
import com.stripe.stripeterminal.external.callable.DiscoveryListener
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback
import com.stripe.stripeterminal.external.callable.ReaderCallback
import com.stripe.stripeterminal.external.callable.TapToPayReaderListener
import com.stripe.stripeterminal.external.callable.TerminalListener
import com.stripe.stripeterminal.external.models.ConnectionConfiguration
import com.stripe.stripeterminal.external.models.ConnectionTokenException
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration
import com.stripe.stripeterminal.external.models.PaymentIntent
import com.stripe.stripeterminal.external.models.Reader
import com.stripe.stripeterminal.external.models.TerminalException
import com.stripe.stripeterminal.log.LogLevel
import org.json.JSONObject

/**
 * Minimal Stripe Tap to Pay (on Android) merchant screen.
 *
 * Flow: set backend URL + location id → Connect (discover + connect the Tap to Pay reader) →
 * enter amount → Charge (backend makes a PaymentIntent, SDK collects the tap, confirm).
 *
 * The secret key lives only on the backend; this app talks to it over HTTPS and never sees it.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var prefs: android.content.SharedPreferences
    private lateinit var backendInput: EditText
    private lateinit var locationInput: EditText
    private lateinit var amountInput: EditText
    private lateinit var status: TextView
    private lateinit var connectBtn: Button
    private lateinit var chargeBtn: Button

    @Volatile private var connectedReader: Reader? = null

    private val backend get() = backendInput.text.toString().trim().trimEnd('/')
    private val locationId get() = locationInput.text.toString().trim()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("tappay", Context.MODE_PRIVATE)
        setContentView(buildUi())
        backendInput.setText(prefs.getString("backend", ""))
        locationInput.setText(prefs.getString("location", ""))
        ensureLocationPermission()
    }

    // ---- UI (built in code to keep the project tiny) --------------------------------------

    private fun buildUi(): LinearLayout {
        fun lp() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad) }

        root.addView(TextView(this).apply { text = "TapPay — Stripe Tap to Pay"; textSize = 20f; setTypeface(typeface, android.graphics.Typeface.BOLD) })

        backendInput = EditText(this).apply { hint = "Backend URL (https://…)"; inputType = InputType.TYPE_TEXT_VARIATION_URI; layoutParams = lp() }
        locationInput = EditText(this).apply { hint = "Stripe Location id (tml_…)"; layoutParams = lp() }
        root.addView(label("Backend")); root.addView(backendInput)
        root.addView(label("Location id")); root.addView(locationInput)

        connectBtn = Button(this).apply { text = "Connect reader"; layoutParams = lp(); setOnClickListener { onConnect() } }
        root.addView(connectBtn)

        amountInput = EditText(this).apply { hint = "Amount, e.g. 10.00"; inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL; layoutParams = lp() }
        root.addView(label("Amount (PLN)")); root.addView(amountInput)

        chargeBtn = Button(this).apply { text = "Charge"; isEnabled = false; layoutParams = lp(); setOnClickListener { onCharge() } }
        root.addView(chargeBtn)

        status = TextView(this).apply { setPadding(0, pad, 0, 0); gravity = Gravity.START }
        root.addView(status)
        setStatus("Enter your backend URL and Location id, then Connect.")
        return root
    }

    private fun label(t: String) = TextView(this).apply { text = t; setPadding(0, 18, 0, 2); setTextColor(Color.GRAY); textSize = 12f }

    // ---- Terminal setup -------------------------------------------------------------------

    private fun onConnect() {
        if (backend.isEmpty() || locationId.isEmpty()) { setStatus("Set backend URL and Location id first."); return }
        prefs.edit().putString("backend", backend).putString("location", locationId).apply()
        if (!hasLocationPermission()) { ensureLocationPermission(); setStatus("Grant location permission, then Connect again."); return }

        try {
            if (!Terminal.isInitialized()) {
                Terminal.initTerminal(
                    applicationContext,
                    LogLevel.ERROR,
                    object : ConnectionTokenProvider {
                        override fun fetchConnectionToken(callback: ConnectionTokenCallback) {
                            try {
                                val resp = Http.post("$backend/connection_token", "{}")
                                callback.onSuccess(JSONObject(resp).getString("secret"))
                            } catch (e: Exception) {
                                callback.onFailure(ConnectionTokenException("Could not fetch connection token", e))
                            }
                        }
                    },
                    object : TerminalListener {}
                )
            }
        } catch (e: Exception) {
            setStatus("Init failed: ${e.message}"); return
        }

        setStatus("Looking for the Tap to Pay reader…")
        val discoveryConfig = DiscoveryConfiguration.TapToPayDiscoveryConfiguration(isSimulated = false)
        Terminal.getInstance().discoverReaders(discoveryConfig, object : DiscoveryListener {
            override fun onUpdateDiscoveredReaders(readers: List<Reader>) {
                val reader = readers.firstOrNull() ?: return
                if (connectedReader != null) return
                val config = ConnectionConfiguration.TapToPayConnectionConfiguration(
                    locationId,
                    true,
                    object : TapToPayReaderListener {}
                )
                Terminal.getInstance().connectReader(reader, config, object : ReaderCallback {
                    override fun onSuccess(reader: Reader) {
                        connectedReader = reader
                        runOnUiThread { chargeBtn.isEnabled = true; setStatus("Reader connected. Ready to charge.") }
                    }
                    override fun onFailure(e: TerminalException) { setStatus("Connect failed: ${e.errorMessage}") }
                })
            }
        }, object : Callback {
            override fun onSuccess() {}
            override fun onFailure(e: TerminalException) { setStatus("Discovery failed: ${e.errorMessage}") }
        })
    }

    // ---- Take a payment -------------------------------------------------------------------

    private fun onCharge() {
        val major = amountInput.text.toString().replace(',', '.').toDoubleOrNull()
        if (major == null || major <= 0) { setStatus("Enter a valid amount."); return }
        val minor = Math.round(major * 100)   // PLN → grosze
        setStatus("Creating charge…")
        Thread {
            try {
                val body = JSONObject().put("amount", minor).put("currency", "pln").toString()
                val resp = Http.post("$backend/create_payment_intent", body)
                val clientSecret = JSONObject(resp).getString("client_secret")
                Terminal.getInstance().retrievePaymentIntent(clientSecret, object : PaymentIntentCallback {
                    override fun onSuccess(paymentIntent: PaymentIntent) {
                        setStatus("Tap the card to the phone…")
                        Terminal.getInstance().collectPaymentMethod(paymentIntent, object : PaymentIntentCallback {
                            override fun onSuccess(collected: PaymentIntent) {
                                Terminal.getInstance().confirmPaymentIntent(collected, object : PaymentIntentCallback {
                                    override fun onSuccess(confirmed: PaymentIntent) {
                                        runOnUiThread { amountInput.text.clear(); setStatus("Approved ✓  (${major} PLN)") }
                                    }
                                    override fun onFailure(e: TerminalException) { setStatus("Declined: ${e.errorMessage}") }
                                })
                            }
                            override fun onFailure(e: TerminalException) { setStatus("Collection failed: ${e.errorMessage}") }
                        })
                    }
                    override fun onFailure(e: TerminalException) { setStatus("PaymentIntent error: ${e.errorMessage}") }
                })
            } catch (e: Exception) {
                setStatus("Backend error: ${e.message}")
            }
        }.start()
    }

    // ---- permissions / helpers ------------------------------------------------------------

    private fun hasLocationPermission() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun ensureLocationPermission() {
        if (!hasLocationPermission())
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), 1)
    }

    private fun setStatus(s: String) = runOnUiThread { status.text = s }
}
