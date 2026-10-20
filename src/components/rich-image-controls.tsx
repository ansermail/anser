import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { Scaling, RotateCcw } from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
} from "./ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { FieldGroup, Field, FieldLabel, FieldError } from "./ui/field";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { SelectField, SelectOption } from "./ui/select-field";
import { SelectGroup } from "./ui/select";
import {
  imageDimension,
  resizeImage,
  type ImageTarget,
} from "@/lib/rich-image-size";
import { toast } from "sonner";

export function RichImageControls({
  editor,
  disabled,
}: {
  editor: Editor;
  disabled: boolean;
}) {
  const target = useRef<ImageTarget | null>(null);
  const ratio = useRef(1);
  const dialogOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [locked, setLocked] = useState(true);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [preset, setPreset] = useState("custom");
  const [error, setError] = useState("");
  useEffect(() => {
    const map = ({ transaction }: { transaction: Transaction }) => {
      if (target.current)
        target.current.bookmark = target.current.bookmark.map(
          transaction.mapping,
        );
    };
    editor.on("transaction", map);
    return () => {
      editor.off("transaction", map);
      target.current = null;
    };
  }, [editor]);
  const changeOpen = (value: boolean) => {
    dialogOpen.current = value;
    setOpen(value);
  };
  const apply = (w: number | null, h: number | null) => {
    if (disabled || !resizeImage(editor, target.current, w, h)) {
      setError(t("图片已变化或当前不能编辑，请关闭后重新选择图片。"));
      return false;
    }
    changeOpen(false);
    return true;
  };
  const changeDimension = (dimension: "width" | "height", text: string) => {
    (dimension === "width" ? setWidth : setHeight)(text);
    const value = imageDimension(text);
    if (locked && value && ratio.current > 0) {
      const other = Math.max(
        1,
        Math.round(
          dimension === "width" ? value / ratio.current : value * ratio.current,
        ),
      );
      (dimension === "width" ? setHeight : setWidth)(String(other));
    }
    setPreset("custom");
    setError("");
  };
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={disabled}>
          <EditorContent
            editor={editor}
            onContextMenuCapture={(event) => {
              const image =
                event.target instanceof HTMLElement
                  ? event.target.closest("img[src]")
                  : null;
              if (
                !(image instanceof HTMLImageElement) ||
                !editor.view.dom.contains(image) ||
                disabled ||
                !editor.isEditable
              ) {
                // Leave normal text/browser context menus available.
                event.stopPropagation();
                return;
              }
              const pos = editor.view.posAtDOM(image, 0);
              const node = editor.state.doc.nodeAt(pos);
              if (!node || node.type.name !== "image") {
                event.stopPropagation();
                return;
              }
              editor.commands.setNodeSelection(pos);
              target.current = {
                bookmark: editor.state.selection.getBookmark(),
                node,
              };
              const declaredWidth = imageDimension(node.attrs.width);
              const declaredHeight = imageDimension(node.attrs.height);
              const w =
                declaredWidth ||
                (declaredHeight && image.naturalHeight && image.naturalWidth
                  ? Math.round(
                      (declaredHeight * image.naturalWidth) /
                        image.naturalHeight,
                    )
                  : 0) ||
                image.naturalWidth ||
                Math.round(image.getBoundingClientRect().width);
              const h =
                declaredHeight ||
                (declaredWidth && image.naturalWidth && image.naturalHeight
                  ? Math.round(
                      (declaredWidth * image.naturalHeight) /
                        image.naturalWidth,
                    )
                  : 0) ||
                image.naturalHeight ||
                Math.round(image.getBoundingClientRect().height);
              setWidth(w ? String(w) : "");
              setHeight(h ? String(h) : "");
              ratio.current = w && h ? w / h : 0;
              setLocked(!!ratio.current);
              setNatural({
                width: image.naturalWidth,
                height: image.naturalHeight,
              });
              setPreset("custom");
              setError("");
            }}
          />
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!dialogOpen.current && !editor.isDestroyed)
              editor.commands.focus();
          }}
        >
          <ContextMenuGroup>
            <ContextMenuItem
              disabled={disabled}
              onSelect={() => changeOpen(true)}
            >
              <Scaling />
              {t("调整图片尺寸")}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={disabled}
              onSelect={() => {
                if (!apply(null, null))
                  toast.error(t("图片已变化，请重新选择图片"));
              }}
            >
              <RotateCcw />
              {t("恢复原始尺寸")}
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent
          className="sm:max-w-sm"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!editor.isDestroyed) editor.commands.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("调整图片尺寸")}</DialogTitle>
            <DialogDescription>
              {t("只调整正文显示大小，保留原图片清晰度和文件内容。")}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const w = imageDimension(width),
                h = imageDimension(height);
              if (!w || !h) {
                setError(t("宽高请填写 1 至 10000 的整数（像素）。"));
                return;
              }
              apply(w, h);
            }}
          >
            <FieldGroup className="gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={!!error}>
                  <FieldLabel htmlFor="rich-image-width">
                    {t("宽度（px）")}
                  </FieldLabel>
                  <Input
                    id="rich-image-width"
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    value={width}
                    disabled={disabled}
                    aria-invalid={!!error}
                    onChange={(event) =>
                      changeDimension("width", event.target.value)
                    }
                  />
                </Field>
                <Field data-invalid={!!error}>
                  <FieldLabel htmlFor="rich-image-height">
                    {t("高度（px）")}
                  </FieldLabel>
                  <Input
                    id="rich-image-height"
                    type="number"
                    min={1}
                    max={10000}
                    step={1}
                    value={height}
                    disabled={disabled}
                    aria-invalid={!!error}
                    onChange={(event) =>
                      changeDimension("height", event.target.value)
                    }
                  />
                </Field>
              </div>
              <Field orientation="horizontal">
                <Checkbox
                  id="rich-image-proportion"
                  checked={locked}
                  disabled={
                    disabled ||
                    !imageDimension(width) ||
                    !imageDimension(height)
                  }
                  onCheckedChange={(value) => {
                    ratio.current = Number(width) / Number(height);
                    setLocked(value === true);
                  }}
                />
                <FieldLabel htmlFor="rich-image-proportion">
                  {t("锁定宽高比例")}
                </FieldLabel>
              </Field>
              <Field>
                <FieldLabel htmlFor="rich-image-scale">
                  {t("按原图缩放")}
                </FieldLabel>
                <SelectField
                  id="rich-image-scale"
                  value={preset}
                  disabled={disabled || !natural.width || !natural.height}
                  onValueChange={(value) => {
                    if (value === "custom") return;
                    const scale = Number(value) / 100;
                    setWidth(
                      String(Math.max(1, Math.round(natural.width * scale))),
                    );
                    setHeight(
                      String(Math.max(1, Math.round(natural.height * scale))),
                    );
                    ratio.current = natural.width / natural.height;
                    setLocked(true);
                    setPreset(value);
                    setError("");
                  }}
                >
                  <SelectGroup>
                    <SelectOption value="custom">
                      {t("自定义尺寸")}
                    </SelectOption>
                    {[25, 50, 75, 100].map((value) => (
                      <SelectOption key={value} value={value}>
                        {value}%
                      </SelectOption>
                    ))}
                  </SelectGroup>
                </SelectField>
              </Field>
              {error && <FieldError>{error}</FieldError>}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => apply(null, null)}
                >
                  {t("恢复原始")}
                </Button>
                <Button type="submit" disabled={disabled}>
                  {t("应用尺寸")}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
