//! Image-only transport for scripts-disabled mail frames. WKWebView's network
//! process does not use the application's mail/OAuth proxy configuration.
use crate::models::{ProxyConfig, Result};
use reqwest::{Client, Response};
use std::{sync::OnceLock, time::Duration};
use tauri::http;
use url::{Host, Url};

const MAX_BYTES: usize = 20 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(40);

fn valid_target(url: &Url) -> bool {
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match url.host() {
        Some(Host::Domain(host)) => {
            host != "localhost" && !host.ends_with(".localhost") && !host.ends_with(".local")
        }
        Some(Host::Ipv4(ip)) => {
            !ip.is_private() && !ip.is_loopback() && !ip.is_link_local() && !ip.is_unspecified()
        }
        Some(Host::Ipv6(ip)) => {
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_unique_local()
                && !ip.is_unicast_link_local()
                && ip
                    .to_ipv4_mapped()
                    .is_none_or(|v4| !v4.is_private() && !v4.is_loopback() && !v4.is_link_local())
        }
        None => false,
    }
}

fn target(request: &http::Request<Vec<u8>>, allowed: bool) -> Result<Url> {
    target_for(request, allowed, "anser-image")
}

pub(crate) fn target_for(
    request: &http::Request<Vec<u8>>,
    allowed: bool,
    scheme: &str,
) -> Result<Url> {
    let uri = Url::parse(&request.uri().to_string()).map_err(|_| "图片地址无效")?;
    let params: Vec<_> = uri.query_pairs().collect();
    if !allowed
        || uri.scheme() != scheme
        || request.method() != http::Method::GET
        || !request.body().is_empty()
        || uri.host_str() != Some("localhost")
        || uri.path() != "/fetch"
        || params.len() != 1
        || params[0].0 != "url"
        || params[0].1.len() > 32_768
    {
        return Err("图片请求无效".into());
    }
    let url = Url::parse(&params[0].1).map_err(|_| "图片地址无效")?;
    if !valid_target(&url) {
        return Err("只支持公开 HTTPS 图片".into());
    }
    Ok(url)
}

fn client(config: Option<&ProxyConfig>, password: &str) -> Result<Client> {
    let mut builder = Client::builder()
        .no_proxy()
        .https_only(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !valid_target(attempt.url()) {
                attempt.error("图片重定向无效")
            } else {
                attempt.follow()
            }
        }));
    if let Some(config) = config {
        builder = builder.proxy(crate::proxy::http_proxy(config, password)?);
    }
    // No cookies, origin/referrer or mailbox credentials are forwarded.
    builder.build().map_err(|_| "图片连接初始化失败".into())
}

fn image_mime(bytes: &[u8], declared: &str) -> Result<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok("image/webp")
    } else if bytes.starts_with(b"BM") {
        Ok("image/bmp")
    } else if bytes.starts_with(b"\0\0\x01\0") {
        Ok("image/x-icon")
    } else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        Ok("image/tiff")
    } else if bytes.get(4..8) == Some(b"ftyp")
        && bytes
            .get(8..12)
            .is_some_and(|brand| brand == b"avif" || brand == b"avis")
    {
        Ok("image/avif")
    } else if declared.split(';').next() == Some("image/svg+xml")
        && std::str::from_utf8(bytes).is_ok_and(|text| {
            let text = text.trim_start_matches('\u{feff}').trim_start();
            text.starts_with("<svg") || text.starts_with("<?xml")
        })
    {
        // SVG remains an image subresource; response CSP also forbids script,
        // external resources and navigation when opened outside that context.
        Ok("image/svg+xml")
    } else {
        Err("资源不是支持的图片".into())
    }
}

