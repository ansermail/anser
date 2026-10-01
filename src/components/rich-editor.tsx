import { useEffect } from "react";
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
        const href = window.prompt(
          "链接地址（https://…）",
          editor.getAttributes("link").href || "https://",
        );
        if (href === null) return;
        if (!href.trim()) {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          return;
        }
        if (!/^(https?:\/\/|mailto:)/i.test(href)) return;
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
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
    </div>
  );
}
