package app.tappay

import android.app.Application
import com.stripe.stripeterminal.TerminalApplicationDelegate

/** Stripe Terminal needs this hook in Application.onCreate. */
class TapPayApp : Application() {
    override fun onCreate() {
        super.onCreate()
        TerminalApplicationDelegate.onCreate(this)
    }
}
