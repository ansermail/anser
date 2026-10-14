import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { call } from "@/lib/api";
import type { NetworkProxy, Preferences } from "@/lib/types";

const emptyProxy: NetworkProxy = {
  name: "本地代理",
  kind: "socks5",
  host: "127.0.0.1",
  port: 7890,
  username: "",
  directOnFailure: false,
};

export function NetworkProxySettings() {
  const [proxy, setProxy] = useState<NetworkProxy | null>(null);
  const [draft, setDraft] = useState<NetworkProxy>(emptyProxy);
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void call<Preferences>("get_preferences")
      .then((value) => {
        if (active) {
          setProxy(value.proxy || null);
          setReady(true);
        }
      })
      .catch((error) => toast.error(String(error)));
    return () => {
      active = false;
    };
  }, []);

  async function save(next: NetworkProxy | null, nextPassword = "") {
    setBusy(true);
    try {
      await call("save_network_proxy", { proxy: next, password: nextPassword });
      setProxy(next);
      setOpen(false);
      setPassword("");
      toast.success(next ? "网络代理已保存，新连接立即使用" : "网络代理已关闭");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>网络代理</CardTitle>
          <CardDescription>
            所有邮箱的收信、发信和 OAuth
            令牌请求使用同一代理。是否转发目标地址由代理软件决定。
          </CardDescription>
          <CardAction>
            <Switch
              aria-label="启用网络代理"
              checked={!!proxy}
              disabled={!ready || busy}
              onCheckedChange={(enabled) => {
                if (enabled) {
                  setDraft(proxy || emptyProxy);
                  setOpen(true);
                } else {
                  void save(null);
                }
              }}
            />
          </CardAction>
        </CardHeader>
        {proxy && (
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm">
              {proxy.name} · {proxy.kind.toUpperCase()} · {proxy.host}:
              {proxy.port}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(proxy);
                setPassword("");
                setOpen(true);
              }}
            >
              编辑代理
            </Button>
          </CardContent>
        )}
      </Card>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑代理</DialogTitle>
            <DialogDescription>
              填写代理软件提供的本地地址和端口。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !draft.name.trim() ||
                !draft.host.trim() ||
                draft.port < 1 ||
                draft.port > 65535
              ) {
                toast.error("请填写有效的名称、服务器地址和端口");
                return;
              }
              void save(draft, password);
            }}
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="proxy-name">名称</FieldLabel>
                <Input
                  id="proxy-name"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel>类型</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={draft.kind}
                  onValueChange={(kind) => {
                    if (kind)
                      setDraft({
                        ...draft,
                        kind: kind as NetworkProxy["kind"],
                      });
                  }}
                  aria-label="代理类型"
                >
                  <ToggleGroupItem value="socks5">SOCKS5</ToggleGroupItem>
                  <ToggleGroupItem value="http">HTTP</ToggleGroupItem>
                  <ToggleGroupItem value="https">HTTPS</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-host">服务器地址</FieldLabel>
                <Input
                  id="proxy-host"
                  value={draft.host}
                  onChange={(event) =>
                    setDraft({ ...draft, host: event.target.value })
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-port">端口</FieldLabel>
                <Input
                  id="proxy-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.port}
                  onChange={(event) =>
                    setDraft({ ...draft, port: Number(event.target.value) })
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-username">用户名（可选）</FieldLabel>
                <Input
                  id="proxy-username"
                  autoComplete="off"
                  value={draft.username}
                  onChange={(event) =>
                    setDraft({ ...draft, username: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-password">密码（可选）</FieldLabel>
                <Input
                  id="proxy-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={proxy ? "留空保持原密码" : ""}
                />
                <FieldDescription>密码仅保存在本机钥匙串中。</FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Switch
                  id="proxy-fallback"
                  checked={draft.directOnFailure}
                  onCheckedChange={(checked) =>
                    setDraft({ ...draft, directOnFailure: checked })
                  }
                />
                <FieldLabel htmlFor="proxy-fallback">
                  代理连接失败时直连
                </FieldLabel>
              </Field>
              <FieldDescription>
                仅在连接代理或建立隧道失败前回退；邮件发送结果不明时不会自动重发。
              </FieldDescription>
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
