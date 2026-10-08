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
        ]
        .contains(&rule.action.as_str())
    {
        return Err("无效的规则配置".into());
    }
    if rule.action == "folder" && rule.destination.trim().is_empty() {
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
        if remote(rule) && c.field == "body" {
            return Err("服务器动作暂不支持正文条件，请先使用主题、发件人等条件".into());
        }
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
    if !rule.enabled
        || (!rule.account_id.is_empty() && rule.account_id != mail.account_id)
        || rule.conditions.is_empty()
    {
        return false;
    }
    let test = |c: &Condition| {
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

pub fn remote(rule: &Rule) -> bool {
    matches!(rule.action.as_str(), "serverCopy" | "serverMove")
}
