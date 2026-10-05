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
import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Link,
  Quote,
  Undo2,
} from "lucide-react";
import DOMPurify from "dompurify";
import { Button } from "./ui/button";
import { textToHtml } from "@/lib/compose-format";

export function RichEditor({
  body,
  html,
  disabled,
  onChange,
}: {
  body: string;
  html: string;
  disabled: boolean;
  onChange: (body: string, html: string) => void;
}) {
  const [linkDialog, setLinkDialog] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
        heading: { levels: [1, 2, 3] },
      }),
    ],
    content: html || textToHtml(body),
    editorProps: {
      attributes: {
        class: "rich-body",
        role: "textbox",
        "aria-label": "邮件正文",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor }) =>
      onChange(
        editor.getText({ blockSeparator: "\n" }),
        DOMPurify.sanitize(editor.getHTML()),
      ),
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold"),
      italic: editor?.isActive("italic"),
      underline: editor?.isActive("underline"),
      bullet: editor?.isActive("bulletList"),
      ordered: editor?.isActive("orderedList"),
      quote: editor?.isActive("blockquote"),
      link: editor?.isActive("link"),
    }),
  });
  if (!editor) return null;
  const tools = [
    {
      name: "加粗",
      icon: Bold,
      active: state?.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: "斜体",
      icon: Italic,
      active: state?.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: "下划线",
      icon: Underline,
      active: state?.underline,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      name: "无序列表",
      icon: List,
      active: state?.bullet,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: "有序列表",
      icon: ListOrdered,
      active: state?.ordered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "引用",
      icon: Quote,
      active: state?.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "插入链接",
      icon: Link,
      active: state?.link,
      run: () => {
        setHref(editor.getAttributes("link").href || "https://");
        setLinkError("");
        setLinkDialog({
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        });
      },
    },
    {
      name: "撤销编辑",
      icon: Undo2,
      active: false,
      run: () => editor.chain().focus().undo().run(),
    },
  ];
  return (
    <div className="rich-editor">
      <div className="format-toolbar" role="toolbar" aria-label="正文格式">
        {tools.map((t) => (
          <Button
            key={t.name}
            type="button"
            variant="ghost"
            size="icon-sm"
            title={t.name}
            aria-label={t.name}
            aria-pressed={!!t.active}
            disabled={disabled}
            onClick={t.run}
          >
            <t.icon size={15} />
          </Button>
        ))}
      </div>
      <EditorContent editor={editor} />
      <Dialog
        open={!!linkDialog}
        onOpenChange={(open) => {
          if (!open) setLinkDialog(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            editor.commands.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>插入链接</DialogTitle>
            <DialogDescription>
              支持网页和邮箱地址。留空可移除当前链接。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const url = href.trim();
              if (url) {
                try {
                  if (
                    !["http:", "https:", "mailto:"].includes(
                      new URL(url).protocol,
                    )
                  )
                    throw new Error();
                } catch {
                  setLinkError("请输入有效的 http、https 或 mailto 链接");
                  return;
                }
              }
              if (!linkDialog || disabled) return;
              const chain = editor
                .chain()
                .focus()
                .setTextSelection(linkDialog)
                .extendMarkRange("link");
              if (url) chain.setLink({ href: url }).run();
              else chain.unsetLink().run();
              setLinkDialog(null);
            }}
          >
            <FieldGroup>
              <Field data-invalid={!!linkError}>
                <FieldLabel htmlFor="rich-link-url">链接地址</FieldLabel>
                <Input
                  id="rich-link-url"
                  autoFocus
                  value={href}
                  aria-invalid={!!linkError}
                  disabled={disabled}
                  onChange={(e) => {
                    setHref(e.target.value);
                    setLinkError("");
                  }}
                />
                {linkError && <FieldError>{linkError}</FieldError>}
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLinkDialog(null)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={disabled}>
                  保存链接
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
