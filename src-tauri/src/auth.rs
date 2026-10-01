use crate::models::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Secret {
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub smtp_password: String,
    #[serde(default)]
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    #[serde(default)]
    pub expires_at: i64,
}
fn entry(id: &str) -> Result<keyring::Entry> {
    keyring::Entry::new("dev.maildesk.desktop", id).map_err(err)
}
pub fn save(id: &str, s: &Secret) -> Result<()> {
    entry(id)?
        .set_password(&serde_json::to_string(s).map_err(err)?)
        .map_err(err)
}
pub fn load(id: &str) -> Result<Secret> {
    let raw = entry(id)?
        .get_password()
        .map_err(|_| "无法读取钥匙串凭据，请重新连接账号".to_string())?;
    serde_json::from_str(&raw).map_err(err)
}
pub fn remove(id: &str) {
    if let Ok(e) = entry(id) {
        let _ = e.delete_credential();
    }
}
fn endpoints(a: &Account) -> Result<(&'static str, &'static str, &'static str)> {
    match a.provider.as_str(){"gmail"=>Ok(("https://accounts.google.com/o/oauth2/v2/auth","https://oauth2.googleapis.com/token","https://mail.google.com/")),"outlook"|"microsoft365"=>Ok(("https://login.microsoftonline.com/common/oauth2/v2.0/authorize","https://login.microsoftonline.com/common/oauth2/v2.0/token","offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/POP.AccessAsUser.All https://outlook.office.com/SMTP.Send")),_=>Err("该服务商请使用密码或授权码认证".into())}
}
pub fn client_id(a: &Account) -> String {
    if !a.oauth_client_id.is_empty() {
        a.oauth_client_id.clone()
    } else {
        match a.provider.as_str() {
            "gmail" => option_env!("MAIL_GOOGLE_CLIENT_ID").unwrap_or("").into(),
            _ => option_env!("MAIL_MICROSOFT_CLIENT_ID").unwrap_or("").into(),
        }
    }
}
fn exchange(a: &Account, mut fields: Vec<(&str, String)>) -> Result<Secret> {
    let (_, endpoint, _) = endpoints(a)?;
    fields.push(("client_id", client_id(a)));
    if a.provider == "gmail" {
        if let Some(secret) = option_env!("MAIL_GOOGLE_CLIENT_SECRET") {
            fields.push(("client_secret", secret.into()));
        }
    }
    let res = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(err)?
        .post(endpoint)
        .form(&fields)
        .send()
        .map_err(err)?;
    if !res.status().is_success() {
        return Err(format!(
            "授权服务返回 {}，请检查应用注册、重定向地址与授权范围",
            res.status()
        ));
    }
    let v: serde_json::Value = res.json().map_err(err)?;
    let access = v["access_token"]
        .as_str()
        .ok_or("授权未返回访问令牌")?
        .to_owned();
    Ok(Secret {
        access_token: access,
        refresh_token: v["refresh_token"].as_str().unwrap_or_default().into(),
        expires_at: chrono::Utc::now().timestamp() + v["expires_in"].as_i64().unwrap_or(3600),
        ..Default::default()
    })
}
pub fn credentials(a: &Account) -> Result<Secret> {
    let mut s = load(&a.id)?;
    if a.auth == "oauth" && s.expires_at < chrono::Utc::now().timestamp() + 60 {
        if s.refresh_token.is_empty() {
            return Err("授权已过期，请重新连接账号".into());
        }
        let mut new = exchange(
            a,
            vec![
                ("grant_type", "refresh_token".into()),
                ("refresh_token", s.refresh_token.clone()),
            ],
        )?;
        if new.refresh_token.is_empty() {
            new.refresh_token = s.refresh_token;
        }
        save(&a.id, &new)?;
        s = new;
    }
    Ok(s)
}
pub fn authorize(a: &Account) -> Result<Secret> {
    if client_id(a).is_empty() {
        return Err("开发版尚未配置 OAuth Client ID。请在高级配置填写你注册的桌面应用 Client ID，或在构建时配置。".into());
    }
    let (endpoint, _, scope) = endpoints(a)?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(err)?;
    listener.set_nonblocking(true).map_err(err)?;
    let redirect = format!(
        "http://localhost:{}/callback",
        listener.local_addr().map_err(err)?.port()
    );
    let state = uuid::Uuid::new_v4().to_string();
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = url::Url::parse(endpoint).map_err(err)?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id(a)),
        ("redirect_uri", redirect.clone()),
        ("response_type", "code".into()),
        ("scope", scope.into()),
        ("state", state.clone()),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256".into()),
        ("access_type", "offline".into()),
        ("prompt", "consent".into()),
        ("login_hint", a.email.clone()),
    ]);
    open::that(url.as_str()).map_err(err)?;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(180) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .map_err(err)?;
                let mut data = [0u8; 8192];
                let n = stream.read(&mut data).map_err(err)?;
                let line = String::from_utf8_lossy(&data[..n]);
                let path = line.split_whitespace().nth(1).unwrap_or("/");
                let callback = url::Url::parse(&format!("http://localhost{path}")).map_err(err)?;
                let params = callback
                    .query_pairs()
                    .collect::<std::collections::HashMap<_, _>>();
                if callback.path() != "/callback"
                    || params.get("state").map(|s| s.as_ref()) != Some(state.as_str())
                {
                    let _=stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    continue;
                }
                let code = params
                    .get("code")
                    .ok_or("授权已取消或被组织策略阻止")?
                    .to_string();
                let body = "Authorization received. You can return to Yanxin.";
                let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                let _ = stream.write_all(response.as_bytes());
                return exchange(
                    a,
                    vec![
                        ("grant_type", "authorization_code".into()),
                        ("code", code),
                        ("redirect_uri", redirect),
                        ("code_verifier", verifier),
                    ],
                );
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(e) => return Err(err(e)),
        }
    }
    Err("等待授权超时，请重新连接".into())
}
