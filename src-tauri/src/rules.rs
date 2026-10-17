use crate::models::*;
use serde::{Deserialize, Serialize};
pub fn validate(rule: &Rule) -> Result<()> {
    if rule.name.trim().is_empty() || rule.conditions.is_empty() {
        return Err("规则需要名称和至少一个条件".into());
    }
    if rule.actions.len() > 8 {
        return Err("一条规则最多添加 8 个动作".into());
    }
    for action in &rule.actions {
        let mut step = rule.clone();
        step.actions.clear();
        step.action = action.action.clone();
        step.destination = action.destination.clone();
        step.source_folder = action.source_folder.clone();
        validate_action(&step)?;
    }
    if rule.actions.is_empty() {
        validate_action(rule)?;
    }
    for c in &rule.conditions {
        validate_condition(c)?;
    }
    Ok(())
}
fn validate_action(rule: &Rule) -> Result<()> {
    if !["all", "any"].contains(&rule.mode.as_str())
        || ![
            "folder",
            "read",
            "unread",
            "star",
            "trash",
            "serverCopy",
            "serverMove",
            "save",
            "saveFolder",
        ]
        .contains(&rule.action.as_str())
    {
        return Err("无效的规则配置".into());
    }
    if matches!(rule.action.as_str(), "folder" | "saveFolder") && rule.destination.trim().is_empty()
    {
        return Err("请输入本地目标文件夹".into());
    }
    if remote(rule)
        && (rule.account_id.is_empty()
            || rule.source_folder.is_empty()
            || rule.destination.is_empty()
            || rule.source_folder.eq_ignore_ascii_case(&rule.destination)
            || [&rule.source_folder, &rule.destination]
                .iter()
                .any(|s| s.bytes().any(|b| b < 32 || b == 127)))
    {
        return Err("服务器规则需要指定账号、来源目录和不同的目标目录".into());
    }
    Ok(())
}
fn validate_condition(c: &Condition) -> Result<()> {
    if ![
        "sender",
        "recipients",
        "subject",
        "body",
        "attachment",
        "date",
        "sizeKb",
        "read",
        "starred",
    ]
    .contains(&c.field.as_str())
        || ![
            "contains",
            "equals",
            "notContains",
            "startsWith",
            "endsWith",
            "before",
            "after",
            "greaterThan",
            "lessThan",
        ]
        .contains(&c.operator.as_str())
    {
        return Err("不支持的条件".into());
    }
    if c.field == "date" && chrono::NaiveDate::parse_from_str(&c.value, "%Y-%m-%d").is_err() {
        return Err("日期条件格式为 YYYY-MM-DD".into());
    }
    if c.field == "date" && !["before", "after"].contains(&c.operator.as_str())
        || c.field == "attachment" && c.operator != "equals"
        || matches!(c.field.as_str(), "read" | "starred") && c.operator != "equals"
        || c.field == "sizeKb"
            && !["greaterThan", "lessThan", "equals"].contains(&c.operator.as_str())
        || !["date", "attachment", "sizeKb", "read", "starred"].contains(&c.field.as_str())
            && ![
                "contains",
                "equals",
                "notContains",
                "startsWith",
                "endsWith",
            ]
            .contains(&c.operator.as_str())
    {
        return Err("条件字段与比较方式不匹配".into());
    }
    if c.field == "attachment" && !["true", "false"].contains(&c.value.as_str()) {
        return Err("附件条件请选择有附件或无附件".into());
    }
    if matches!(c.field.as_str(), "read" | "starred")
        && !["true", "false"].contains(&c.value.as_str())
    {
        return Err("已读或星标条件请选择是或否".into());
    }
    if c.field == "sizeKb"
        && (c.value.parse::<u64>().is_err()
            || c.value
                .parse::<u64>()
                .ok()
                .and_then(|n| n.checked_mul(1024))
                .is_none())
    {
        return Err("邮件大小需填写非负整数 KB".into());
    }
    if !["attachment", "read", "starred"].contains(&c.field.as_str()) && c.value.trim().is_empty() {
        return Err("请填写条件值，避免意外匹配全部邮件".into());
    }
    Ok(())
}
pub fn expand(configured: &[Rule]) -> Vec<Rule> {
    configured
        .iter()
        .flat_map(|rule| {
            let actions = if rule.actions.is_empty() {
                vec![RuleAction {
                    action: rule.action.clone(),
                    destination: rule.destination.clone(),
                    source_folder: rule.source_folder.clone(),
                }]
            } else {
                rule.actions.clone()
            };
            let last = actions.len() - 1;
            actions.into_iter().enumerate().map(move |(index, action)| {
                let mut step = rule.clone();
                step.id = if index == 0 {
                    rule.id.clone()
                } else {
                    format!("{}#{}", rule.id, index)
                };
                step.action = action.action;
                step.destination = action.destination;
                step.source_folder = action.source_folder;
                step.stop = rule.stop && index == last;
                step.actions.clear();
                step
            })
        })
        .collect()
}
pub fn matches(rule: &Rule, mail: &Mail) -> bool {
    match_state(rule, mail, body_available(mail)) == MatchState::Match
}
fn matches_with_observed(
    rule: &Rule,
    mail: &Mail,
    observed: Option<ObservedStatus>,
    body_available: bool,
) -> bool {
    if !rule.enabled
        || (!rule.account_id.is_empty() && rule.account_id != mail.account_id)
        || rule.conditions.is_empty()
    {
        return false;
    }
    let test = |c: &Condition| {
        if c.field == "body" && !body_available {
            return false;
        }
        if c.field == "sizeKb" {
            if !body_available {
                return false;
            }
            let Some(bytes) = c
                .value
                .parse::<u64>()
                .ok()
                .and_then(|n| n.checked_mul(1024))
            else {
                return false;
            };
            return match c.operator.as_str() {
                "greaterThan" => mail.size > bytes,
                "lessThan" => mail.size < bytes,
                "equals" => mail.size == bytes,
                _ => false,
            };
        }
        let text = match c.field.as_str() {
            "sender" => &mail.sender,
            "recipients" => &mail.recipients,
            "subject" => &mail.subject,
            "body" => &mail.body,
            "date" => &mail.date,
            "attachment" => return mail.has_attachments == (c.value != "false"),
            // Status conditions describe the mail as first matched; later
            // actions such as "mark read" or "star" must not invalidate the
            // remaining ordered steps of the same rule.
            "read" => return observed.map_or(mail.is_read, |s| s.is_read) == (c.value != "false"),
            "starred" => {
                return observed.map_or(mail.starred, |s| s.starred) == (c.value != "false")
            }
            _ => return false,
        };
        let a = text.to_lowercase();
        let b = c.value.to_lowercase();
        match c.operator.as_str() {
            "contains" => a.contains(&b),
            "notContains" => !a.contains(&b),
            "equals" => a == b,
            "startsWith" => a.starts_with(&b),
            "endsWith" => a.ends_with(&b),
            "before" => a.get(..10).unwrap_or(&a) < b.as_str(),
            "after" => a.get(..10).unwrap_or(&a) > b.as_str(),
            _ => false,
        }
    };
    if rule.mode == "any" {
        rule.conditions.iter().any(test)
    } else {
        rule.conditions.iter().all(test)
    }
}

