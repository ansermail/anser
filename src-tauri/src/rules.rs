use crate::models::*;
pub fn validate(rule: &Rule) -> Result<()> {
    if rule.name.trim().is_empty() || rule.conditions.is_empty() {
        return Err("规则需要名称和至少一个条件".into());
    }
    if !["all", "any"].contains(&rule.mode.as_str())
        || !["folder", "read", "unread", "star", "trash"].contains(&rule.action.as_str())
    {
        return Err("无效的规则配置".into());
    }
    if rule.action == "folder" && rule.destination.trim().is_empty() {
        return Err("请输入本地目标文件夹".into());
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
