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
    return t("发件人");
  },
  get recipients() {
    return t("收件人");
  },
  get cc() {
    return t("抄送");
  },
  get recipientsOrCc() {
    return t("收件人或抄送");
  },
  get subject() {
    return t("主题");
  },
  get body() {
    return t("正文");
  },
  get attachment() {
    return t("有附件");
  },
  get read() {
    return t("已读状态");
  },
  get starred() {
    return t("星标状态");
  },
  get priority() {
    return t("优先级");
  },
  get date() {
    return t("邮件日期");
  },
  get ageDays() {
    return t("已接收天数");
  },
  get sizeKb() {
    return t("邮件大小（KB）");
  },
};
const choiceConditions: Record<string, [string, string][]> = {
  attachment: [
    ["true", "有附件"],
    ["false", "无附件"],
  ],
  read: [
    ["true", "已读"],
    ["false", "未读"],
  ],
  starred: [
    ["true", "有星标"],
    ["false", "无星标"],
  ],
  priority: [
    ["high", "高"],
    ["normal", "普通"],
    ["low", "低"],
  ],
};
const conditionValueLabel = (c: Condition) =>
  t(
    choiceConditions[c.field]?.find(([value]) => value === c.value)?.[1] ?? "",
  ) || `「${c.value}」`;
