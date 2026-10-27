use crate::models::{err, Result};

#[tauri::command]
pub async fn print_mail(window: tauri::WebviewWindow) -> Result<()> {
    if window.label() != "main" && !window.label().starts_with("external-mail-") {
        return Err("mailPrintWindowUnavailable".into());
    }
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn anser_print_mail_webview(view: *mut std::ffi::c_void) -> std::ffi::c_int;
        }
        let (sender, receiver) = tokio::sync::oneshot::channel();
        // Tauri supplies the calling window and runs this closure on the main
        // thread. No HTML, window label or native pointer comes from the caller.
        window
            .with_webview(move |view| {
                let result = unsafe { anser_print_mail_webview(view.inner()) };
                let _ = sender.send(result);
            })
            .map_err(err)?;
        match receiver.await.map_err(err)? {
            0 => Ok(()),
            _ => Err("mailPrintWindowUnavailable".into()),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        window.print().map_err(err)
    }
}
