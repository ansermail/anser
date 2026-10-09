use crate::models::*;
pub fn validate(rule: &Rule) -> Result<()> {
    if rule.name.trim().is_empty() || rule.conditions.is_empty() {
        return Err("规则需要名称和至少一个条件".into());
    }
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
    for c in &rule.conditions {
        if ![
            "sender",
            "recipients",
            "subject",
            "body",
            "attachment",
            "date",
        ]
        .contains(&c.field.as_str())
            || !["contains", "equals", "notContains", "before", "after"]
                .contains(&c.operator.as_str())
        {
            return Err("不支持的条件".into());
        }
        if c.field == "date" && chrono::NaiveDate::parse_from_str(&c.value, "%Y-%m-%d").is_err() {
            return Err("日期条件格式为 YYYY-MM-DD".into());
        }
        if c.field != "attachment" && c.value.trim().is_empty() {
            return Err("请填写条件值，避免意外匹配全部邮件".into());
        }
    }
    Ok(())
}
pub fn matches(rule: &Rule, mail: &Mail) -> bool {
    let decoded = !mail.parse_warnings.iter().any(|warning| {
        warning.starts_with("text/plain 正文片段无法解码：")
            || warning.starts_with("text/html 正文片段无法解码：")
    });
    matches_with_body(rule, mail, mail.saved_locally && decoded)
}
pub fn matches_with_body(rule: &Rule, mail: &Mail, body_available: bool) -> bool {
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
        let text = match c.field.as_str() {
            "sender" => &mail.sender,
            "recipients" => &mail.recipients,
            "subject" => &mail.subject,
            "body" => &mail.body,
            "date" => &mail.date,
            "attachment" => return mail.has_attachments == (c.value != "false"),
            _ => return false,
        };
        let a = text.to_lowercase();
        let b = c.value.to_lowercase();
        match c.operator.as_str() {
            "contains" => a.contains(&b),
            "notContains" => !a.contains(&b),
            "equals" => a == b,
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
pub fn match_state(rule: &Rule, mail: &Mail, body_available: bool) -> MatchState {
    if !rule.enabled
        || rule.conditions.is_empty()
        || (!rule.account_id.is_empty() && rule.account_id != mail.account_id)
    {
        return MatchState::NoMatch;
    }
    let mut unknown = false;
    for condition in &rule.conditions {
        if (condition.field == "body" && !body_available)
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
        let matched = matches(&one, mail);
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
