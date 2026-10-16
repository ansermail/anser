//! Public release metadata only. Never attach account/GitHub credentials.
use crate::models::Result;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const API: &str = "https://api.github.com/repos/ansermail/anser/releases";
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 20;
const PAGE_BYTES: usize = 2 * 1024 * 1024;
const TOTAL_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Deserialize)]
struct ApiRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
}
struct Page {
    items: Vec<ApiRelease>,
    bytes: usize,
    has_next: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    version: String,
    name: String,
    body: String,
    published_at: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    current_version: String,
    target_version: String,
    releases: Vec<Release>,
}
fn version(value: &str) -> Result<Version> {
    if value.len() > 128 {
        return Err("版本范围无效".into());
    }
    let mut v =
        Version::parse(value.strip_prefix('v').unwrap_or(value)).map_err(|_| "版本范围无效")?;
    // Build metadata is not part of SemVer precedence or release count.
    v.build = semver::BuildMetadata::EMPTY;
    Ok(v)
}
fn bounds(current: &str, target: &str) -> Result<(Version, Version)> {
    let current = version(current)?;
    let target = version(target)?;
    if current >= target {
        return Err("目标版本必须高于当前版本".into());
    }
    Ok((current, target))
}

async fn collect<F, Fut>(current: Version, target: Version, mut fetch: F) -> Result<History>
where
    F: FnMut(usize) -> Fut,
    Fut: std::future::Future<Output = Result<Page>>,
{
    let mut found = BTreeMap::new();
    let mut total = 0;
    let mut complete = false;
    for page in 1..=MAX_PAGES {
        let page = fetch(page).await?;
        if page.items.len() > PAGE_SIZE || page.bytes > PAGE_BYTES {
            return Err("版本历史响应超过限制，未获取完整记录".into());
        }
        total += page.bytes;
        if total > TOTAL_BYTES {
            return Err("版本历史响应超过限制，未获取完整记录".into());
        }
        let last = !page.has_next;
        for item in page.items {
            if item.draft {
                continue;
            }
            let Ok(v) = version(&item.tag_name) else {
                continue;
            };
            if v <= current
                || v > target
                || (target.pre.is_empty() && (item.prerelease || !v.pre.is_empty()))
            {
                continue;
            }
            let Some(date) = item
                .published_at
                .filter(|date| chrono::DateTime::parse_from_rfc3339(date).is_ok())
            else {
                continue;
            };
            found.entry(v.clone()).or_insert_with(|| Release {
                version: v.to_string(),
                name: item.name.unwrap_or_default(),
                body: item.body.unwrap_or_default(),
                published_at: date,
            });
        }
        // GitHub's ordering is not SemVer ordering: an old version on an earlier
        // page cannot prove that every intervening version has been discovered.
        if last {
            complete = true;
            break;
        }
    }
    if !complete {
        return Err("版本历史页数超过限制，未获取完整记录".into());
    }
    if !found.contains_key(&target) {
        return Err("尚未获取到目标版本的发布记录，请稍后重试".into());
    }
    Ok(History {
        current_version: current.to_string(),
        target_version: target.to_string(),
        releases: found.into_iter().rev().map(|(_, r)| r).collect(),
    })
}
async fn page(client: &reqwest::Client, page: usize) -> Result<Page> {
    let mut response = client
        .get(API)
        .query(&[("per_page", PAGE_SIZE), ("page", page)])
        .send()
        .await
        .map_err(|_| "无法获取版本历史，请检查网络或代理后重试")?;
    if response.status().as_u16() == 403 || response.status().as_u16() == 429 {
        return Err("GitHub 请求受限，请稍后重试版本历史".into());
    }
    if !response.status().is_success() {
        return Err("GitHub 版本历史服务暂不可用，请稍后重试".into());
    }
    if response
        .content_length()
        .is_some_and(|n| n > PAGE_BYTES as u64)
    {
        return Err("版本历史响应超过限制，未获取完整记录".into());
    }
    let linked_next = response
        .headers()
        .get(reqwest::header::LINK)
        .map(|value| {
            value
                .to_str()
                .map(|text| {
                    text.split(',').any(|part| {
                        part.split(';')
                            .skip(1)
                            .any(|attr| attr.trim() == "rel=\"next\"")
                    })
                })
                .map_err(|_| "版本历史分页格式无效")
        })
        .transpose()?;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "版本历史响应读取失败，请重试")?
    {
        if body.len() + chunk.len() > PAGE_BYTES {
            return Err("版本历史响应超过限制，未获取完整记录".into());
        }
        body.extend_from_slice(&chunk);
    }
    let items: Vec<ApiRelease> =
        serde_json::from_slice(&body).map_err(|_| "版本历史格式无效，请稍后重试")?;
    let has_next = linked_next.unwrap_or(items.len() == PAGE_SIZE);
    // Only use the next-link relation. Construct every page against our fixed API
    // URL, never follow arbitrary URLs supplied in a response header.
    Ok(Page {
        items,
        bytes: body.len(),
        has_next,
    })
}
async fn fetch(current: Version, target: Version) -> Result<History> {
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("Anser/", env!("CARGO_PKG_VERSION")))
        .default_headers({
            let mut headers = reqwest::header::HeaderMap::new();
            headers.insert(
                reqwest::header::ACCEPT,
                "application/vnd.github+json".parse().unwrap(),
            );
            headers.insert("X-GitHub-Api-Version", "2022-11-28".parse().unwrap());
            headers
        });
    let (proxy, password) = crate::proxy::current()?;
    if let Some(proxy) = proxy {
        builder = builder.proxy(
            crate::proxy::http_proxy(&proxy, &password).map_err(|_| "版本历史代理配置不可用")?,
        );
    }
    let client = builder.build().map_err(|_| "无法初始化版本历史请求")?;
    tokio::time::timeout(
        Duration::from_secs(45),
        collect(current, target, |number| page(&client, number)),
    )
    .await
    .map_err(|_| "获取版本历史超时，请检查网络或代理后重试")?
}
type Cache = BTreeMap<(String, String), (Instant, History)>;
fn cache() -> &'static Mutex<Cache> {
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(BTreeMap::new()))
}
#[tauri::command]
pub async fn update_release_history(
    current_version: String,
    target_version: String,
) -> Result<History> {
    let (current, target) = bounds(&current_version, &target_version)?;
    let key = (current.to_string(), target.to_string());
    {
        let mut cache = cache().lock().map_err(|_| "版本历史缓存不可用")?;
        cache.retain(|_, (time, _)| time.elapsed() < Duration::from_secs(600));
        if let Some((_, history)) = cache.get(&key) {
            return Ok(history.clone());
        }
    }
    let history = fetch(current, target).await?;
    let mut cache = cache().lock().map_err(|_| "版本历史缓存不可用")?;
    if cache.len() >= 4 {
        if let Some(oldest) = cache
            .iter()
            .min_by_key(|(_, (time, _))| *time)
            .map(|(key, _)| key.clone())
        {
            cache.remove(&oldest);
        }
    }
    cache.insert(key, (Instant::now(), history.clone()));
    Ok(history)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, future::ready};
    fn release(tag: &str) -> ApiRelease {
        ApiRelease {
            tag_name: tag.into(),
            name: Some(format!("Anser {tag}")),
            body: Some(format!("Notes for {tag}\n")),
            draft: false,
            prerelease: false,
            published_at: Some("2026-10-16T00:00:00Z".into()),
        }
    }
    async fn history(current: &str, target: &str, pages: Vec<Vec<ApiRelease>>) -> Result<History> {
        let (current, target) = bounds(current, target)?;
        let mut pages: VecDeque<_> = pages.into();
        collect(current, target, |_| {
            let items = pages.pop_front().unwrap_or_default();
            ready(Ok(Page {
                items,
                bytes: 1000,
                has_next: !pages.is_empty(),
            }))
        })
        .await
    }
    #[tokio::test]
    async fn returns_every_intervening_release_in_semver_order() {
        let result = history(
            "0.1.18",
            "0.1.23",
            vec![vec![
                release("v0.1.20"),
                release("v0.1.18"),
                release("v0.1.23"),
                release("v0.1.19"),
                release("v0.1.24"),
                release("v0.1.22"),
                release("v0.1.21"),
            ]],
        )
        .await
        .unwrap();
        assert_eq!(
            result
                .releases
                .iter()
                .map(|r| r.version.as_str())
                .collect::<Vec<_>>(),
            ["0.1.23", "0.1.22", "0.1.21", "0.1.20", "0.1.19"]
        );
        assert_eq!(result.current_version, "0.1.18");
        assert_eq!(result.releases[0].body, "Notes for v0.1.23\n");
    }
    #[tokio::test]
    async fn gaps_numeric_versions_and_duplicate_tags_count_actual_releases() {
        let result = history(
            "0.1.9+old",
            "0.1.23+new",
            vec![vec![
                release("v0.1.23"),
                release("0.1.23+rebuilt"),
                release("v0.1.10"),
                release("v0.1.20"),
            ]],
        )
        .await
        .unwrap();
        assert_eq!(
            result
                .releases
                .iter()
                .map(|r| r.version.as_str())
                .collect::<Vec<_>>(),
            ["0.1.23", "0.1.20", "0.1.10"]
        );
    }
    #[tokio::test]
    async fn drafts_unpublished_invalid_tags_and_preview_releases_are_excluded() {
        let mut draft = release("v0.1.22");
        draft.draft = true;
        let mut preview = release("v0.1.21");
        preview.prerelease = true;
        let mut unpublished = release("v0.1.20");
        unpublished.published_at = None;
        let result = history(
            "0.1.18",
            "0.1.23",
            vec![vec![
                release("v0.1.23"),
                draft,
                preview,
                unpublished,
                release("nightly"),
                release("v0.1.23-beta.1"),
            ]],
        )
        .await
        .unwrap();
        assert_eq!(result.releases.len(), 1);
    }
    #[tokio::test]
    async fn preview_target_can_include_matching_prereleases_and_empty_notes() {
        let mut target = release("v0.2.0-rc.2");
        target.prerelease = true;
        target.body = None;
        let result = history(
            "0.1.18",
            "0.2.0-rc.2",
            vec![vec![target, release("v0.2.0-rc.1"), release("v0.2.0")]],
        )
        .await
        .unwrap();
        assert_eq!(result.releases.len(), 2);
        assert_eq!(result.releases[0].body, "");
    }
    #[tokio::test]
    async fn pagination_continues_after_older_versions_and_rejects_later_page_failure() {
        let old = vec![release("v0.1.1"); PAGE_SIZE];
        let result = history(
            "0.1.18",
            "0.1.23",
            vec![old.clone(), vec![release("v0.1.23"), release("v0.1.19")]],
        )
        .await
        .unwrap();
        assert_eq!(result.releases.len(), 2);
        let (current, target) = bounds("0.1.18", "0.1.23").unwrap();
        let error = collect(current, target, |page| {
            ready(if page == 1 {
                Ok(Page {
                    items: old.clone(),
                    bytes: 100,
                    has_next: true,
                })
            } else {
                Err("network failed".into())
            })
        })
        .await
        .err()
        .unwrap();
        assert_eq!(error, "network failed");
    }
    #[tokio::test]
    async fn short_page_with_next_link_still_loads_later_releases() {
        let result = history(
            "0.1.18",
            "0.1.23",
            vec![vec![release("v0.1.19")], vec![release("v0.1.23")]],
        )
        .await
        .unwrap();
        assert_eq!(result.releases.len(), 2);
        assert_eq!(result.releases[0].version, "0.1.23");
    }
    #[tokio::test]
    async fn incomplete_history_or_missing_target_cannot_be_reported_as_complete() {
        assert!(history("0.1.18", "0.1.23", vec![vec![release("v0.1.22")]])
            .await
            .err()
            .unwrap()
            .contains("目标版本"));
        let (current, target) = bounds("0.1.18", "0.1.23").unwrap();
        let error = collect(current, target, |_| {
            ready(Ok(Page {
                items: vec![release("v0.1.23"); PAGE_SIZE],
                bytes: 1,
                has_next: true,
            }))
        })
        .await
        .err()
        .unwrap();
        assert!(error.contains("页数"));
    }
    #[tokio::test]
    async fn page_and_total_capacity_limits_fail_closed() {
        let (current, target) = bounds("0.1.18", "0.1.23").unwrap();
        assert!(collect(current.clone(), target.clone(), |_| ready(Ok(Page {
            items: vec![release("v0.1.23")],
            bytes: PAGE_BYTES + 1,
            has_next: false,
        })))
        .await
        .is_err());
        assert!(collect(current, target, |_| ready(Ok(Page {
            items: vec![release("v0.1.23"); PAGE_SIZE],
            bytes: PAGE_BYTES,
            has_next: true,
        })))
        .await
        .err()
        .unwrap()
        .contains("响应超过"));
    }
    #[test]
    fn invalid_or_reverse_range_is_rejected_before_any_request() {
        for (current, target) in [
            ("0.1.23", "0.1.18"),
            ("0.1.18", "0.1.18"),
            ("bad", "0.1.23"),
            ("0.1.18", "https://other.example/"),
        ] {
            assert!(bounds(current, target).is_err());
        }
    }
    #[tokio::test]
    #[ignore = "manual live read of public GitHub release metadata"]
    async fn live_public_release_range() {
        let (current, target) = bounds("0.1.13", "0.1.18").unwrap();
        let result = fetch(current, target).await.unwrap();
        assert_eq!(
            result
                .releases
                .iter()
                .map(|r| r.version.as_str())
                .collect::<Vec<_>>(),
            ["0.1.18", "0.1.17", "0.1.16", "0.1.15", "0.1.14"]
        );
        assert!(result.releases.iter().all(|r| !r.body.trim().is_empty()));
    }
}
