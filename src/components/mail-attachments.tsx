import { useState } from "react";
import {
  ArrowDownToLine,
  FileArchive,
  FileImage,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { call, native } from "../lib/api";
import { formatSize } from "../lib/providers";
import type { Detail } from "../lib/types";

export function MailAttachments({
  mailId,
  demo = false,
  attachments,
  onDownload,
}: {
  mailId: string;
  demo?: boolean;
  attachments: Detail["attachments"];
  onDownload: (index: number, name: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<
    Record<number, "preview" | "download">
  >({});
  async function act(
    index: number,
    name: string,
    action: "preview" | "download",
  ) {
    if (pending[index]) return;
    if (action === "preview" && (!native || demo)) {
      toast.info("请在桌面客户端中使用本地应用预览真实附件");
      return;
    }
    setPending((p) => ({ ...p, [index]: action }));
    try {
      if (action === "preview")
        await call("preview_attachment", { id: mailId, index });
      else await onDownload(index, name);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[index];
        return next;
      });
    }
  }
  if (!attachments.length) return null;
  return (
    <div className="attachment-list" aria-label="邮件附件">
      {attachments.map((attachment) => {
        const Icon = attachment.mime.startsWith("image/")
          ? FileImage
          : /zip|compressed|tar/.test(attachment.mime)
            ? FileArchive
            : FileText;
        const busy = pending[attachment.index];
        const disabled = !!attachment.error || !!busy;
        return (
          <Card
            className="mail-attachment"
            key={attachment.index}
            aria-busy={!!busy}
          >
            <Button
              variant="ghost"
              className="attachment-preview"
              title={attachment.error || `使用默认应用打开 ${attachment.name}`}
              disabled={disabled}
              aria-label={`预览附件 ${attachment.name}`}
              onClick={() =>
                void act(attachment.index, attachment.name, "preview")
              }
            >
              <Icon className="attachment-type size-5" />
              <span className="attachment-info">
                <strong>{attachment.name}</strong>
                {busy ? (
                  <span className="attachment-progress" role="status">
                    <Skeleton className="h-2 w-6" />
                    <small>
                      {busy === "preview" ? "正在打开…" : "正在保存…"}
                    </small>
                  </span>
                ) : (
                  <small>
                    {attachment.error
                      ? "附件编码异常"
                      : `${formatSize(attachment.size)} · 点击预览`}
                  </small>
                )}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="attachment-download"
              title={attachment.error || "另存附件"}
              disabled={disabled}
              aria-label={`下载附件 ${attachment.name}`}
              onClick={() =>
                void act(attachment.index, attachment.name, "download")
              }
            >
              <ArrowDownToLine className="size-4" />
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
