import { t } from "@/lib/i18n";
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
  get name() {
    return t("Local proxy");
  },
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
      toast.success(
        next
          ? t("Proxy saved. New connections use it immediately.")
          : t("Proxy disabled"),
      );
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
          <CardTitle>{t("Network proxy")}</CardTitle>
          <CardDescription>
            {t(
              "All accounts use the same proxy for incoming/outgoing mail, body resources, model translation and OAuth tokens. Your proxy software decides which destinations to forward.",
            )}
          </CardDescription>
          <CardAction>
            <Switch
              aria-label={t("Enable network proxy")}
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
              {t("Edit proxy")}
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
            <DialogTitle>{t("Edit proxy")}</DialogTitle>
            <DialogDescription>
              {t(
                "Enter the local address and port provided by your proxy software.",
              )}
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
                toast.error(t("Enter a valid name, server address and port"));
                return;
              }
              void save(draft, password);
            }}
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="proxy-name">{t("Proxy name")}</FieldLabel>
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
                <FieldLabel>{t("Type")}</FieldLabel>
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
                  aria-label={t("Proxy type")}
                >
                  <ToggleGroupItem value="socks5">SOCKS5</ToggleGroupItem>
                  <ToggleGroupItem value="http">HTTP</ToggleGroupItem>
                  <ToggleGroupItem value="https">HTTPS</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel htmlFor="proxy-host">
                  {t("Server address")}
                </FieldLabel>
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
                <FieldLabel htmlFor="proxy-port">{t("Port")}</FieldLabel>
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
                <FieldLabel htmlFor="proxy-username">
                  {t("Username (optional)")}
                </FieldLabel>
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
                <FieldLabel htmlFor="proxy-password">
                  {t("Password (optional)")}
                </FieldLabel>
                <Input
                  id="proxy-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={
                    proxy ? t("Leave blank to keep the current password") : ""
                  }
                />
                <FieldDescription>
                  {t("Passwords are stored only in local Keychain.")}
                </FieldDescription>
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
                  {t("Connect directly if proxy connection fails")}
                </FieldLabel>
              </Field>
              <FieldDescription>
                {t(
                  "Fallback is limited to proxy connection or tunnel setup failures. Messages with an uncertain send result are never resent automatically.",
                )}
              </FieldDescription>
            </FieldGroup>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? t("Saving…") : t("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
