import { t } from "@/lib/i18n";
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
            {t(
              "Choose an enabled IMAP account. Gmail label actions are not yet supported.",
            )}
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {t("Could not load server folders: ")}
            {error}
          </AlertDescription>
        </Alert>
      )}
      {supported && settings && !folders.length && (
        <Alert>
          <AlertDescription>
            {t(
              "No available folders. Expand the account's server folders and complete a mail check.",
            )}
          </AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel htmlFor="rule-source">{t("Source folder")}</FieldLabel>
        <SelectField
          id="rule-source"
          aria-label={t("Rule source folder")}
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
            <SelectOption value="">{t("Select source folder")}</SelectOption>
            {folders.map((f) => (
              <SelectOption key={f.name} value={f.name}>
                {f.displayName}
              </SelectOption>
            ))}
          </SelectGroup>
        </SelectField>
        <FieldDescription>
          {t(
            "Only processes matching messages currently in this server folder. Server actions do not yet support body conditions.",
          )}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="rule-target">{t("Destination folder")}</FieldLabel>
        <SelectField
          id="rule-target"
          aria-label={t("Rule destination folder")}
          value={rule.destination}
          disabled={!supported || !settings}
          onValueChange={(destination) => onChange({ ...rule, destination })}
        >
          <SelectGroup>
            <SelectOption value="">
              {t("Select destination folder")}
            </SelectOption>
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
            ? t(
                "After move verification, the source is removed. Existing local archives remain.",
              )
            : t(
                "Keep messages in the source folder and verify the destination copy.",
              )}
          {t(
            "Messages already matched by this rule configuration are not queued again. Disabling or deleting a rule does not cancel existing server tasks.",
          )}
        </FieldDescription>
      </Field>
    </FieldGroup>
  );
}
