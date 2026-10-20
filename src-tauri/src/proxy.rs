use crate::models::{err, ProxyConfig, Result};
use base64::Engine;
use std::{
    net::TcpListener,
    sync::{OnceLock, RwLock},
    time::Duration,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

trait ProxyStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> ProxyStream for T {}

#[derive(Default)]
struct ProxyState {
    config: Option<ProxyConfig>,
    password: String,
    error: Option<String>,
}
fn state() -> &'static RwLock<ProxyState> {
    static STATE: OnceLock<RwLock<ProxyState>> = OnceLock::new();
    STATE.get_or_init(|| RwLock::new(ProxyState::default()))
}
fn entry() -> Result<crate::credentials::Entry> {
    crate::credentials::entry("network-proxy")
}
pub fn current() -> Result<(Option<ProxyConfig>, String)> {
    let state = state().read().map_err(err)?;
    if let Some(error) = &state.error {
        return Err(error.clone());
    }
    Ok((state.config.clone(), state.password.clone()))
}
pub fn http_proxy(config: &ProxyConfig, password: &str) -> Result<reqwest::Proxy> {
    config.validate()?;
    let scheme = if config.kind == "socks5" {
        "socks5h"
    } else {
        &config.kind
    };
    let host = if config.host.contains(':') && !config.host.starts_with('[') {
        format!("[{}]", config.host)
    } else {
        config.host.clone()
    };
    let mut proxy =
        reqwest::Proxy::all(format!("{scheme}://{host}:{}", config.port)).map_err(err)?;
    if !config.username.is_empty() {
        proxy = proxy.basic_auth(&config.username, password);
    }
    Ok(proxy)
}
pub fn initialize(config: Option<ProxyConfig>) -> Result<()> {
    let password = if config.as_ref().is_some_and(|p| !p.username.is_empty()) {
        entry()?.get_password()
    } else {
        Ok(String::new())
    };
    let (password, error) = match password {
        Ok(password) => (password, None),
        Err(error) => (String::new(), Some(error)),
    };
    // Keep the application usable for repair, but do not silently connect using
    // an empty password when authorization or legacy migration was denied.
    *state().write().map_err(err)? = ProxyState {
        config,
        password,
        error,
    };
    Ok(())
}
pub fn apply(config: Option<ProxyConfig>, replacement_password: Option<&str>) -> Result<()> {
    if let Some(proxy) = &config {
        proxy.validate()?;
    }
    let old = state().read().map_err(err)?;
    if let Some(error) = &old.error {
        if replacement_password.is_none_or(str::is_empty)
            && config.as_ref().is_some_and(|p| !p.username.is_empty())
        {
            return Err(error.clone());
        }
    }
    let mut password = old.password.clone();
    drop(old);
    if let Some(value) = replacement_password.filter(|value| !value.is_empty()) {
        // Settings are a user action, so one Keychain prompt is allowed when
        // the vault item still needs to be re-authorized.
        entry()?.set_password_interactive(value).map_err(err)?;
        password = value.to_owned();
    }
    if config
        .as_ref()
        .is_none_or(|proxy| proxy.username.is_empty())
    {
        password.clear();
        entry()?.replace_interactive(None).map_err(err)?;
    }
    *state().write().map_err(err)? = ProxyState {
        config,
        password,
        error: None,
    };
    Ok(())
}

