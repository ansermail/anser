import { Fragment } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  Heading,
  Type,
  ALargeSmall,
  List,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  SquareCode,
  Quote,
  Link,
  Undo2,
  Redo2,
  ImagePlus,
  LoaderCircle,
  Superscript,
  Subscript,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Highlighter,
  RemoveFormatting,
  Minus,
  Moon,
  Sun,
} from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Toggle } from "./ui/toggle";
import { Separator } from "./ui/separator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { BODY_FONTS, BODY_SIZES } from "@/lib/rich-body";
import { native, isDemo } from "@/lib/api";
import { RichSearch } from "./rich-search";

const colors = [
  { label: "黄色", value: "#fff59d" },
  { label: "绿色", value: "#b9f6ca" },
  { label: "蓝色", value: "#bbdefb" },
  { label: "紫色", value: "#e1bee7" },
  { label: "粉色", value: "#f8bbd0" },
  { label: "橙色", value: "#ffe0b2" },
];
export function RichToolbar({
  editor,
  disabled,
  imageBusy,
  onImage,
  onLink,
  searchOpen,
  onSearchOpen,
  dark,
  onToggleTheme,
}: {
  editor: Editor;
  disabled: boolean;
  imageBusy: boolean;
  onImage: () => void;
  onLink: () => void;
  searchOpen: boolean;
  onSearchOpen: (open: boolean) => void;
  dark: boolean;
  onToggleTheme?: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      font: editor.getAttributes("textStyle").fontFamily || "default",
      size: editor.getAttributes("textStyle").fontSize || "12pt",
      heading: editor.getAttributes("heading").level || "paragraph",
      list: editor.isActive("taskList")
        ? "task"
        : editor.isActive("bulletList")
          ? "bullet"
          : editor.isActive("orderedList")
            ? "ordered"
            : "none",
      align:
        ["left", "center", "right", "justify"].find((textAlign) =>
          editor.isActive({ textAlign }),
        ) || "left",
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      code: editor.isActive("code"),
      quote: editor.isActive("blockquote"),
      codeBlock: editor.isActive("codeBlock"),
      sup: editor.isActive("superscript"),
      sub: editor.isActive("subscript"),
      link: editor.isActive("link"),
      highlight: editor.isActive("highlight"),
      undo: editor.can().undo(),
      redo: editor.can().redo(),
    }),
  });
  const focus = (event: Event) => {
    event.preventDefault();
    editor.commands.focus();
  };
  const normalizeFont = (font: string) =>
    font.replace(/["']/g, "").replace(/\s+/g, "").toLowerCase();
  const font = BODY_FONTS.find(
    (item) => normalizeFont(item.value) === normalizeFont(state.font),
  );
  const menus = [
    {
      label: "正文段落类型",
      icon: Heading,
      value: String(state.heading),
      options: [
        { value: "paragraph", label: "正文" },
        ...[1, 2, 3, 4].map((level) => ({
          value: String(level),
          label: `标题 ${level}`,
        })),
      ],
      run: (value: string) =>
        value === "paragraph"
          ? editor.chain().focus().setParagraph().run()
          : editor
              .chain()
              .focus()
              .setHeading({ level: Number(value) as 1 | 2 | 3 | 4 })
              .run(),
    },
    {
      label: "正文字体",
      icon: Type,
      value: font?.value || state.font,
      options: [
        { value: "default", label: "默认字体" },
        ...BODY_FONTS,
        ...(state.font !== "default" && !font
          ? [{ value: state.font, label: "原字体" }]
          : []),
      ],
      run: (value: string) =>
        value === "default"
          ? editor.chain().focus().unsetFontFamily().run()
          : editor.chain().focus().setFontFamily(value).run(),
    },
    {
      label: "正文字号",
      icon: ALargeSmall,
      value: state.size,
      options: [
        ...BODY_SIZES.map((size) => ({
          value: `${size}pt`,
          label: `${size} pt`,
        })),
        ...(!BODY_SIZES.some((size) => `${size}pt` === state.size)
          ? [{ value: state.size, label: state.size }]
          : []),
      ],
      run: (value: string) => editor.chain().focus().setFontSize(value).run(),
    },
    {
      label: "正文列表",
      icon: List,
      value: state.list,
      options: [
        { value: "none", label: "普通段落" },
        { value: "bullet", label: "无序列表" },
        { value: "ordered", label: "有序列表" },
        { value: "task", label: "任务列表" },
      ],
      run: (value: string) => {
        const chain = editor.chain().focus();
        if (value === "none") chain.clearNodes().run();
        else if (value === "bullet") chain.toggleBulletList().run();
        else if (value === "ordered") chain.toggleOrderedList().run();
        else chain.toggleTaskList().run();
      },
    },
  ];
  const marks = [
    {
      label: "加粗",
      icon: Bold,
      active: state.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      active: state.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "下划线",
      icon: Underline,
      active: state.underline,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "删除线",
      icon: Strikethrough,
      active: state.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "行内代码",
      icon: Code,
      active: state.code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: "引用",
      icon: Quote,
      active: state.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "代码块",
      icon: SquareCode,
      active: state.codeBlock,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "上标",
      icon: Superscript,
      active: state.sup,
      run: () => editor.chain().focus().toggleSuperscript().run(),
    },
    {
      label: "下标",
      icon: Subscript,
      active: state.sub,
      run: () => editor.chain().focus().toggleSubscript().run(),
    },
  ];
  const actions = [
    {
      label: "撤销编辑",
      icon: Undo2,
      blocked: !state.undo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: "重做编辑",
      icon: Redo2,
      blocked: !state.redo,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div className="format-toolbar" role="toolbar" aria-label="正文格式工具条">
      <div
        className="flex shrink-0 items-center gap-1"
        role="group"
        aria-label="历史操作"
      >
        {actions.map((action) => (
          <Tooltip key={action.label}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={action.label}
                disabled={disabled || action.blocked}
                onMouseDown={(e) => e.preventDefault()}
                onClick={action.run}
              >
                <action.icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Separator
        orientation="vertical"
        className="mx-1 shrink-0 self-center data-[orientation=vertical]:h-5"
      />
      {menus.map((menu) => {
        const current = menu.options.find(
          (option) => option.value === menu.value,
        )?.label;
        return (
          <DropdownMenu key={menu.label}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={menu.label}
                    disabled={disabled}
                  >
                    <menu.icon />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {menu.label}：{current}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent
              className="rich-format-menu"
              data-format-menu={menu.label}
              align="start"
              onCloseAutoFocus={focus}
            >
              <DropdownMenuRadioGroup
                value={menu.value}
                onValueChange={menu.run}
              >
                {menu.options.map((option, index) => {
                  const group = "group" in option ? option.group : undefined;
                  const previous = menu.options[index - 1];
                  const previousGroup =
                    previous && "group" in previous
                      ? previous.group
                      : undefined;
                  return (
                    <Fragment key={option.value}>
                      {group && group !== previousGroup && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>{String(group)}</DropdownMenuLabel>
                        </>
                      )}
                      <DropdownMenuRadioItem value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    </Fragment>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
      <Separator
        orientation="vertical"
        className="mx-1 shrink-0 self-center data-[orientation=vertical]:h-5"
      />
      <div
        className="flex shrink-0 items-center gap-1"
        role="group"
        aria-label="文字与块格式"
      >
        {marks.map((mark) => (
          <Tooltip key={mark.label}>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                aria-label={mark.label}
                pressed={mark.active}
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onPressedChange={mark.run}
              >
                <mark.icon />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>{mark.label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="高亮颜色"
                aria-pressed={state.highlight}
                disabled={disabled}
              >
                <Highlighter />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>文本高亮颜色</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          className="rich-format-menu"
          onCloseAutoFocus={focus}
        >
          <DropdownMenuGroup>
            {colors.map((color) => (
              <DropdownMenuItem
                key={color.value}
                onSelect={() =>
                  editor
                    .chain()
                    .focus()
                    .setHighlight({ color: color.value })
                    .run()
                }
              >
                <Highlighter style={{ color: color.value }} />
                {color.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().unsetHighlight().run()}
            >
              取消高亮
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            aria-label="插入链接"
            pressed={state.link}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onPressedChange={onLink}
          >
            <Link />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>插入或编辑链接</TooltipContent>
      </Tooltip>
      <Separator
        orientation="vertical"
        className="mx-1 shrink-0 self-center data-[orientation=vertical]:h-5"
      />
      <ToggleGroup
        className="shrink-0"
        type="single"
        value={state.align}
        size="sm"
        aria-label="段落对齐"
        disabled={disabled}
        onValueChange={(value) => {
          if (value) editor.chain().focus().setTextAlign(value).run();
        }}
      >
        {[
          { value: "left", label: "左对齐", icon: AlignLeft },
          { value: "center", label: "居中对齐", icon: AlignCenter },
          { value: "right", label: "右对齐", icon: AlignRight },
          { value: "justify", label: "两端对齐", icon: AlignJustify },
        ].map((align) => (
          <Tooltip key={align.value}>
            <TooltipTrigger asChild>
              <ToggleGroupItem
                className="size-8 px-1.5"
                value={align.value}
                aria-label={align.label}
                onMouseDown={(e) => e.preventDefault()}
              >
                <align.icon />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>{align.label}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="插入分割线"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>插入分割线</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="清除格式"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              editor.chain().focus().unsetAllMarks().clearNodes().run()
            }
          >
            <RemoveFormatting />
          </Button>
        </TooltipTrigger>
        <TooltipContent>清除选中内容的格式</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="插入正文图片"
            disabled={disabled || imageBusy || !native || isDemo()}
            onClick={onImage}
          >
            {imageBusy ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <ImagePlus />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>插入正文图片（也可粘贴或拖入正文）</TooltipContent>
      </Tooltip>
      <RichSearch
        editor={editor}
        disabled={disabled}
        open={searchOpen}
        onOpenChange={onSearchOpen}
      />
      {onToggleTheme && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="切换写信主题"
              disabled={disabled}
              onClick={onToggleTheme}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>切换应用明暗主题</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
