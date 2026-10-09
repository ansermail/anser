import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useState } from "react";
import {
  Plus,
  ArrowDown,
  ArrowUp,
  ArrowRight,
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
import { Switch } from "./ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import type { Rule, Snapshot, FolderSettings } from "@/lib/types";
import { call } from "@/lib/api";
import { toast } from "sonner";
import { SelectGroup } from "./ui/select";
import { RuleServerFolders } from "./rule-server-folders";
import { RuleExecutions } from "./rule-executions";
import { RuleRunsPanel } from "./rule-runs";

const fields: { [key: string]: string } = {
  sender: "发件人",
  recipients: "收件人",
  subject: "主题",
  body: "正文",
  attachment: "有附件",
  date: "邮件日期",
};
const actions: { [key: string]: string } = {
  folder: "归入本地文件夹",
  save: "完整保存到本地",
  saveFolder: "完整保存并归入本地文件夹",
  read: "标记为已读",
  unread: "标记为未读",
  star: "添加星标",
  trash: "移到本地废纸篓",
  serverCopy: "复制到服务器文件夹",
  serverMove: "移动到服务器文件夹",
};
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
  const remote = (r: Rule) => ["serverCopy", "serverMove"].includes(r.action);
  const [folderNames, setFolderNames] = useState<
    Record<string, Record<string, string>>
  >({});
  const remoteAccounts = [
    ...new Set(data.rules.filter(remote).map((r) => r.accountId)),
  ]
    .sort()
    .join(",");
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
    (path === "INBOX" ? "收件箱" : fallback);
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
        `已处理或安排 ${n} 项规则；异步结果见规则处理任务和执行记录`,
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
            <SidebarTrigger title="切换侧边栏" aria-label="切换侧边栏" />
            <h1>让邮件，自动归位</h1>
          </div>
          <p>设置一次规则，把更多时间留给重要的事。</p>
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
              stop: true,
            });
          }}
        >
          <Plus size={16} />
          新建规则
        </Button>
      </div>
      <div className="info-strip">
        <SlidersHorizontal size={17} />
        <span>
          规则按顺序执行。本地归类保留原件；服务器复制和移动会创建独立任务。
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={run}
          disabled={busy || !data.rules.length}
        >
          <Play size={14} />
          {busy ? "执行中…" : "对已有邮件执行"}
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
                {r.stop && <span>命中后停止</span>}
              </div>
              <p>
                {r.conditions
                  .map(
                    (c) =>
                      `${fields[c.field]} ${c.operator === "equals" ? "等于" : c.operator === "notContains" ? "不包含" : c.operator === "before" ? "早于" : c.operator === "after" ? "晚于" : "包含"}「${c.value}」`,
                  )
                  .join(r.mode === "all" ? " 且 " : " 或 ")}
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
                {actions[r.action]}{" "}
                {["folder", "saveFolder"].includes(r.action) && (
                  <strong>{r.destination}</strong>
                )}
              </div>
            </div>
            <div className="rule-controls">
              <Switch
                checked={r.enabled}
                aria-label={`启用 ${r.name}`}
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
                title="上移"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="下移"
                disabled={i === data.rules.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="编辑规则"
                onClick={() => {
                  setPreview(null);
                  setEditing(structuredClone(r));
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
            <h3>收件箱有自己的秩序</h3>
            <p>试着把项目往来或账单自动归入一个本地文件夹。</p>
          </div>
        )}
      </div>
      <div className="quiet-note">
        无需保持邮箱网页打开。雁信在这台 Mac 上运行时，会自动处理新收到的邮件。
      </div>
      <RuleExecutions onShowTasks={onShowTasks} />
      <RuleRunsPanel onShowTasks={onShowTasks} />
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>编辑过滤规则</DialogTitle>
            <DialogDescription>
              按账号和条件设置本地整理或服务器文件夹动作，预览后保存。
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
                  toast.success("规则已保存");
                }
              }}
            >
              <div className="field">
                <Label>规则名称</Label>
                <Input
                  required
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="例如：项目邮件自动归类"
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <Label>适用账号</Label>
                  <SelectField
                    value={editing.accountId}
                    aria-label="规则适用账号"
                    onValueChange={(value) =>
                      setEditing({
                        ...editing,
                        accountId: value,
                        ...(remote(editing)
                          ? { sourceFolder: "", destination: "" }
                          : {}),
                      })
                    }
                  >
                    <SelectGroup>
                      <SelectOption value="" disabled={remote(editing)}>
                        全部账号
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
                  <Label>匹配方式</Label>
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
                      <SelectOption value="all">满足全部条件</SelectOption>
                      <SelectOption value="any">满足任一条件</SelectOption>
                    </SelectGroup>
                  </SelectField>
                </div>
              </div>
              <div className="conditions">
                {editing.conditions.map((c, i) => (
                  <div className="condition" key={i}>
                    <SelectField
                      aria-label="条件字段"
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
                                      : value === "attachment"
                                        ? "equals"
                                        : "contains",
                                  value: value === "attachment" ? "true" : "",
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
                      aria-label="条件比较"
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
                              ["before", "早于"],
                              ["after", "晚于"],
                            ]
                          : c.field === "attachment"
                            ? [["equals", "等于"]]
                            : [
                                ["contains", "包含"],
                                ["equals", "等于"],
                                ["notContains", "不包含"],
                              ]
                        ).map(([k, v]) => (
                          <SelectOption key={k} value={k}>
                            {v}
                          </SelectOption>
                        ))}
                      </SelectGroup>
                    </SelectField>
                    <Input
                      aria-label="条件值"
                      required
                      type={c.field === "date" ? "date" : "text"}
                      placeholder={
                        c.field === "attachment" ? "true / false" : "关键词"
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={editing.conditions.length === 1}
                      title="移除条件"
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
                添加条件
              </Button>
              <div className="field">
                <Label>执行动作</Label>
                <SelectField
                  aria-label="规则执行动作"
                  value={editing.action}
                  onValueChange={(value) =>
                    setEditing({
                      ...editing,
                      action: value,
                      destination: "",
                      sourceFolder: "",
                    })
                  }
                >
                  <SelectGroup>
                    {Object.entries(actions).map(([k, v]) => (
                      <SelectOption key={k} value={k}>
                        {v}
                      </SelectOption>
                    ))}
                  </SelectGroup>
                </SelectField>
              </div>
              {remote(editing) && (
                <RuleServerFolders
                  rule={editing}
                  account={data.accounts.find(
                    (a) => a.id === editing.accountId,
                  )}
                  onChange={setEditing}
                />
              )}
              {["folder", "saveFolder"].includes(editing.action) && (
                <div className="field">
                  <Label>本地文件夹</Label>
                  <Input
                    required
                    placeholder="例如：项目 / 设计"
                    value={editing.destination}
                    onChange={(e) =>
                      setEditing({ ...editing, destination: e.target.value })
                    }
                  />
                </div>
              )}
              <Label className="switch-label">
                <Switch
                  checked={editing.stop}
                  onCheckedChange={(v) => setEditing({ ...editing, stop: v })}
                />
                命中后停止执行后续规则
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
                预览匹配，不执行动作
              </Button>
              {preview && (
                <div className="rule-preview">
                  本次预览 {preview.length}{" "}
                  项；标注“等待正文核对”的条目尚未确认匹配。
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
                    删除规则
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  取消
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
                  保存规则
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