async fn prepare(
    config: &ProxyConfig,
    password: &str,
    target_host: &str,
    target_port: u16,
) -> Result<Box<dyn ProxyStream>> {
    let stream = tokio::time::timeout(
        Duration::from_secs(12),
        tokio::net::TcpStream::connect((config.host.as_str(), config.port)),
    )
    .await
    .map_err(|_| "连接代理超时")?
    .map_err(|_| "无法连接代理服务器")?;
    let _ = stream.set_nodelay(true);
    let mut stream: Box<dyn ProxyStream> = if config.kind == "https" {
        let connector = native_tls::TlsConnector::new().map_err(|_| "代理 TLS 初始化失败")?;
        Box::new(
            tokio_native_tls::TlsConnector::from(connector)
                .connect(&config.host, stream)
                .await
                .map_err(|_| "代理 TLS 验证失败")?,
        )
    } else {
        Box::new(stream)
    };
    if config.kind == "socks5" {
        let authenticated = !config.username.is_empty();
        stream
            .write_all(if authenticated {
                &[5, 1, 2]
            } else {
                &[5, 1, 0]
            })
            .await
            .map_err(err)?;
        let mut reply = [0; 2];
        stream.read_exact(&mut reply).await.map_err(err)?;
        if reply != [5, if authenticated { 2 } else { 0 }] {
            return Err("SOCKS5 代理不支持所选认证方式".into());
        }
        if authenticated {
            let username = config.username.as_bytes();
            let password = password.as_bytes();
            if username.len() > 255 || password.len() > 255 {
                return Err("代理用户名或密码过长".into());
            }
            let mut request = vec![1, username.len() as u8];
            request.extend_from_slice(username);
            request.push(password.len() as u8);
            request.extend_from_slice(password);
            stream.write_all(&request).await.map_err(err)?;
            stream.read_exact(&mut reply).await.map_err(err)?;
            if reply != [1, 0] {
                return Err("SOCKS5 代理认证失败".into());
            }
        }
        let host = target_host.as_bytes();
        if host.len() > 255 {
            return Err("目标服务器地址过长".into());
        }
        let mut request = vec![5, 1, 0, 3, host.len() as u8];
        request.extend_from_slice(host);
        request.extend_from_slice(&target_port.to_be_bytes());
        stream.write_all(&request).await.map_err(err)?;
        let mut head = [0; 4];
        stream.read_exact(&mut head).await.map_err(err)?;
        if head[0] != 5 || head[1] != 0 {
            return Err("SOCKS5 代理拒绝连接目标服务器".into());
        }
        let address_len = match head[3] {
            1 => 4,
            4 => 16,
            3 => {
                let mut n = [0];
                stream.read_exact(&mut n).await.map_err(err)?;
                n[0] as usize
            }
            _ => return Err("SOCKS5 代理响应无效".into()),
        };
        let mut rest = vec![0; address_len + 2];
        stream.read_exact(&mut rest).await.map_err(err)?;
    } else {
        let target = format!("{target_host}:{target_port}");
        let auth = if config.username.is_empty() {
            String::new()
        } else {
            let encoded = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{password}", config.username));
            format!("Proxy-Authorization: Basic {encoded}\r\n")
        };
        let request = format!(
            "CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n{auth}Proxy-Connection: keep-alive\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).await.map_err(err)?;
        let mut header = Vec::new();
        while !header.ends_with(b"\r\n\r\n") {
            if header.len() >= 16 * 1024 {
                return Err("代理响应头过长".into());
            }
            let mut byte = [0];
            stream.read_exact(&mut byte).await.map_err(err)?;
            header.push(byte[0]);
        }
        let first = header
            .split(|byte| *byte == b'\r')
            .next()
            .unwrap_or_default();
        if !first.starts_with(b"HTTP/1.1 200") && !first.starts_with(b"HTTP/1.0 200") {
            return Err("HTTP 代理拒绝连接目标服务器".into());
        }
    }
    Ok(stream)
}

/// Return a loopback endpoint carrying one verified proxy tunnel. The mail TLS
/// handshake still uses the original server name, including for SMTP.
pub fn route(host: &str, port: u16) -> Result<Option<u16>> {
    let (config, password) = current()?;
    let Some(config) = &config else {
        return Ok(None);
    };
    tunnel(config, &password, host, port)
}

fn tunnel(config: &ProxyConfig, password: &str, host: &str, port: u16) -> Result<Option<u16>> {
    config.validate()?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(err)?;
    let remote = runtime.block_on(async {
        tokio::time::timeout(
            Duration::from_secs(15),
            prepare(config, &password, host, port),
        )
        .await
        .map_err(|_| "代理握手超时".to_string())?
    });
    let remote = match remote {
        Ok(remote) => remote,
        Err(reason) if config.direct_on_failure => {
            // Only a failed proxy handshake may fall back. A mail operation
            // already in flight must never be retried through another route.
            let _ = reason;
            return Ok(None);
        }
        Err(reason) => return Err(reason),
    };
    let listener = TcpListener::bind("127.0.0.1:0").map_err(err)?;
    let port = listener.local_addr().map_err(err)?.port();
    listener.set_nonblocking(true).map_err(err)?;
    std::thread::spawn(move || {
        let accepted = (|| {
            let started = std::time::Instant::now();
            loop {
                match listener.accept() {
                    Ok((socket, _)) => return Some(socket),
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            && started.elapsed() < Duration::from_secs(45) =>
                    {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => return None,
                }
            }
        })();
        if let Some(local) = accepted {
            let _ = local.set_nodelay(true);
            let _ = runtime.block_on(async move {
                let mut local = tokio::net::TcpStream::from_std(local)?;
                let mut remote = remote;
                tokio::io::copy_bidirectional(&mut local, &mut remote).await?;
                Ok::<(), std::io::Error>(())
            });
        }
    });
    Ok(Some(port))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn image_http_client_uses_the_configured_proxy_and_keeps_auth_on_the_proxy() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut config = config("http", listener.local_addr().unwrap().port());
        config.username = "user".into();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut buffer = [0u8; 4096];
            let size = socket.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..size]).to_lowercase();
            assert!(request.starts_with("get http://images.example/pixel "));
            assert!(request.contains("proxy-authorization: basic dxnlcjpwyxnz"));
            assert!(!request.contains("\r\nauthorization:"));
            socket
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nGIF89a",
                )
                .unwrap();
        });
        let response = reqwest::blocking::Client::builder()
            .no_proxy()
            .proxy(http_proxy(&config, "pass").unwrap())
            .build()
            .unwrap()
            .get("http://images.example/pixel")
            .send()
            .unwrap();
        assert_eq!(response.bytes().unwrap().as_ref(), b"GIF89a");
        server.join().unwrap();
    }

    fn config(kind: &str, port: u16) -> ProxyConfig {
        ProxyConfig {
            name: "test".into(),
            kind: kind.into(),
            host: "127.0.0.1".into(),
            port,
            username: String::new(),
            direct_on_failure: false,
        }
    }

    #[test]
    fn socks5_connect_uses_domain_target_and_passes_bytes() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut greeting = [0; 3];
            stream.read_exact(&mut greeting).unwrap();
            assert_eq!(greeting, [5, 1, 0]);
            stream.write_all(&[5, 0]).unwrap();
            let mut request = [0; 5];
            stream.read_exact(&mut request).unwrap();
            assert_eq!(request, [5, 1, 0, 3, 12]);
            let mut target = [0; 14];
            stream.read_exact(&mut target).unwrap();
            assert_eq!(&target[..12], b"mail.example");
            assert_eq!(&target[12..], &993u16.to_be_bytes());
            stream.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 1]).unwrap();
            let mut payload = [0; 4];
            stream.read_exact(&mut payload).unwrap();
            assert_eq!(&payload, b"ping");
            stream.write_all(b"pong").unwrap();
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let mut stream = prepare(&config("socks5", port), "", "mail.example", 993)
                .await
                .unwrap();
            stream.write_all(b"ping").await.unwrap();
            let mut response = [0; 4];
            stream.read_exact(&mut response).await.unwrap();
            assert_eq!(&response, b"pong");
        });
        server.join().unwrap();
    }

    #[test]
    fn http_connect_sends_auth_only_to_proxy() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                header.push(byte[0]);
            }
            let text = String::from_utf8(header).unwrap();
            assert!(text.starts_with("CONNECT smtp.example:465 HTTP/1.1\r\n"));
            assert!(text.contains("Proxy-Authorization: Basic dXNlcjpwYXNz\r\n"));
            stream
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                .unwrap();
        });
        let mut config = config("http", port);
        config.username = "user".into();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime
            .block_on(prepare(&config, "pass", "smtp.example", 465))
            .unwrap();
        server.join().unwrap();
    }

    #[test]
    fn socks5_username_password_is_exchanged_before_connect() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut greeting = [0; 3];
            stream.read_exact(&mut greeting).unwrap();
            assert_eq!(greeting, [5, 1, 2]);
            stream.write_all(&[5, 2]).unwrap();
            let mut auth = [0; 11];
            stream.read_exact(&mut auth).unwrap();
            assert_eq!(&auth, b"\x01\x04user\x04pass");
            stream.write_all(&[1, 0]).unwrap();
            let mut connect = [0; 5 + 12 + 2];
            stream.read_exact(&mut connect).unwrap();
            assert_eq!(&connect[5..17], b"mail.example");
            stream.write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 1]).unwrap();
        });
        let mut proxy = config("socks5", port);
        proxy.username = "user".into();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime
            .block_on(prepare(&proxy, "pass", "mail.example", 993))
            .unwrap();
        server.join().unwrap();
    }

    #[test]
    fn loopback_tunnel_forwards_both_directions() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                header.push(byte[0]);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\n\r\n").unwrap();
            let mut payload = [0; 4];
            stream.read_exact(&mut payload).unwrap();
            assert_eq!(&payload, b"mail");
            stream.write_all(b"done").unwrap();
        });
        let local_port = tunnel(&config("http", port), "", "mail.example", 993)
            .unwrap()
            .unwrap();
        let mut client = std::net::TcpStream::connect(("127.0.0.1", local_port)).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        client.write_all(b"mail").unwrap();
        let mut response = [0; 4];
        client.read_exact(&mut response).unwrap();
        assert_eq!(&response, b"done");
        server.join().unwrap();
    }

    #[test]
    fn loopback_tunnel_delivers_server_push_without_waiting_for_client_writes() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (permit_tx, permit_rx) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut header = Vec::new();
            while !header.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                header.push(byte[0]);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\n\r\nready").unwrap();
            permit_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            stream.write_all(b"new-mail").unwrap();
            let mut ack = [0; 4];
            stream.read_exact(&mut ack).unwrap();
            assert_eq!(&ack, b"done");
        });
        let local_port = tunnel(&config("http", port), "", "mail.example", 993)
            .unwrap()
            .unwrap();
        let mut client = std::net::TcpStream::connect(("127.0.0.1", local_port)).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut ready = [0; 5];
        client.read_exact(&mut ready).unwrap();
        assert_eq!(&ready, b"ready");
        permit_tx.send(()).unwrap();
        let mut push = [0; 8];
        client.read_exact(&mut push).unwrap();
        assert_eq!(&push, b"new-mail");
        client.write_all(b"done").unwrap();
        server.join().unwrap();
    }

    #[test]
    fn direct_fallback_requires_explicit_choice_and_precedes_mail_bytes() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let mut proxy = config("socks5", port);
        assert!(tunnel(&proxy, "", "mail.example", 993).is_err());
        proxy.direct_on_failure = true;
        assert_eq!(tunnel(&proxy, "", "mail.example", 993).unwrap(), None);
    }
}