#[cfg(test)]
mod body_tests {
    use super::*;
    #[test]
    fn text_prefix_and_suffix_match_without_broadening_to_substrings() {
        let account = crate::tests::account();
        let mail = crate::archive::parse(&crate::tests::raw(), &account, "INBOX")
            .unwrap()
            .0;
        let mut rule = Rule {
            id: "prefix".into(),
            name: "prefix".into(),
            account_id: account.id,
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "subject".into(),
                operator: "startsWith".into(),
                value: mail.subject.chars().take(3).collect(),
            }],
            actions: Vec::new(),
            action: "read".into(),
            destination: String::new(),
            source_folder: String::new(),
            stop: false,
        };
        validate(&rule).unwrap();
        assert!(matches(&rule, &mail));
        rule.conditions[0].operator = "endsWith".into();
        assert!(!matches(&rule, &mail));
        rule.conditions[0].value = mail
            .subject
            .chars()
            .rev()
            .take(3)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        assert!(matches(&rule, &mail));
        rule.conditions[0].field = "date".into();
        assert!(validate(&rule).is_err());
    }
    #[test]
    fn size_condition_waits_for_complete_mime_and_uses_bytes() {
        let account = crate::tests::account();
        let mut mail = crate::archive::parse(&crate::tests::raw(), &account, "INBOX")
            .unwrap()
            .0;
        let rule = Rule {
            id: "size".into(),
            name: "size".into(),
            account_id: account.id,
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "sizeKb".into(),
                operator: "lessThan".into(),
                value: "1".into(),
            }],
            actions: Vec::new(),
            action: "read".into(),
            destination: String::new(),
            source_folder: String::new(),
            stop: false,
        };
        validate(&rule).unwrap();
        mail.saved_locally = false;
        assert_eq!(match_state(&rule, &mail, false), MatchState::NeedsBody);
        mail.size = 512;
        assert_eq!(match_state(&rule, &mail, true), MatchState::Match);
        mail.size = 2048;
        assert_eq!(match_state(&rule, &mail, true), MatchState::NoMatch);
    }
    #[test]
    fn online_empty_body_never_matches_negative_conditions_and_known_any_header_still_matches() {
        let account = crate::tests::account();
        let mut mail = crate::archive::parse(&crate::tests::raw(), &account, "INBOX")
            .unwrap()
            .0;
        mail.saved_locally = false;
        mail.body.clear();
        let mut rule = Rule {
            id: "body".into(),
            name: "body".into(),
            account_id: account.id,
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "body".into(),
                operator: "notContains".into(),
                value: "missing".into(),
            }],
            actions: Vec::new(),
            action: "trash".into(),
            destination: String::new(),
            source_folder: String::new(),
            stop: true,
        };
        assert!(!matches(&rule, &mail));
        mail.saved_locally = true;
        assert!(matches(&rule, &mail));
        mail.parse_warnings
            .push("text/plain 正文片段无法解码：fixture".into());
        assert!(!matches(&rule, &mail));
        mail.parse_warnings.clear();
        mail.saved_locally = false;
        rule.mode = "any".into();
        rule.conditions.push(Condition {
            field: "subject".into(),
            operator: "contains".into(),
            value: "invoice".into(),
        });
        assert!(matches(&rule, &mail));
    }
    #[test]
    fn read_and_star_status_conditions_compare_booleans_only() {
        let account = crate::tests::account();
        let mut mail = crate::archive::parse(&crate::tests::raw(), &account, "INBOX")
            .unwrap()
            .0;
        mail.is_read = false;
        mail.starred = true;
        let mut rule = Rule {
            id: "status".into(),
            name: "status".into(),
            account_id: account.id,
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "read".into(),
                operator: "equals".into(),
                value: "false".into(),
            }],
            actions: Vec::new(),
            action: "read".into(),
            destination: String::new(),
            source_folder: String::new(),
            stop: false,
        };
        validate(&rule).unwrap();
        assert!(matches(&rule, &mail));
        rule.conditions[0].value = "true".into();
        assert!(!matches(&rule, &mail));
        mail.is_read = true;
        assert!(matches(&rule, &mail));
        rule.conditions[0] = Condition {
            field: "starred".into(),
            operator: "equals".into(),
            value: "true".into(),
        };
        validate(&rule).unwrap();
        assert!(matches(&rule, &mail));
        rule.conditions[0].value = "false".into();
        assert!(!matches(&rule, &mail));
        mail.starred = false;
        assert!(matches(&rule, &mail));
        rule.conditions[0].operator = "contains".into();
        assert!(validate(&rule).is_err());
        rule.conditions[0] = Condition {
            field: "starred".into(),
            operator: "equals".into(),
            value: "maybe".into(),
        };
        assert!(validate(&rule).is_err());
    }
    #[test]
    fn observed_snapshot_keeps_status_conditions_after_actions_change_them() {
        let account = crate::tests::account();
        let mut mail = crate::archive::parse(&crate::tests::raw(), &account, "INBOX")
            .unwrap()
            .0;
        mail.is_read = false;
        let observed = mail.clone();
        let rule = Rule {
            id: "unread".into(),
            name: "unread".into(),
            account_id: account.id,
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "read".into(),
                operator: "equals".into(),
                value: "false".into(),
            }],
            actions: Vec::new(),
            action: "read".into(),
            destination: String::new(),
            source_folder: String::new(),
            stop: false,
        };
        mail.is_read = true;
        assert_eq!(match_state(&rule, &mail, true), MatchState::NoMatch);
        assert_eq!(
            match_state_observed(&rule, &mail, Some(ObservedStatus::of(&observed)), true),
            MatchState::Match
        );
    }
}