const conditionOperators: Record<string, string> = {
  get contains() {
    return t("包含");
  },
  get notContains() {
    return t("不包含");
  },
  get equals() {
    return t("等于");
  },
  get startsWith() {
    return t("以此开头");
  },
  get endsWith() {
    return t("以此结尾");
  },
  get before() {
    return t("早于");
  },
  get after() {
    return t("晚于");
  },
  get greaterThan() {
    return t("大于");
  },
  get lessThan() {
    return t("小于");
  },
};
const actions: { [key: string]: string } = {
  get folder() {
    return t("归入本地文件夹");
  },
  get save() {
    return t("完整保存到本地");
  },
  get saveFolder() {
    return t("完整保存并归入本地文件夹");
  },
  get read() {
    return t("标记为已读");
  },
  get unread() {
    return t("标记为未读");
  },
  get star() {
    return t("添加星标");
  },
  get trash() {
    return t("移到本地废纸篓");
  },
  get serverCopy() {
    return t("复制到服务器文件夹");
  },
  get serverMove() {
    return t("移动到服务器文件夹");
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
          aria-label={t("条件日期")}
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
              : t("选择日期")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0"
        aria-label={t("选择条件日期")}
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
    (path === "INBOX" ? t("收件箱") : fallback);
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
          "已执行或安排 {value0} 项规则动作；异步结果见规则处理任务和执行记录",
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
              title={t("切换侧边栏")}
              aria-label={t("切换侧边栏")}
            />
            <h1>{t("让邮件，自动归位")}</h1>
          </div>
          <p>{t("设置一次规则，把更多时间留给重要的事。")}</p>
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
          {t("新建规则")}
        </Button>
      </div>
      <div className="info-strip">
        <SlidersHorizontal size={17} />
        <span>
          {t(
            "规则按顺序执行。本地归类保留原件；已有服务器动作仍按原规则运行。",
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={run}
          disabled={busy || !data.rules.length}
        >
          <Play size={14} />
          {busy ? t("执行中…") : t("对已有邮件执行")}
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
                {r.stop && <span>{t("命中后停止")}</span>}
              </div>
              <p>
                {r.conditions
                  .map(
                    (c) =>
                      `${fields[c.field]} ${conditionOperators[c.operator] || c.operator}${conditionValueLabel(c)}`,
                  )
                  .join(r.mode === "all" ? t(" 且 ") : t(" 或 "))}
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
                aria-label={t("启用 {value0}", { value0: r.name })}
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
                title={t("上移")}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("下移")}
                disabled={i === data.rules.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("编辑规则")}
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
            <h3>{t("收件箱有自己的秩序")}</h3>
            <p>{t("试着把项目往来或账单自动归入一个本地文件夹。")}</p>
          </div>
        )}
      </div>
      <div className="quiet-note">
        {t(
          "无需保持邮箱网页打开。雁信在这台 Mac 上运行时，会自动处理新收到的邮件。",
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
            <DialogTitle>{t("编辑过滤规则")}</DialogTitle>
            <DialogDescription>
              {t("按账号和条件设置处理动作，预览后保存。")}
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
                  toast.success(t("规则已保存"));
                }
              }}
            >
              <div className="field">
                <Label>{t("规则名称")}</Label>
                <Input
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder={t("例如：项目邮件自动归类")}
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <Label>{t("适用账号")}</Label>
                  <SelectField
                    value={editing.accountId}
                    aria-label={t("规则适用账号")}
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
                        {t("全部账号")}
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
                  <Label>{t("匹配方式")}</Label>
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
                        {t("满足全部条件")}
                      </SelectOption>
                      <SelectOption value="any">
                        {t("满足任一条件")}
                      </SelectOption>
                    </SelectGroup>
                  </SelectField>
                </div>
              </div>
              <div className="conditions">
                {editing.conditions.map((c, i) => (
                  <div className="condition" key={i}>
                    <SelectField
                      aria-label={t("条件字段")}
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
                            {t(v)}
                          </SelectOption>
                        ))}
                      </SelectGroup>
                    </SelectField>
                    <SelectField
                      aria-label={t("条件比较")}
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
                              ["before", t("早于")],
                              ["after", t("晚于")],
                            ]
                          : choiceConditions[c.field]
                            ? [["equals", t("等于")]]
                            : c.field === "ageDays"
                              ? [
                                  ["greaterThan", t("大于")],
                                  ["lessThan", t("小于")],
                                  ["equals", t("等于")],
                                ]
                              : c.field === "sizeKb"
                                ? [
                                    ["greaterThan", t("大于")],
                                    ["lessThan", t("小于")],
                                    ["equals", t("等于")],
                                  ]
                                : [
                                    ["contains", t("包含")],
                                    ["equals", t("等于")],
                                    ["notContains", t("不包含")],
                                    ["startsWith", t("以此开头")],
                                    ["endsWith", t("以此结尾")],
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
                        aria-label={t("条件值")}
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
                              {v}
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
                        aria-label={t("条件值")}
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
                            ? t("整数 KB")
                            : c.field === "ageDays"
                              ? t("天数")
                              : c.field === "cc"
                                ? t("例如：抄送地址或关键词")
                                : c.field === "recipientsOrCc"
                                  ? t("收件人或抄送地址")
                                  : t("关键词")
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
                      title={t("移除条件")}
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
                {t("添加条件")}
              </Button>
              <div className="field">
                <Label>{t("依次执行动作")}</Label>
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
                            ? t("规则执行动作")
                            : t("规则执行动作 {value0}", { value0: index + 1 })
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
                            {t("本地文件夹")}
                          </Label>
                          <Input
                            id={`rule-local-folder-${index}`}
                            className="min-w-0 flex-1"
                            required
                            placeholder={t("例如：项目 / 设计")}
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
                          title={t("上移动作")}
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
                          title={t("下移动作")}
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
                          title={t("移除动作")}
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
                  {t("添加动作")}
                </Button>
              </div>
              <Label className="switch-label">
                <Switch
                  checked={editing.stop}
                  onCheckedChange={(v) => setEditing({ ...editing, stop: v })}
                />
                {t("命中后停止执行后续规则")}
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
                {t("预览匹配，不执行动作")}
              </Button>
              {preview && (
                <div className="rule-preview">
                  {t("本次预览 {value0} 项匹配{value1}。", {
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
                    {t("删除规则")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  {t("取消")}
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
                  {t("保存规则")}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
