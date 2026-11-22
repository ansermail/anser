import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  FileArchive,
  FileImage,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { call, native } from "../lib/api";
import { formatSize } from "../lib/providers";
import type { Detail } from "../lib/types";

const THUMBNAIL_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const MAX_THUMBNAIL_SOURCE_BYTES = 20 * 1024 * 1024;

export function MailAttachmentNotice({ reported }: { reported: boolean }) {
  if (!reported) return null;
  return (
    <Alert className="mail-attachment-notice">
      <FileText />
      <AlertDescription>
        {t(
          "This message reports attachments, but no separate files are available. Inline images appear in the message body.",
        )}
      </AlertDescription>
    </Alert>
  );
}

function AttachmentThumbnail({
  mailId,
  demo,
  attachment,
  Icon,
}: {
  mailId: string;
  demo: boolean;
  attachment: Detail["attachments"][number];
  Icon: typeof FileImage;
}) {
  const [thumbnail, setThumbnail] = useState("");
  const canLoadThumbnail =
    native &&
    !demo &&
    !attachment.error &&
    THUMBNAIL_MIMES.has(attachment.mime) &&
    attachment.size <= MAX_THUMBNAIL_SOURCE_BYTES;

  useEffect(() => {
    if (!canLoadThumbnail) return;
    let active = true;
    void call<string>("attachment_thumbnail", {
      id: mailId,
      index: attachment.index,
    })
      .then((value) => {
        if (active && value.startsWith("data:image/png;base64,")) {
          setThumbnail(value);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [attachment.index, canLoadThumbnail, mailId]);

  return (
    <span className="attachment-thumb" aria-hidden="true">
      {thumbnail ? (
        <img
          src={thumbnail}
          alt=""
          draggable={false}
          onError={() => setThumbnail("")}
        />
      ) : (
        <Icon className="attachment-type size-5" />
      )}
    </span>
  );
}

export function MailAttachments({
  mailId,
  demo = false,
  attachments,
  onDownload,
  onPreview,
}: {
  mailId: string;
  demo?: boolean;
  attachments: Detail["attachments"];
  onDownload: (index: number, name: string) => Promise<void>;
  onPreview?: (index: number, name: string) => Promise<void>;
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
    if (action === "preview" && ((!native && !onPreview) || demo)) {
      toast.info(
        t(
          "Preview real attachments in a local application from the desktop app",
        ),
      );
      return;
    }
    setPending((p) => ({ ...p, [index]: action }));
    try {
      if (action === "preview") {
        if (onPreview) await onPreview(index, name);
        else await call("preview_attachment", { id: mailId, index });
      } else await onDownload(index, name);
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
    <div className="attachment-list" aria-label={t("Message attachments")}>
      {attachments.map((attachment) => {
        const extension = /\.[^./\\\s]{1,12}$/.exec(attachment.name);
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
            key={`${mailId}:${attachment.index}`}
            aria-busy={!!busy}
          >
            <Button
              variant="ghost"
              className="attachment-preview"
              title={
                attachment.error ||
                t("Open {value0} in the default application", {
                  value0: attachment.name,
                })
              }
              disabled={disabled}
              aria-label={t("Preview attachment {value0}", {
                value0: attachment.name,
              })}
              onClick={() =>
                void act(attachment.index, attachment.name, "preview")
              }
            >
              <AttachmentThumbnail
                mailId={mailId}
                demo={demo}
                attachment={attachment}
                Icon={Icon}
              />
              <span className="attachment-info">
                <strong>
                  <span className="truncate">
                    {extension?.index
                      ? attachment.name.slice(0, extension.index)
                      : attachment.name}
                  </span>
                  {!!extension?.index && (
                    <span className="shrink-0">{extension[0]}</span>
                  )}
                </strong>
                {busy ? (
                  <span className="attachment-progress" role="status">
                    <Skeleton className="h-2 w-6" />
                    <small>
                      {busy === "preview" ? t("Opening…") : t("Saving…")}
                    </small>
                  </span>
                ) : (
                  <small>
                    {attachment.error
                      ? t("Attachment encoding error")
                      : t("{value0} · Click to preview", {
                          value0: formatSize(attachment.size),
                        })}
                  </small>
                )}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="attachment-download"
              title={attachment.error || t("Save attachment as")}
              disabled={disabled}
              aria-label={t("Download attachment {value0}", {
                value0: attachment.name,
              })}
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
