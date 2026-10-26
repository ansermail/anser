//! Optional one-time bridge, run only after quitting all Anser instances.
//! Sign with the exact previous stable app identity, never ship its private key.
//! Prints counts only; the local vault is encrypted and only its key is in Keychain.
#[path = "../src/credentials.rs"]
#[allow(dead_code)]
mod credentials;
mod models {
    pub type Result<T> = std::result::Result<T, String>;
}
fn main() {
    let result = (|| -> models::Result<()> {
        let path = std::env::args().nth(1).ok_or("需要指定已有本机索引路径")?;
        if let Some(root) = std::path::Path::new(&path).parent() {
            credentials::initialize(root);
        }
        let db =
            rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "无法只读打开索引")?;
        let mut statement = db
            .prepare("SELECT id FROM accounts ORDER BY id")
            .map_err(|_| "无法读取账号标识")?;
        let mut ids: Vec<String> = statement
            .query_map([], |row| row.get(0))
            .map_err(|_| "无法读取账号标识")?
            .collect::<std::result::Result<_, _>>()
            .map_err(|_| "无法读取账号标识")?;
        ids.extend(["network-proxy".into(), "translation-api-key".into()]);
        let (migrated, unavailable) = credentials::migrate(&ids)?;
        println!(
            "凭据检查完成：可用 {migrated} 项；未授权或未保存 {unavailable} 项。旧记录全部保留。"
        );
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
