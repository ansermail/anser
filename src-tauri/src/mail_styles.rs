//! Stylesheets/fonts for isolated mail documents, using the same bounded proxy
//! transport as images. No remote CSS is inserted into the application page.
use crate::{mail_images, models::Result};
use cssparser::{Parser, ParserInput, Token};
use std::time::Duration;
use tauri::http;
use url::Url;

fn resource_url(source: &str, base: &Url, kind: &str) -> String {
    if source.starts_with("data:") || source.starts_with('#') {
        // These remain subject to the mail document's resource-specific CSP.
        return cssparser::ToCss::to_css_string(&cssparser::Token::QuotedString(source.into()));
    }
    let Ok(mut url) = base.join(source) else {
        return "\"\"".into();
    };
    if url.scheme() == "http" {
        let _ = url.set_scheme("https");
    }
    if url.scheme() != "https" {
        return "\"\"".into();
    }
    let encoded: String = url::form_urlencoded::byte_serialize(url.as_str().as_bytes()).collect();
    #[cfg(target_os = "windows")]
    let origin = format!("https://anser-{kind}.localhost");
    #[cfg(not(target_os = "windows"))]
    let origin = format!("anser-{kind}://localhost");
    format!("\"{origin}/fetch?url={encoded}\"")
}

// Tokenize instead of matching CSS with regex: escaped URLs, comments, quoted
// imports, media/supports blocks and relative URLs all retain their semantics.
fn rewrite_tokens(
    input: &mut Parser<'_, '_>,
    base: &Url,
    font: bool,
    depth: usize,
) -> Result<String> {
    if depth > 32 {
        return Err("样式嵌套过深".into());
    }
    let mut output = String::new();
    let mut import = false;
    let mut font_block = false;
    loop {
        let start = input.position();
        let token = match input.next_including_whitespace_and_comments() {
            Ok(token) => token.clone(),
            Err(_) => break,
        };
        let kind = if import {
            "style"
        } else if font {
            "font"
        } else {
            "image"
        };
        match token {
            Token::AtKeyword(ref name) => {
                import = name.eq_ignore_ascii_case("import");
                font_block = name.eq_ignore_ascii_case("font-face");
                output.push_str(input.slice_from(start));
            }
            Token::QuotedString(ref source) if import => {
                output.push_str(&resource_url(source, base, "style"));
                import = false;
            }
            Token::UnquotedUrl(ref source) => {
                output.push_str(&format!("url({})", resource_url(source, base, kind)));
                import = false;
            }
            Token::Function(ref name) if name.eq_ignore_ascii_case("url") => {
                let source = input
                    .parse_nested_block(|nested| {
                        nested
                            .expect_string_cloned()
                            .map_err(Into::<cssparser::ParseError<'_, ()>>::into)
                    })
                    .map_err(|_| "样式 URL 无效")?;
                output.push_str(&format!("url({})", resource_url(&source, base, kind)));
                import = false;
            }
            Token::CurlyBracketBlock
            | Token::ParenthesisBlock
            | Token::SquareBracketBlock
            | Token::Function(_) => {
                let opening = input.slice_from(start).to_owned();
                let closing = match token {
                    Token::CurlyBracketBlock => '}',
                    Token::SquareBracketBlock => ']',
                    _ => ')',
                };
                let nested_font = font || font_block;
                let inner = input
                    .parse_nested_block(|nested| {
                        rewrite_tokens(nested, base, nested_font, depth + 1)
                            .map_err(|_| nested.new_custom_error::<(), ()>(()))
                    })
                    .map_err(|_| "样式内容无效")?;
                output.push_str(&opening);
                output.push_str(&inner);
                output.push(closing);
                font_block = false;
                import = false;
            }
            Token::Semicolon => {
                import = false;
                font_block = false;
                output.push(';');
            }
            Token::BadUrl(_) | Token::BadString(_) => return Err("样式内容无效".into()),
            _ => output.push_str(input.slice_from(start)),
        }
    }
    Ok(output)
}

fn stylesheet(bytes: &[u8], declared: &str, base: &Url) -> Result<Vec<u8>> {
    if !declared
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("text/css")
    {
        return Err("资源不是样式表".into());
    }
    let css = std::str::from_utf8(bytes).map_err(|_| "样式编码无效")?;
    // HTML challenge/error pages must not masquerade as a usable stylesheet.
    if css
        .trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with('<')
    {
        return Err("资源不是样式表".into());
    }
    let mut input = ParserInput::new(css);
    rewrite_tokens(&mut Parser::new(&mut input), base, false, 0).map(String::into_bytes)
}

fn font_mime(bytes: &[u8]) -> Result<&'static str> {
    match bytes.get(..4) {
        Some(b"wOFF") => Ok("font/woff"),
        Some(b"wOF2") => Ok("font/woff2"),
        Some(b"OTTO") => Ok("font/otf"),
        Some(b"\0\x01\0\0") => Ok("font/ttf"),
        Some(b"ttcf") => Ok("font/collection"),
        _ => Err("资源不是支持的字体".into()),
    }
}

