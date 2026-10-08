import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import type { Account, FolderSettings, Rule } from "@/lib/types";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { SelectGroup } from "./ui/select";
import { SelectField, SelectOption } from "./ui/select-field";
import { Alert, AlertDescription } from "./ui/alert";

export function RuleServerFolders({
  rule,
  account,
  onChange,
}: {
  rule: Rule;
  account?: Account;
  onChange: (rule: Rule) => void;
}) {
  const [settings, setSettings] = useState<FolderSettings | null>(null);
  const [error, setError] = useState("");
  const supported =
    !!account?.enabled &&
    account.protocol === "imap" &&
    account.provider !== "gmail";
  useEffect(() => {
    let live = true;
    setSettings(null);
    setError("");
    if (supported)
      void call<FolderSettings>("folder_settings", { id: account!.id })
        .then((s) => {
          if (live) setSettings(s);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    return () => {
      live = false;
    };
  }, [account?.id, supported]);
  const folders =
    settings?.folders.filter((f) => f.selectable && !f.syncError) || [];
  return (
    <FieldGroup>
      {!supported && (
        <Alert>
          <AlertDescription>
            请选择一个已启用的 IMAP 账号。Gmail 标签动作尚未支持。
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>无法加载服务器目录：{error}</AlertDescription>
        </Alert>
      )}
      {supported && settings && !folders.length && (
        <Alert>
          <AlertDescription>
            暂无可用目录，请先展开账号的服务器文件夹并完成收取。
          </AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel htmlFor="rule-source">来源文件夹</FieldLabel>
        <SelectField
          id="rule-source"
          aria-label="规则来源文件夹"
          value={rule.sourceFolder || ""}
          disabled={!supported || !settings}
          onValueChange={(sourceFolder) =>
            onChange({
              ...rule,
              sourceFolder,
              destination:
                rule.destination === sourceFolder ? "" : rule.destination,
            })
          }
        >
          <SelectGroup>
            <SelectOption value="">选择来源文件夹</SelectOption>
            {folders.map((f) => (
              <SelectOption key={f.name} value={f.name}>
                {f.displayName}
              </SelectOption>
            ))}
          </SelectGroup>
        </SelectField>
        <FieldDescription>
          仅处理当前位于此服务器文件夹的匹配邮件。服务器动作暂不支持正文条件。
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="rule-target">目标文件夹</FieldLabel>
        <SelectField
          id="rule-target"
          aria-label="规则目标文件夹"
          value={rule.destination}
          disabled={!supported || !settings}
          onValueChange={(destination) => onChange({ ...rule, destination })}
        >
          <SelectGroup>
            <SelectOption value="">选择目标文件夹</SelectOption>
            {folders
              .filter((f) => f.name !== rule.sourceFolder)
              .map((f) => (
                <SelectOption key={f.name} value={f.name}>
                  {f.displayName}
                </SelectOption>
              ))}
          </SelectGroup>
        </SelectField>
        <FieldDescription>
          {rule.action === "serverMove"
            ? "移动核对完成后从来源目录移除，已有本地存档保留。"
            : "保留来源目录的邮件，并核对目标副本。"}
          同一规则配置命中过的邮件不会重复入队；停用或删除规则不会取消已创建的服务器任务。
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