pub fn remote(rule: &Rule) -> bool {
    matches!(rule.action.as_str(), "serverCopy" | "serverMove")
}
pub fn saves(rule: &Rule) -> bool {
    matches!(rule.action.as_str(), "save" | "saveFolder")
}
pub fn body_decode_failed(mail: &Mail) -> bool {
    mail.parse_warnings.iter().any(|warning| {
        warning.starts_with("text/plain 正文片段无法解码：")
            || warning.starts_with("text/html 正文片段无法解码：")
    })
}
pub fn body_available(mail: &Mail) -> bool {
    mail.saved_locally && !body_decode_failed(mail)
}
#[derive(Debug, PartialEq, Eq)]
pub enum MatchState {
    Match,
    NoMatch,
    NeedsBody,
}
/// Read and star flags as observed when an ordered rule chain first matched.
/// Later actions may flip these flags, so every step of the same rule keeps
/// evaluating them against this small snapshot.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedStatus {
    pub is_read: bool,
    pub starred: bool,
}
impl ObservedStatus {
    pub fn of(mail: &Mail) -> Self {
        Self {
            is_read: mail.is_read,
            starred: mail.starred,
        }
    }
}
pub fn match_state(rule: &Rule, mail: &Mail, body_available: bool) -> MatchState {
    match_state_observed(rule, mail, None, body_available)
}
/// Evaluate a rule chain step against the mail as it was first matched.
/// Text and size come from `mail` (the parsed original), while read, star and
/// other status conditions keep the snapshot so earlier actions cannot make a
/// later step of the same rule miss.
pub fn match_state_observed(
    rule: &Rule,
    mail: &Mail,
    observed: Option<ObservedStatus>,
    body_available: bool,
) -> MatchState {
    if !rule.enabled
        || rule.conditions.is_empty()
        || (!rule.account_id.is_empty() && rule.account_id != mail.account_id)
    {
        return MatchState::NoMatch;
    }
    let mut unknown = false;
    for condition in &rule.conditions {
        if ((condition.field == "body" || condition.field == "sizeKb") && !body_available)
            || (condition.field == "attachment"
                && !body_available
                && !mail.attachment_metadata_known
                && !mail.has_attachments)
        {
            unknown = true;
            continue;
        }
        let mut one = rule.clone();
        one.mode = "all".into();
        one.conditions = vec![condition.clone()];
        let matched = matches_with_observed(&one, mail, observed, body_available);
        if rule.mode == "all" && !matched {
            return MatchState::NoMatch;
        }
        if rule.mode == "any" && matched {
            return MatchState::Match;
        }
    }
    if unknown {
        MatchState::NeedsBody
    } else if rule.mode == "all" {
        MatchState::Match
    } else {
        MatchState::NoMatch
    }
}
