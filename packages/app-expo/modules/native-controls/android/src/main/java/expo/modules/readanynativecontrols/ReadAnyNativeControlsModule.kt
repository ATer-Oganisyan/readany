package expo.modules.readanynativecontrols

import android.app.AlertDialog
import android.text.InputType
import android.widget.EditText
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ReadAnyNativeControlsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReadAnyNativeControls")

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
}
