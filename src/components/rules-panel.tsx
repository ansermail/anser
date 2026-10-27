import { calendarLocale, t } from "@/lib/i18n";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Plus,
  ArrowDown,
  ArrowUp,
  ArrowRight,
  CalendarDays,
  SlidersHorizontal,
  Trash2,
  Play,
  Folder,
  Star,
  MailCheck,
  MoreHorizontal,
} from "lucide-react";
import { SidebarTrigger } from "./ui/sidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Switch } from "./ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import type {
  Condition,
  Rule,
  RuleAction,
  Snapshot,
  FolderSettings,
} from "@/lib/types";
import { call } from "@/lib/api";
import { toast } from "sonner";
import { SelectGroup } from "./ui/select";
import { RuleServerFolders } from "./rule-server-folders";
import { RuleExecutions } from "./rule-executions";
import { RuleRunsPanel } from "./rule-runs";

const fields: { [key: string]: string } = {
  get sender() {
    return t("From");
  },
  get recipients() {
    return t("To");
  },
  get cc() {
    return t("Cc");
  },
  get recipientsOrCc() {
    return t("To or Cc");
  },
  get subject() {
    return t("Subject");
  },
  get body() {
    return t("Body");
  },
  get attachment() {
    return t("Has attachments");
  },
  get read() {
    return t("Read status");
  },
  get starred() {
    return t("Star status");
  },
  get priority() {
    return t("Priority");
  },
  get date() {
    return t("Message date");
  },
  get ageDays() {
    return t("Age in days");
  },
  get sizeKb() {
    return t("Message size (KB)");
  },
};
const choiceConditions: Record<string, [string, string][]> = {
  attachment: [
    ["true", "Has attachments"],
    ["false", "No attachments"],
  ],
  read: [
    ["true", "Read"],
    ["false", "Unread"],
  ],
  starred: [
    ["true", "Starred"],
    ["false", "Not starred"],
  ],
  priority: [
    ["high", "High"],
    ["normal", "Normal"],
    ["low", "Low"],
  ],
};
const conditionValueLabel = (c: Condition) =>
  t(
    choiceConditions[c.field]?.find(([value]) => value === c.value)?.[1] ?? "",
  ) || `「${c.value}」`;
const conditionOperators: Record<string, string> = {
  get contains() {
    return t("Contains");
  },
  get notContains() {
    return t("Does not contain");
  },
  get equals() {
    return t("Equals");
  },
  get startsWith() {
    return t("Starts with");
  },
  get endsWith() {
    return t("Ends with");
  },
  get before() {
    return t("Before");
  },
  get after() {
    return t("After");
  },
  get greaterThan() {
    return t("Greater than");
  },
  get lessThan() {
    return t("Less than");
  },
};
const actions: { [key: string]: string } = {
  get folder() {
    return t("Move to local folder");
  },
  get save() {
    return t("Save complete message locally");
  },
  get saveFolder() {
    return t("Save complete message & file locally");
  },
  get read() {
    return t("Mark as read");
  },
  get unread() {
    return t("Mark as unread");
  },
  get star() {
    return t("Add star");
  },
  get trash() {
    return t("Move to local trash");
  },
  get serverCopy() {
    return t("Copy to server folder");
  },
  get serverMove() {
    return t("Move to server folder");
  },
};
const ruleActions = (rule: Rule): RuleAction[] =>
  rule.actions?.length
    ? rule.actions
    : [
        {
          action: rule.action,
          destination: rule.destination,
          sourceFolder: rule.sourceFolder || "",
        },
      ];
