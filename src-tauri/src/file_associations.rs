use crate::models::*;
use serde::{Deserialize, Serialize};
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    pub id: String,
    pub name: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Association {
    pub extension: String,
    pub current_name: String,
    pub current_id: String,
    pub is_default: bool,
    pub applications: Vec<Application>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Associations {
    pub supported: bool,
    pub busy: bool,
    pub items: Vec<Association>,
}
fn allowed(extension: &str) -> Result<()> {
    if ["eml", "emlx", "msg"].contains(&extension) {
        Ok(())
    } else {
        Err("unsupportedAssociation".into())
    }
}
#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::ffi::{c_char, CStr, CString};
    unsafe extern "C" {
        fn anser_mail_associations_read() -> *mut c_char;
        fn anser_mail_association_set(
            extension: *const c_char,
            application: *const c_char,
        ) -> *mut c_char;
        fn anser_mail_association_free(data: *mut c_char);
    }
    unsafe fn value(pointer: *mut c_char) -> Result<serde_json::Value> {
        if pointer.is_null() {
            return Err("associationFailed".into());
        }
        let data = unsafe { CStr::from_ptr(pointer) }.to_bytes().to_vec();
        unsafe { anser_mail_association_free(pointer) };
        let result: serde_json::Value =
            serde_json::from_slice(&data).map_err(|_| "associationFailed")?;
        if let Some(error) = result.get("error").and_then(|v| v.as_str()) {
            return Err(error.to_string());
        }
        Ok(result)
    }
    pub fn read() -> Result<Associations> {
        serde_json::from_value(unsafe { value(anser_mail_associations_read())? })
            .map_err(|_| "associationFailed".into())
    }
    pub fn set(extension: &str, application: &str) -> Result<()> {
        allowed(extension)?;
        let extension = CString::new(extension).map_err(|_| "unsupportedAssociation")?;
        let application = CString::new(application).map_err(|_| "associationApplicationChanged")?;
        unsafe {
            value(anser_mail_association_set(
                extension.as_ptr(),
                application.as_ptr(),
            ))?;
        };
        Ok(())
    }
}
pub fn read() -> Result<Associations> {
    #[cfg(target_os = "macos")]
    {
        macos::read()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(Associations {
            supported: false,
            busy: false,
            items: vec![],
        })
    }
}
pub fn set(extension: &str, application: &str) -> Result<()> {
    allowed(extension)?;
    if !["self", "previous"].contains(&application) {
        return Err("associationApplicationChanged".into());
    }
    #[cfg(target_os = "macos")]
    {
        macos::set(extension, application)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = application;
        Err("unsupportedAssociation".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn associations_reject_unrelated_types_before_native_access() {
        assert!(allowed("eml").is_ok());
        assert!(set("eml", "arbitrary.application").is_err());
        for value in ["", "pdf", "exe", "../eml", "eml\0"] {
            assert!(set(value, "self").is_err());
        }
    }
}