pub(crate) async fn read_resource(
    mut response: Response,
    limit: usize,
) -> Result<(String, Vec<u8>, Url)> {
    let final_url = response.url().clone();
    if !response.status().is_success() {
        return Err("图片服务器返回失败".into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err("图片超过容量限制".into());
    }
    let declared = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "图片读取失败")? {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err("图片超过容量限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((declared, bytes, final_url))
}

#[cfg(test)]
async fn read_image(response: Response, limit: usize) -> Result<(&'static str, Vec<u8>)> {
    let (declared, bytes, _) = read_resource(response, limit).await?;
    Ok((image_mime(&bytes, &declared)?, bytes))
}

pub(crate) async fn fetch_resource(url: Url, limit: usize) -> Result<(String, Vec<u8>, Url)> {
    static LIMIT: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    let _permit = LIMIT
        .get_or_init(|| tokio::sync::Semaphore::new(6))
        .acquire()
        .await
        .map_err(|_| "图片任务已结束")?;
    // Snapshot only: no database transaction or global lock during the request.
    let (config, password) = crate::proxy::current()?;
    let request = client(config.as_ref(), &password)?.get(url.clone());
    let response = match request.send().await {
        Ok(response) => response,
        Err(error)
            if error.is_connect() && config.as_ref().is_some_and(|p| p.direct_on_failure) =>
        {
            client(None, "")?
                .get(url)
                .send()
                .await
                .map_err(|_| "图片连接失败")?
        }
        Err(_) => return Err("图片连接失败".into()),
    };
    read_resource(response, limit).await
}

pub async fn respond(request: http::Request<Vec<u8>>, allowed: bool) -> http::Response<Vec<u8>> {
    let result = match target(&request, allowed) {
        Ok(url) => tokio::time::timeout(TIMEOUT, async {
            let (declared, bytes, _) = fetch_resource(url, MAX_BYTES).await?;
            Ok((image_mime(&bytes, &declared)?, bytes))
        })
        .await
        .unwrap_or_else(|_| Err("图片加载超时".into())),
        Err(error) => Err(error),
    };
    let (status, mime, body) = match result {
        Ok((mime, bytes)) => (200, mime, bytes),
        // Do not expose source URLs, tracking IDs, proxy credentials or server
        // response bodies to logs or the document on failure.
        Err(_) => (
            502,
            "text/plain; charset=utf-8",
            b"Image unavailable".to_vec(),
        ),
    };
    http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .body(body)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };

    fn request(url: &str) -> http::Request<Vec<u8>> {
        let encoded: String = url::form_urlencoded::byte_serialize(url.as_bytes()).collect();
        http::Request::builder()
            .uri(format!("anser-image://localhost/fetch?url={encoded}"))
            .body(Vec::new())
            .unwrap()
    }

    #[test]
    fn rejects_non_https_private_targets_credentials_and_forged_requests() {
        for url in [
            "file:///tmp/image",
            "http://example.com/a",
            "https://localhost/a",
            "https://127.0.0.1/a",
            "https://[::1]/a",
            "https://[::ffff:127.0.0.1]/a",
            "https://10.1.2.3/a",
            "https://user:secret@example.com/a",
        ] {
            assert!(target(&request(url), true).is_err());
        }
        let valid = request("https://images.example/a?x=1&y=2");
        assert_eq!(
            target(&valid, true).unwrap().as_str(),
            "https://images.example/a?x=1&y=2"
        );
        assert!(target(&valid, false).is_err());
        let post = http::Request::builder()
            .method("POST")
            .uri(valid.uri())
            .body(Vec::new())
            .unwrap();
        assert!(target(&post, true).is_err());
    }

    #[test]
    fn sniffs_images_and_rejects_waf_html_even_with_an_image_content_type() {
        assert_eq!(
            image_mime(b"GIF89a\0\0", "application/octet-stream").unwrap(),
            "image/gif"
        );
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n", "").unwrap(), "image/png");
        assert!(image_mime(b"<html>Verification required</html>", "image/png").is_err());
        assert!(image_mime(b"<html><script>alert(1)</script>", "image/svg+xml").is_err());
    }

    async fn local_response(raw: Vec<u8>) -> Response {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            let mut buffer = [0u8; 2048];
            let _ = stream.read(&mut buffer);
            let _ = stream.write_all(&raw);
        });
        Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/image"))
            .send()
            .await
            .unwrap()
    }

    #[test]
    fn reads_real_get_bytes_and_bounds_declared_and_chunked_bodies() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let good = local_response(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nGIF89a".to_vec()).await;
            assert_eq!(read_image(good, 10).await.unwrap(), ("image/gif", b"GIF89a".to_vec()));
            for raw in [
                b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\nGIF89a1234567".to_vec(),
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n6\r\nGIF89a\r\n6\r\n123456\r\n0\r\n\r\n".to_vec(),
                b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nConnection: close\r\n\r\n<html>WAF</html>".to_vec(),
                b"HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\nConnection: close\r\n\r\nGIF89a".to_vec(),
            ] {
                assert!(read_image(local_response(raw).await, 10).await.is_err());
            }
            let result = respond(request("file:///private"), true).await;
            assert_eq!(result.status(), 502);
            assert!(!String::from_utf8_lossy(result.body()).contains("private"));
            assert_eq!(result.headers()["X-Content-Type-Options"], "nosniff");
        });
    }
}
