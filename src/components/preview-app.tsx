import { useMemo, useState } from "react";
import {
  Archive,
  Github,
  Inbox,
  Mail,
  Moon,
  Search,
  Send,
  SlidersHorizontal,
  SquarePen,
  Star,
  Sun,
} from "lucide-react";
import { makeDemo } from "@/lib/demo";
import { senderName, formatSize } from "@/lib/providers";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { SidebarProvider } from "./ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";
import { NavigationLayout, MailLayout } from "./resizable-layout";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Separator } from "./ui/separator";
const examples = makeDemo();
// The static preview imports no desktop API, credentials, persistence or SMTP code.
export default function PreviewApp() {
  const [selected, setSelected] = useState(examples.messages[0]),
    [search, setSearch] = useState(""),
    [view, setView] = useState("all"),
    [dark, setDark] = useState(false);
  const messages = useMemo(
    () =>
      examples.messages.filter(
        (m) =>
          (view !== "starred" || m.starred) &&
          `${m.subject} ${m.sender} ${m.body}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [search, view],
  );
  function theme() {
    document.documentElement.classList.toggle("dark", !dark);
    setDark(!dark);
  }
  return (
    <TooltipProvider>
      <SidebarProvider className="app-shell preview-shell" open>
        <div className="top-actions app-actions">
          <Badge variant="secondary">页面预览 · 虚构数据</Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="切换预览主题"
            onClick={theme}
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
        <NavigationLayout
          open
          expanded={false}
          sidebar={
            <aside className="preview-sidebar flex h-full flex-col gap-6 p-6">
              <div className="flex items-center gap-3">
                <img
                  src={`${import.meta.env.BASE_URL}app-icon.png`}
                  width="40"
                  height="40"
                  alt="Anser 雁信"
                />
                <div>
                  <h1 className="font-semibold">雁信</h1>
                  <p className="text-sm text-muted-foreground">
                    邮件，自在有序
                  </p>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button disabled>
                    <SquarePen data-icon="inline-start" />
                    写邮件
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  网页仅预览界面，请下载桌面应用收发邮件。
                </TooltipContent>
              </Tooltip>
              <div className="flex flex-col gap-2">
                <Button
                  variant={view === "all" ? "secondary" : "ghost"}
                  onClick={() => setView("all")}
                >
                  <Inbox data-icon="inline-start" />
                  全部收件箱
                </Button>
                <Button
                  variant={view === "starred" ? "secondary" : "ghost"}
                  onClick={() => setView("starred")}
                >
                  <Star data-icon="inline-start" />
                  星标邮件
                </Button>
                <Button variant="ghost" disabled>
                  <Send data-icon="inline-start" />
                  已发送
                </Button>
              </div>
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">虚构账号</p>
                {examples.accounts.map((a) => (
                  <div key={a.id}>
                    <p className="text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground break-all">
                      {a.email}
                    </p>
                  </div>
                ))}
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>本地留存</CardTitle>
                  <CardDescription>完整正文与附件妥善保存</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">
                    {examples.messages.length} 封示例 ·{" "}
                    {formatSize(examples.stats.bytes)}
                  </p>
                </CardContent>
              </Card>
              <div className="mt-auto flex flex-col gap-2">
                <Button asChild>
                  <a
                    href="https://github.com/ansermail/anser/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Archive data-icon="inline-start" />
                    下载 Anser
                  </a>
                </Button>
                <Button variant="ghost" asChild>
                  <a
                    href="https://github.com/ansermail/anser"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github data-icon="inline-start" />
                    项目仓库
                  </a>
                </Button>
              </div>
            </aside>
          }
        >
          <MailLayout
            expanded={false}
            list={
              <section className="flex h-full flex-col">
                <div className="flex flex-col gap-4 p-6">
                  <h2 className="text-lg font-semibold">
                    {view === "starred" ? "星标邮件" : "全部收件箱"}
                  </h2>
                  <div className="flex items-center gap-2">
                    <Search className="size-4 text-muted-foreground" />
                    <Input
                      aria-label="搜索示例邮件"
                      placeholder="搜索示例邮件…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled
                      aria-label="示例筛选"
                    >
                      <SlidersHorizontal />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    可以选择邮件、搜索和调整分栏。预览不连接邮箱、不保存邮件或发送消息。
                  </p>
                </div>
                <Separator />
                <div className="min-h-0 overflow-y-auto flex flex-col">
                  {messages.map((m) => (
                    <Button
                      key={m.id}
                      variant={m.id === selected.id ? "secondary" : "ghost"}
                      className="h-auto min-w-0 justify-start rounded-none px-6 py-5 text-left"
                      onClick={() => setSelected(m)}
                    >
                      <div className="min-w-0 flex flex-col gap-2">
                        <span className="font-semibold truncate">
                          {senderName(m.sender)}
                        </span>
                        <span className="truncate font-normal">
                          {m.subject}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {m.preview}
                        </span>
                      </div>
                    </Button>
                  ))}
                  {!messages.length && (
                    <p className="p-6 text-sm text-muted-foreground">
                      没有匹配的示例邮件
                    </p>
                  )}
                </div>
              </section>
            }
          >
            <article className="flex h-full min-w-0 flex-col">
              <header className="p-6 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Mail className="size-5" />
                  <h2 className="font-semibold">
                    {senderName(selected.sender)}
                  </h2>
                  <Badge variant="outline">示例</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selected.sender}
                </p>
                <h3 className="text-lg font-semibold">{selected.subject}</h3>
              </header>
              <Separator />
              <div className="p-8 whitespace-pre-wrap leading-relaxed min-h-0 overflow-y-auto">
                {selected.body}
              </div>
            </article>
          </MailLayout>
        </NavigationLayout>
      </SidebarProvider>
    </TooltipProvider>
  );
}
