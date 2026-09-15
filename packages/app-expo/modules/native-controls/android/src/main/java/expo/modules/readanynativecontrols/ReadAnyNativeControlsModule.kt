package expo.modules.readanynativecontrols

import android.app.AlertDialog
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.view.WindowInsetsControllerCompat
import android.text.InputType
import android.widget.EditText
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.FileInputStream
import java.io.InputStream
import java.net.URL
import java.util.Locale

class ReadAnyNativeControlsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReadAnyNativeControls")

    AsyncFunction("setNavigationBarTheme") { background: String, dark: Boolean ->
      appContext.currentActivity?.let { activity ->
        activity.runOnUiThread {
          val window = activity.window
          // Older Android paints the bar; edge-to-edge uses the screen behind it.
          @Suppress("DEPRECATION")
          window.navigationBarColor = Color.parseColor(background)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
          }
          WindowInsetsControllerCompat(window, window.decorView)
            .isAppearanceLightNavigationBars = !dark
        }
      }
    }

    AsyncFunction("averageTopImageColor") Coroutine {
      uri: String,
      fraction: Double ->
      withContext(Dispatchers.IO) {
        averageBottomImageColor(uri, fraction, fromTop = true)
      }
    }

    AsyncFunction("averageBottomImageColor") Coroutine {
      uri: String,
      bottomFraction: Double ->
      withContext(Dispatchers.IO) {
        averageBottomImageColor(uri, bottomFraction)
      }
    }

    AsyncFunction("promptForText") {
      title: String,
      message: String,
      placeholder: String,
      cancelLabel: String,
      confirmLabel: String,
      promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject(CodedException("Не удалось открыть системный диалог"))
        return@AsyncFunction
      }

      activity.runOnUiThread {
        val input = EditText(activity).apply {
          hint = placeholder
          inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
          isSingleLine = true
          setPadding(48, 0, 48, 0)
        }
        var completed = false
        fun resolveOnce(value: String?) {
          if (completed) return
          completed = true
          promise.resolve(value)
        }

        val dialog = AlertDialog.Builder(activity)
          .setTitle(title)
          .setMessage(message)
          .setView(input)
          .setNegativeButton(cancelLabel) { _, _ -> resolveOnce(null) }
          .setPositiveButton(confirmLabel) { _, _ -> resolveOnce(input.text.toString()) }
          .create()

        dialog.setOnCancelListener { resolveOnce(null) }
        dialog.setOnDismissListener { resolveOnce(null) }
        dialog.window?.setSoftInputMode(
          android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE,
        )
        dialog.setOnShowListener {
          input.requestFocus()
          dialog.window?.setSoftInputMode(
            android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE,
          )
        }
        dialog.show()
      }
    }
  }

  private fun openImageStream(uri: String): InputStream {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme?.lowercase(Locale.US)) {
      "content" -> appContext.reactContext?.contentResolver?.openInputStream(parsed)
        ?: throw CodedException("Не удалось открыть изображение")
      "http", "https" -> URL(uri).openStream()
      "file" -> FileInputStream(parsed.path ?: throw CodedException("Некорректный путь"))
      else -> FileInputStream(uri)
    }
  }

  private fun averageBottomImageColor(uri: String, bottomFraction: Double, fromTop: Boolean = false): String {
    val bitmap = openImageStream(uri).use { stream -> BitmapFactory.decodeStream(stream) }
      ?: throw CodedException("Не удалось декодировать изображение")
    try {
      val fraction = bottomFraction.coerceIn(0.05, 1.0)
      val startY = if (fromTop) 0 else (bitmap.height * (1.0 - fraction)).toInt().coerceIn(0, bitmap.height - 1)
      val endY = if (fromTop) (bitmap.height * fraction).toInt().coerceIn(1, bitmap.height) else bitmap.height
      var red = 0L
      var green = 0L
      var blue = 0L
      var alpha = 0L

      for (y in startY until endY) {
        for (x in 0 until bitmap.width) {
          val pixel = bitmap.getPixel(x, y)
          val pixelAlpha = Color.alpha(pixel).toLong()
          red += Color.red(pixel) * pixelAlpha
          green += Color.green(pixel) * pixelAlpha
          blue += Color.blue(pixel) * pixelAlpha
          alpha += pixelAlpha
        }
      }

      if (alpha == 0L) throw CodedException("Изображение полностью прозрачное")
      return String.format(
        Locale.US,
        "#%02x%02x%02x",
        (red / alpha).toInt(),
        (green / alpha).toInt(),
        (blue / alpha).toInt(),
      )
    } finally {
      if (!bitmap.isRecycled) bitmap.recycle()
    }
  }
}
