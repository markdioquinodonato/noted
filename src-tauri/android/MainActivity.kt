package ph.noted.app

import android.content.res.Configuration
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Noted's Android entry point. Copied over the Tauri template by
 * scripts/android-prepare.sh after `tauri android init` (src-tauri/gen is generated).
 *
 * Android 15+ always draws apps edge-to-edge, so without this the web UI would sit
 * under the status bar, the gesture/navigation bar and the on-screen keyboard. The
 * WebView is padded to the safe area instead, which also makes the editor shrink
 * above the keyboard while typing (adjustResize does not apply edge-to-edge).
 * The padded strips are painted in the app's own light/dark background colour.
 */
class MainActivity : TauriActivity() {
  private lateinit var content: View

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    content = findViewById(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }

    // Until the web app reports its theme, follow the system (the app's default).
    val night = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    applyTheme(night == Configuration.UI_MODE_NIGHT_YES)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    // Called by src/lib/theme.ts whenever the resolved app theme changes.
    webView.addJavascriptInterface(ThemeBridge(), "NotedAndroid")
  }

  private fun applyTheme(dark: Boolean) {
    // Same values as --background in src/index.css.
    content.setBackgroundColor(if (dark) Color.rgb(0x0d, 0x15, 0x20) else Color.WHITE)
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = !dark
      isAppearanceLightNavigationBars = !dark
    }
  }

  private inner class ThemeBridge {
    @JavascriptInterface
    fun setTheme(theme: String) {
      runOnUiThread { if (::content.isInitialized) applyTheme(theme == "dark") }
    }
  }
}
