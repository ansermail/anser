use crate::models::{err, Result};
use std::{collections::HashMap, sync::OnceLock};
use tauri::{
    menu::{CheckMenuItem, MenuItem},
    tray::TrayIcon,
    Wry,
};

pub fn text<'a>(language: &str, key: &'a str) -> &'a str {
    static ENGLISH: OnceLock<HashMap<String, String>> = OnceLock::new();
    static CHINESE: OnceLock<HashMap<String, String>> = OnceLock::new();
    let catalog = if language == "en" {
        ENGLISH.get_or_init(|| {
            serde_json::from_str(include_str!("../../src/locales/en.json"))
                .expect("validated English catalog")
        })
    } else {
        CHINESE.get_or_init(|| {
            serde_json::from_str(include_str!("../../src/locales/zh-CN.json"))
                .expect("validated Chinese catalog")
        })
    };
    catalog.get(key).map(String::as_str).unwrap_or(key)
}

pub fn default_language() -> &'static str {
    static CONFIG: OnceLock<serde_json::Value> = OnceLock::new();
    CONFIG.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/locales/config.json"))
            .expect("validated locale configuration")
    })["defaultLanguage"]
        .as_str()
        .unwrap_or("zh-CN")
}

pub struct LanguageMenu {
    pub open: MenuItem<Wry>,
    pub sync: MenuItem<Wry>,
    pub quiet: CheckMenuItem<Wry>,
    pub quit: MenuItem<Wry>,
    pub tray: TrayIcon<Wry>,
}
impl LanguageMenu {
    pub fn apply(&self, language: &str) -> Result<()> {
        self.open
            .set_text(text(language, "打开雁信"))
            .map_err(err)?;
        self.sync
            .set_text(text(language, "立即检查新邮件"))
            .map_err(err)?;
        self.quiet
            .set_text(text(language, "暂停新邮件通知"))
            .map_err(err)?;
        self.quit
            .set_text(text(language, "退出雁信"))
            .map_err(err)?;
        self.tray
            .set_tooltip(Some(text(language, "雁信 · 点击打开")))
            .map_err(err)?;
        Ok(())
    }
}