pub async fn respond(
    request: http::Request<Vec<u8>>,
    allowed: bool,
    style: bool,
) -> http::Response<Vec<u8>> {
    let kind = if style { "anser-style" } else { "anser-font" };
    let result = async {
        let url = mail_images::target_for(&request, allowed, kind)?;
        let limit = if style { 1024 * 1024 } else { 10 * 1024 * 1024 };
        let (declared, bytes, base) = mail_images::fetch_resource(url, limit).await?;
        if style {
            Ok((
                "text/css; charset=utf-8",
                stylesheet(&bytes, &declared, &base)?,
            ))
        } else {
            Ok((font_mime(&bytes)?, bytes))
        }
    };
    let result: Result<(&str, Vec<u8>)> = tokio::time::timeout(Duration::from_secs(40), result)
        .await
        .unwrap_or_else(|_| Err("资源加载超时".into()));
    let (status, mime, body) = match result {
        Ok((mime, bytes)) => (200, mime, bytes),
        Err(_) => (
            502,
            "text/plain; charset=utf-8",
            b"Resource unavailable".to_vec(),
        ),
    };
    http::Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .body(body)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rewrites_imports_fonts_and_images_with_final_redirect_base() {
        let base = Url::parse("https://cdn.example/styles/theme.css").unwrap();
        let css = br#"@import /* hi */ "nested.css" screen; @import url(../other.css); @media screen{@font-face{font-family:Mail;src:local("Mail"),url('../fonts/a.woff2') format('woff2')} .hero{background:url(../hero.png)}} @FONT-FACE{src:URL(https\3a //fonts.example/font.woff)}"#;
        let result =
            String::from_utf8(stylesheet(css, "text/css;charset=utf-8", &base).unwrap()).unwrap();
        for (kind, target) in [
            ("style", "https://cdn.example/styles/nested.css"),
            ("style", "https://cdn.example/other.css"),
            ("font", "https://cdn.example/fonts/a.woff2"),
            ("image", "https://cdn.example/hero.png"),
            ("font", "https://fonts.example/font.woff"),
        ] {
            let encoded: String = url::form_urlencoded::byte_serialize(target.as_bytes()).collect();
            #[cfg(target_os = "windows")]
            let expected = format!("https://anser-{kind}.localhost/fetch?url={encoded}");
            #[cfg(not(target_os = "windows"))]
            let expected = format!("anser-{kind}://localhost/fetch?url={encoded}");
            assert!(result.contains(&expected), "{result}");
        }
        assert!(result.contains("local(\"Mail\")"));
    }
    #[test]
    fn rejects_html_wrong_types_and_unsafe_urls_without_returning_server_content() {
        let base = Url::parse("https://cdn.example/css").unwrap();
        assert!(stylesheet(b"<html>challenge</html>", "text/css", &base).is_err());
        assert!(stylesheet(b"@font-face{}", "text/html", &base).is_err());
        assert!(stylesheet(&[255], "text/css", &base).is_err());
        for header in [b"wOFF", b"wOF2", b"OTTO", b"\0\x01\0\0", b"ttcf"] {
            assert!(font_mime(header).is_ok());
        }
        assert!(font_mime(b"<html>WAF</html>").is_err());
        assert_eq!(resource_url("javascript:alert(1)", &base, "font"), "\"\"");
        let css = "a{background:url(data:image/png;base64,AA==)}";
        assert!(
            String::from_utf8(stylesheet(css.as_bytes(), "text/css", &base).unwrap())
                .unwrap()
                .contains("data:image/png")
        );
    }
}
