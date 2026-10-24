import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Copy,
  Folder,
  FolderInput,
  MailWarning,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type { FolderSettings, Mail, RemoteFolder } from "@/lib/types";
import { directoryShortcuts, directorySource } from "@/lib/server-destinations";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Alert, AlertDescription } from "./ui/alert";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

export function ServerDirectoryMenu({
  mail,
  kind,
  view,
  remoteFolder,
  disabled,
}: {
  mail: Mail;
  kind: "copy" | "move";
  view: string;
  remoteFolder?: string;
  disabled?: boolean;
}) {
  const verb = kind === "move" ? t("Move") : t("Copy");
  const Icon = kind === "move" ? FolderInput : Copy;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  const [folders, setFolders] = useState<RemoteFolder[]>([]);
  const epoch = useRef(0);
  const submitting = useRef(false);
  const context = `${mail.id}:${mail.accountId}:${view}:${remoteFolder || ""}:${kind}`;
  const current = useRef(context);
  current.current = context;
  useEffect(() => {
    epoch.current++;
    setOpen(false);
    setSource("");
    setFolders([]);
    setError("");
    return () => {
      epoch.current++;
    };
  }, [context]);

  async function load() {
    const generation = ++epoch.current;
    setLoading(true);
    setSource("");
    setFolders([]);
    setError("");
    try {
      const [sources, discovered] = await Promise.all([
        call<string[]>("copy_sources", { id: mail.id }),
        call<FolderSettings>("folder_settings", { id: mail.accountId }).then(
          (settings) =>
            settings.folders.length
              ? settings.folders
              : call<RemoteFolder[]>("account_folders", { id: mail.accountId }),
        ),
      ]);
      if (generation !== epoch.current) return;
      const owned = discovered.filter((f) => f.accountId === mail.accountId);
      const selected = directorySource(
        mail,
        sources,
        owned,
        view,
        remoteFolder,
      );
      setFolders(owned);
      setSource(selected);
    } catch (e) {
      if (generation === epoch.current) setError(String(e));
    } finally {
      if (generation === epoch.current) setLoading(false);
    }
  }
  const targets = folders.filter(
    (f) =>
      f.selectable &&
      !f.syncError &&
      f.name.toLowerCase() !== source.toLowerCase(),
  );
  const shortcuts =
    kind === "move" && source ? directoryShortcuts(folders, source) : [];
  const specialNames = new Set(
    shortcuts.filter((s) => !s.reason).map((s) => s.folder!.name),
  );
  async function submit(target: string) {
    if (
      !source ||
      loading ||
      submitting.current ||
      !targets.some((f) => f.name === target)
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const key = context;
    const generation = epoch.current;
    try {
      await call(kind === "move" ? "queue_server_move" : "queue_server_copy", {
        id: mail.id,
        source,
        target,
      });
      if (current.current === key && generation === epoch.current) {
        toast.success(
          t("{value0} task recorded. View the result in Settings.", {
            value0: verb,
          }),
        );
        setOpen(false);
      }
    } catch (e) {
      if (current.current === key && generation === epoch.current)
        setError(String(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (submitting.current) return;
        setOpen(next);
        if (next) void load();
        else epoch.current++;
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled || busy || mail.sourceFolder === ""}
          title={t("{value0} to server folder", { value0: verb })}
          aria-label={t("{value0} to server folder", { value0: verb })}
        >
          <Icon data-icon="inline-start" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72"
        aria-label={t("{value0} destination folder", { value0: verb })}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t("{value0} to", { value0: verb })}
          </DropdownMenuLabel>
          {source && (
            <DropdownMenuLabel className="whitespace-normal break-words">
              {t("From {value0}", {
                value0:
                  folders.find((f) => f.name === source)?.displayName || source,
              })}
            </DropdownMenuLabel>
          )}
        </DropdownMenuGroup>
        {loading && (
          <Skeleton className="h-20" aria-label={t("Loading server folders")} />
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {source && (
          <>
            {shortcuts.length > 0 && (
              <>
                <DropdownMenuGroup>
                  {shortcuts.map((s) => {
                    const ShortcutIcon =
                      s.role === "archive"
                        ? Archive
                        : s.role === "junk"
                          ? MailWarning
                          : Trash2;
                    return (
                      <DropdownMenuItem
                        key={s.role}
                        disabled={busy || !!s.reason}
                        onSelect={(event) => {
                          event.preventDefault();
                          void submit(s.folder!.name);
                        }}
                      >
                        <ShortcutIcon />
                        <span className="flex flex-col gap-1">
                          {s.label}
                          {s.reason && <span>{s.reason}</span>}
                        </span>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              {targets
                .filter((f) => !specialNames.has(f.name))
                .map((f) => (
                  <DropdownMenuItem
                    key={f.name}
                    disabled={busy}
                    onSelect={(event) => {
                      event.preventDefault();
                      void submit(f.name);
                    }}
                  >
                    <Folder />
                    <span className="whitespace-normal break-words">
                      {f.displayName}
                    </span>
                  </DropdownMenuItem>
                ))}
              {!targets.length && (
                <DropdownMenuItem disabled>
                  {t("No available destination folders")}
                </DropdownMenuItem>
              )}
              {busy && (
                <DropdownMenuItem disabled>{t("Recording…")}</DropdownMenuItem>
              )}
            </DropdownMenuGroup>
          </>
        )}
        {!loading && error && !source && (
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                void load();
              }}
            >
              {t("Reload folders")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
