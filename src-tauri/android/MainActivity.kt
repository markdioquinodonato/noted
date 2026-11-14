package ph.noted.app

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Noted's Android entry point. Copied over the Tauri template by
 * scripts/android-prepare.sh after `tauri android init` (src-tauri/gen is generated).
 *
 * Android 15+ always draws apps edge-to-edge, so without this the web UI would sit
 * under the status bar, the gesture/navigation bar and the on-screen keyboard. The
 * WebView is padded to the safe area instead, which also makes the editor shrink
 * above the keyboard while typing (adjustResize does not apply edge-to-edge).
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }
}