function withActions(rule: Rule, next: RuleAction[]): Rule {
  const first = next[0];
  return {
    ...rule,
    actions: next,
    action: first.action,
    destination: first.destination,
    sourceFolder: first.sourceFolder,
  };
}
function ConditionDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T00:00:00`) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="condition-value justify-start"
          aria-label={t("Condition date")}
        >
          <CalendarDays data-icon="inline-start" />
          <span className="truncate">
            {selected
              ? format(
                  selected,
                  calendarLocale().code === "en-US"
                    ? "MMM d, yyyy"
                    : "yyyy/MM/dd",
                  { locale: calendarLocale() },
                )
              : t("Choose date")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0"
        aria-label={t("Select condition date")}
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
          locale={calendarLocale()}
          captionLayout="dropdown"
          startMonth={new Date(1900, 0)}
          endMonth={new Date(2100, 11)}
          defaultMonth={selected}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
export function RulesPanel({
  data,
  onChange,
  onShowTasks,
}: {
  data: Snapshot;
  onChange: () => void;
  onShowTasks: () => void;
}) {
  const [editing, setEditing] = useState<Rule | null>(null),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string[] | null>(null);
  const remote = (r: Rule) =>
    ruleActions(r).some((step) =>
      ["serverCopy", "serverMove"].includes(step.action),
    );
  const [folderNames, setFolderNames] = useState<
    Record<string, Record<string, string>>
  >({});
  const remoteAccounts = [
    ...new Set(data.rules.filter(remote).map((r) => r.accountId)),
  ]
    .sort()
    .join(",");
  const waitingPreview =
    preview?.filter((s) => s.endsWith("（等待完整邮件核对）")).length ?? 0;
  useEffect(() => {
    let live = true;
    for (const id of remoteAccounts.split(",").filter(Boolean))
      void call<FolderSettings>("folder_settings", { id })
        .then((s) => {
          if (live)
            setFolderNames((names) => ({
              ...names,
              [id]: Object.fromEntries(
                s.folders.map((f) => [f.name, f.displayName]),
              ),
            }));
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [remoteAccounts]);
  const folderLabel = (r: Rule, path: string, fallback: string) =>
    folderNames[r.accountId]?.[path] ||
    (path === "INBOX" ? t("Inbox") : fallback);
  async function save(rs: Rule[]) {
    try {
      await call("save_rules", { rules: rs });
      onChange();
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    }
  }
  async function run() {
    setBusy(true);
    try {
      const n = await call<number>("run_rules");
      toast.success(
        t(
          "Executed or queued {value0} rule actions. See rule tasks and history for asynchronous results.",
          { value0: n },
        ),
      );
      onChange();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  function move(i: number, d: number) {
    const rs = [...data.rules];
    [rs[i], rs[i + d]] = [rs[i + d], rs[i]];
    void save(rs);
  }
  return (
    <section className="workspace-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">A LITTLE ORDER</span>
          <div className="page-title-row">
            <SidebarTrigger
              title={t("Toggle sidebar")}
              aria-label={t("Toggle sidebar")}
            />
            <h1>{t("Let mail find its place")}</h1>
          </div>
          <p>{t("Set rules once. Make time for what matters.")}</p>
        </div>
        <Button
          onClick={() => {
            setPreview(null);
            setEditing({
              id: crypto.randomUUID(),
              name: "",
              accountId: "",
              enabled: true,
              mode: "all",
              conditions: [
                { field: "subject", operator: "contains", value: "" },
              ],
              action: "folder",
              destination: "",
              actions: [
                { action: "folder", destination: "", sourceFolder: "" },
              ],
              stop: true,
            });
          }}
        >
          <Plus size={16} />
          {t("New rule")}
        </Button>
      </div>
      <div className="info-strip">
        <SlidersHorizontal size={17} />
        <span>
          {t(
            "Rules run in order. Local filing keeps originals; existing server actions continue under their configured rules.",
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={run}
          disabled={busy || !data.rules.length}
        >
          <Play size={14} />
          {busy ? t("Running…") : t("Run on existing mail")}
        </Button>
      </div>
      <div className="rule-list">
        {data.rules.map((r, i) => (
          <article
            className={`rule-card ${r.enabled ? "" : "disabled-rule"}`}
            key={r.id}
          >
            <div className="rule-number">{String(i + 1).padStart(2, "0")}</div>
            <div className="rule-body">
              <div className="rule-title">
                <h3>{r.name}</h3>
                {r.stop && <span>{t("Stop after match")}</span>}
              </div>
              <p>
                {r.conditions
                  .map(
                    (c) =>
                      `${fields[c.field]} ${conditionOperators[c.operator] || c.operator}${conditionValueLabel(c)}`,
                  )
                  .join(r.mode === "all" ? t(" AND ") : t(" OR "))}
              </p>
              <div className="rule-action">
                <ArrowRight size={13} />
                {r.action === "folder" ? (
                  <Folder size={14} />
                ) : r.action === "star" ? (
                  <Star size={14} />
                ) : (
                  <MailCheck size={14} />
                )}{" "}
                {ruleActions(r)
                  .map(
                    (step) =>
                      `${actions[step.action]}${step.destination ? `「${step.destination}」` : ""}`,
                  )
                  .join(" → ")}
              </div>
            </div>
            <div className="rule-controls">
              <Switch
                checked={r.enabled}
                aria-label={t("Enable {value0}", { value0: r.name })}
                onCheckedChange={(v) =>
                  void save(
                    data.rules.map((x) =>
                      x.id === r.id ? { ...x, enabled: v } : x,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("Move up")}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("Move down")}
                disabled={i === data.rules.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("Edit rule")}
                onClick={() => {
                  setPreview(null);
                  setEditing(withActions(structuredClone(r), ruleActions(r)));
                }}
              >
                <MoreHorizontal size={18} />
              </Button>
            </div>
          </article>
        ))}
        {!data.rules.length && (
          <div className="panel-empty">
            <SlidersHorizontal size={34} />
            <h3>{t("An inbox with its own order")}</h3>
            <p>
              {t(
                "Try filing project mail or bills into a local folder automatically.",
              )}
            </p>
          </div>
        )}
      </div>
      <div className="quiet-note">
        {t(
          "No need to keep webmail open. Anser processes new mail automatically while running on this computer.",
        )}
      </div>
      <RuleExecutions onShowTasks={onShowTasks} />
      <RuleRunsPanel onShowTasks={onShowTasks} />
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
      >
        <DialogContent className="w-[900px] max-w-[calc(100%-2rem)] sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Edit mail rule")}</DialogTitle>
            <DialogDescription>
              {t(
                "Set accounts, conditions and actions. Preview before saving.",
              )}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form
              className="rule-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const rs = data.rules.some((r) => r.id === editing.id)
                  ? data.rules.map((r) => (r.id === editing.id ? editing : r))
                  : [...data.rules, editing];
                if (await save(rs)) {
                  setEditing(null);
                  toast.success(t("Rule saved"));
                }
              }}
            >
              <div className="field">
                <Label>{t("Rule name")}</Label>
                <Input
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder={t("For example: File project mail")}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <Label>{t("Accounts")}</Label>
                  <SelectField
                    value={editing.accountId}
                    aria-label={t("Rule accounts")}
                    onValueChange={(value) =>
                      setEditing(
                        withActions(
                          { ...editing, accountId: value },
                          ruleActions(editing).map((step) =>
                            ["serverCopy", "serverMove"].includes(step.action)
                              ? { ...step, sourceFolder: "", destination: "" }
                              : step,
                          ),
                        ),
                      )
                    }
                  >
                    <SelectGroup>
                      <SelectOption value="" disabled={remote(editing)}>
                        {t("All accounts")}
                      </SelectOption>
                      {data.accounts.map((a) => (
                        <SelectOption
                          key={a.id}
                          value={a.id}
                          disabled={
                            remote(editing) &&
                            (!a.enabled ||
                              a.protocol !== "imap" ||
                              a.provider === "gmail")
                          }
                        >
                          {a.email}
                        </SelectOption>
                      ))}
                    </SelectGroup>
                  </SelectField>
                </div>
                <div className="field">
                  <Label>{t("Match mode")}</Label>
                  <SelectField
                    value={editing.mode}
                    onValueChange={(value) =>
                      setEditing({
                        ...editing,
                        mode: value as "all" | "any",
                      })
                    }
                  >
                    <SelectGroup>
                      <SelectOption value="all">
                        {t("Match all conditions")}
                      </SelectOption>
                      <SelectOption value="any">
                        {t("Match any condition")}
                      </SelectOption>
                    </SelectGroup>
                  </SelectField>
                </div>
              </div>
              <div className="conditions">
                {editing.conditions.map((c, i) => (
                  <div className="condition" key={i}>
                    <SelectField
                      aria-label={t("Condition field")}
                      value={c.field}
                      onValueChange={(value) =>
                        setEditing({
                          ...editing,
                          conditions: editing.conditions.map((x, j) =>
                            j === i
                              ? {
                                  field: value,
                                  operator:
                                    value === "date"
                                      ? "after"
                                      : ["sizeKb", "ageDays"].includes(value)
                                        ? "greaterThan"
                                        : choiceConditions[value]
                                          ? "equals"
                                          : "contains",
                                  value:
                                    value === "priority"
                                      ? "normal"
                                      : choiceConditions[value]
                                        ? "true"
                                        : "",
                                }
                              : x,
                          ),
                        })
                      }
                    >
                      <SelectGroup>
                        {Object.entries(fields).map(([k, v]) => (
                          <SelectOption key={k} value={k}>
                            {v}
                          </SelectOption>
                        ))}
                      </SelectGroup>
                    </SelectField>
                    <SelectField
                      aria-label={t("Condition operator")}
                      key={`${i}-${c.field}`}
                      value={c.operator}
                      onValueChange={(value) =>
                        setEditing({
                          ...editing,
                          conditions: editing.conditions.map((x, j) =>
                            j === i ? { ...x, operator: value } : x,
                          ),
                        })
                      }
                    >
                      <SelectGroup>
                        {(c.field === "date"
                          ? [
                              ["before", t("Before")],
                              ["after", t("After")],
                            ]
                          : choiceConditions[c.field]
                            ? [["equals", t("Equals")]]
                            : c.field === "ageDays"
                              ? [
                                  ["greaterThan", t("Greater than")],
                                  ["lessThan", t("Less than")],
                                  ["equals", t("Equals")],
                                ]
                              : c.field === "sizeKb"
                                ? [
                                    ["greaterThan", t("Greater than")],
                                    ["lessThan", t("Less than")],
                                    ["equals", t("Equals")],
                                  ]
                                : [
                                    ["contains", t("Contains")],
                                    ["equals", t("Equals")],
                                    ["notContains", t("Does not contain")],
                                    ["startsWith", t("Starts with")],
                                    ["endsWith", t("Ends with")],
                                  ]
                        ).map(([k, v]) => (
                          <SelectOption key={k} value={k}>
                            {v}
                          </SelectOption>
                        ))}
                      </SelectGroup>
                    </SelectField>
                    {choiceConditions[c.field] ? (
                      <SelectField
                        className="condition-value"
                        aria-label={t("Condition value")}
                        value={c.value}
                        onValueChange={(value) =>
                          setEditing({
                            ...editing,
                            conditions: editing.conditions.map((x, j) =>
                              j === i ? { ...x, value } : x,
                            ),
                          })
                        }
                      >
                        <SelectGroup>
                          {choiceConditions[c.field].map(([k, v]) => (
                            <SelectOption key={k} value={k}>
                              {t(v)}
                            </SelectOption>
                          ))}
                        </SelectGroup>
                      </SelectField>
                    ) : c.field === "date" ? (
                      <ConditionDatePicker
                        value={c.value}
                        onChange={(value) =>
                          setEditing({
                            ...editing,
                            conditions: editing.conditions.map((x, j) =>
                              j === i ? { ...x, value } : x,
                            ),
                          })
                        }
                      />
                    ) : (
                      <Input
                        aria-label={t("Condition value")}
                        required
                        type={
                          ["sizeKb", "ageDays"].includes(c.field)
                            ? "number"
                            : "text"
                        }
                        min={
                          ["sizeKb", "ageDays"].includes(c.field)
                            ? 0
                            : undefined
                        }
                        step={
                          ["sizeKb", "ageDays"].includes(c.field)
                            ? 1
                            : undefined
                        }
                        placeholder={
                          c.field === "sizeKb"
                            ? t("Integer KB")
                            : c.field === "ageDays"
                              ? t("Days")
                              : c.field === "cc"
                                ? t("For example: Cc address or keyword")
                                : c.field === "recipientsOrCc"
                                  ? t("To or Cc address")
                                  : t("Keyword")
                        }
                        value={c.value}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            conditions: editing.conditions.map((x, j) =>
                              j === i ? { ...x, value: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={editing.conditions.length === 1}
                      title={t("Remove condition")}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          conditions: editing.conditions.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setEditing({
                    ...editing,
                    conditions: [
                      ...editing.conditions,
                      { field: "sender", operator: "contains", value: "" },
                    ],
                  })
                }
              >
                <Plus size={14} />
                {t("Add condition")}
              </Button>
              <div className="field">
                <Label>{t("Run actions in order")}</Label>
                {ruleActions(editing).map((step, index) => (
                  <div className="rounded-md border p-3 space-y-3" key={index}>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground shrink-0">
                        {index + 1}.
                      </span>
                      <SelectField
                        className="w-[230px] shrink-0"
                        aria-label={
                          index === 0
                            ? t("Rule action")
                            : t("Rule action {value0}", { value0: index + 1 })
                        }
                        value={step.action}
                        onValueChange={(value) =>
                          setEditing(
                            withActions(
                              editing,
                              ruleActions(editing).map((item, position) =>
                                position === index
                                  ? {
                                      action: value,
                                      destination: "",
                                      sourceFolder: "",
                                    }
                                  : item,
                              ),
                            ),
                          )
                        }
                      >
                        <SelectGroup>
                          {Object.entries(actions)
                            .filter(
                              ([key]) =>
                                !["serverCopy", "serverMove"].includes(key) ||
                                key === step.action,
                            )
                            .map(([key, label]) => (
                              <SelectOption key={key} value={key}>
                                {label}
                              </SelectOption>
                            ))}
                        </SelectGroup>
                      </SelectField>
                      {["folder", "saveFolder"].includes(step.action) && (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Label
                            className="shrink-0"
                            htmlFor={`rule-local-folder-${index}`}
                          >
                            {t("Local folder")}
                          </Label>
                          <Input
                            id={`rule-local-folder-${index}`}
                            className="min-w-0 flex-1"
                            required
                            placeholder={t("For example: Projects / Design")}
                            value={step.destination}
                            onChange={(event) =>
                              setEditing(
                                withActions(
                                  editing,
                                  ruleActions(editing).map((item, position) =>
                                    position === index
                                      ? {
                                          ...item,
                                          destination: event.target.value,
                                        }
                                      : item,
                                  ),
                                ),
                              )
                            }
                          />
                        </div>
                      )}
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={t("Move action up")}
                          disabled={index === 0}
                          onClick={() => {
                            const next = [...ruleActions(editing)];
                            [next[index - 1], next[index]] = [
                              next[index],
                              next[index - 1],
                            ];
                            setEditing(withActions(editing, next));
                          }}
                        >
                          <ArrowUp size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={t("Move action down")}
                          disabled={index === ruleActions(editing).length - 1}
                          onClick={() => {
                            const next = [...ruleActions(editing)];
                            [next[index + 1], next[index]] = [
                              next[index],
                              next[index + 1],
                            ];
                            setEditing(withActions(editing, next));
                          }}
                        >
                          <ArrowDown size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          title={t("Remove action")}
                          disabled={ruleActions(editing).length === 1}
                          onClick={() =>
                            setEditing(
                              withActions(
                                editing,
                                ruleActions(editing).filter(
                                  (_, position) => position !== index,
                                ),
                              ),
                            )
                          }
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                    {["serverCopy", "serverMove"].includes(step.action) && (
                      <RuleServerFolders
                        rule={{
                          ...editing,
                          action: step.action,
                          destination: step.destination,
                          sourceFolder: step.sourceFolder,
                        }}
                        account={data.accounts.find(
                          (a) => a.id === editing.accountId,
                        )}
                        onChange={(changed) =>
                          setEditing(
                            withActions(
                              editing,
                              ruleActions(editing).map((item, position) =>
                                position === index
                                  ? {
                                      ...item,
                                      destination: changed.destination,
                                      sourceFolder: changed.sourceFolder || "",
                                    }
                                  : item,
                              ),
                            ),
                          )
                        }
                      />
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={ruleActions(editing).length >= 8}
                  onClick={() =>
                    setEditing(
                      withActions(editing, [
                        ...ruleActions(editing),
                        { action: "read", destination: "", sourceFolder: "" },
                      ]),
                    )
                  }
                >
                  <Plus size={14} />
                  {t("Add action")}
                </Button>
              </div>
              <Label className="switch-label">
                <Switch
                  checked={editing.stop}
                  onCheckedChange={(v) => setEditing({ ...editing, stop: v })}
                />
                {t("Stop processing later rules after a match")}
              </Label>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    setPreview(
                      await call<string[]>("preview_rule", { rule: editing }),
                    );
                  } catch (e) {
                    toast.error(String(e));
                  }
                }}
              >
                {t("Preview matches without running actions")}
              </Button>
              {preview && (
                <div className="rule-preview">
                  {t("This preview: {value0} matches{value1}.", {
                    value0: preview.length - waitingPreview,
                    value1:
                      waitingPreview > 0
                        ? `，另有 ${waitingPreview} 项等待完整邮件核对后确认`
                        : "",
                  })}
                  {preview.slice(0, 3).map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                </div>
              )}
              <div className="dialog-actions">
                {data.rules.some((r) => r.id === editing.id) && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive mr-auto"
                    onClick={async () => {
                      if (
                        await save(
                          data.rules.filter((r) => r.id !== editing.id),
                        )
                      )
                        setEditing(null);
                    }}
                  >
                    {t("Delete rule")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  {t("Cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={
                    remote(editing) &&
                    (!editing.accountId ||
                      !editing.sourceFolder ||
                      !editing.destination ||
                      !data.accounts.some(
                        (a) =>
                          a.id === editing.accountId &&
                          a.enabled &&
                          a.protocol === "imap" &&
                          a.provider !== "gmail",
                      ))
                  }
                >
                  {t("Save rule")}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
