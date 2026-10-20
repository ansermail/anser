import { t } from "@/lib/i18n";
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
  Baseline,
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
  {
    get label() {
      return t("Yellow");
    },
    value: "#fff59d",
  },
  {
    get label() {
      return t("Green");
    },
    value: "#b9f6ca",
  },
  {
    get label() {
      return t("Blue");
    },
    value: "#bbdefb",
  },
  {
    get label() {
      return t("Purple");
    },
    value: "#e1bee7",
  },
  {
    get label() {
      return t("Pink");
    },
    value: "#f8bbd0",
  },
  {
    get label() {
      return t("Orange");
    },
    value: "#ffe0b2",
  },
];
const textColors = [
  {
    get label() {
      return t("Grey");
    },
    value: "#5f6368",
  },
  {
    get label() {
      return t("Red");
    },
    value: "#c5221f",
  },
  {
    get label() {
      return t("Orange");
    },
    value: "#b06000",
  },
  {
    get label() {
      return t("Green");
    },
    value: "#1e7b34",
  },
  {
    get label() {
      return t("Blue");
    },
    value: "#1a56b0",
  },
  {
    get label() {
      return t("Purple");
    },
    value: "#7627bb",
  },
  {
    get label() {
      return t("Pink");
    },
    value: "#a4295a",
  },
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
      color: editor.getAttributes("textStyle").color || "",
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
      id: "paragraph-type",
      label: t("Paragraph type"),
      icon: Heading,
      value: String(state.heading),
      options: [
        { value: "paragraph", label: t("Body") },
        ...[1, 2, 3, 4].map((level) => ({
          value: String(level),
          label: t("Heading {value0}", { value0: level }),
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
      id: "font",
      label: t("Body font"),
      icon: Type,
      value: font?.value || state.font,
      options: [
        { value: "default", label: t("Default font") },
        ...BODY_FONTS.map((item) => ({
          ...item,
          group: t(item.group),
          label: t(item.label),
        })),
        ...(state.font !== "default" && !font
          ? [{ value: state.font, label: t("Original font") }]
          : []),
      ],
      run: (value: string) =>
        value === "default"
          ? editor.chain().focus().unsetFontFamily().run()
          : editor.chain().focus().setFontFamily(value).run(),
    },
    {
      id: "font-size",
      label: t("Font size"),
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
      id: "list-type",
      label: t("List type"),
      icon: List,
      value: state.list,
      options: [
        { value: "none", label: t("Normal paragraph") },
        { value: "bullet", label: t("Bulleted list") },
        { value: "ordered", label: t("Numbered list") },
        { value: "task", label: t("Task list") },
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
      label: t("Bold"),
      icon: Bold,
      active: state.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: t("Italic"),
      icon: Italic,
      active: state.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: t("Underline"),
      icon: Underline,
      active: state.underline,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: t("Strikethrough"),
      icon: Strikethrough,
      active: state.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: t("Inline code"),
      icon: Code,
      active: state.code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      label: t("Block quote"),
      icon: Quote,
      active: state.quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: t("Code block"),
      icon: SquareCode,
      active: state.codeBlock,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: t("Superscript"),
      icon: Superscript,
      active: state.sup,
      run: () => editor.chain().focus().toggleSuperscript().run(),
    },
    {
      label: t("Subscript"),
      icon: Subscript,
      active: state.sub,
      run: () => editor.chain().focus().toggleSubscript().run(),
    },
  ];
  const actions = [
    {
      label: t("Undo edit"),
      icon: Undo2,
      blocked: !state.undo,
      run: () => editor.chain().focus().undo().run(),
    },
    {
      label: t("Redo edit"),
      icon: Redo2,
      blocked: !state.redo,
      run: () => editor.chain().focus().redo().run(),
    },
  ];
  return (
    <div
      className="format-toolbar"
      role="toolbar"
      aria-label={t("Body formatting toolbar")}
    >
      <div
        className="flex shrink-0 items-center gap-1"
        role="group"
        aria-label={t("Edit history")}
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
              data-format-menu={menu.id}
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
                          <DropdownMenuLabel>{group}</DropdownMenuLabel>
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
        aria-label={t("Text & block formatting")}
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
                aria-label={t("Text color")}
                aria-pressed={Boolean(state.color)}
                disabled={disabled}
              >
                <Baseline
                  style={state.color ? { color: state.color } : undefined}
                />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("Text color")}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          className="rich-format-menu"
          onCloseAutoFocus={focus}
        >
          <DropdownMenuGroup>
            {textColors.map((color) => (
              <DropdownMenuItem
                key={color.value}
                onSelect={() =>
                  editor.chain().focus().setColor(color.value).run()
                }
              >
                <Baseline style={{ color: color.value }} />
                {color.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onSelect={() => editor.chain().focus().unsetColor().run()}
            >
              {t("Default color")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("Highlight color")}
                aria-pressed={state.highlight}
                disabled={disabled}
              >
                <Highlighter />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("Text highlight color")}</TooltipContent>
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
              {t("Remove highlight")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            aria-label={t("Insert link")}
            pressed={state.link}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onPressedChange={onLink}
          >
            <Link />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent>{t("Insert or edit link")}</TooltipContent>
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
        aria-label={t("Paragraph alignment")}
        disabled={disabled}
        onValueChange={(value) => {
          if (value) editor.chain().focus().setTextAlign(value).run();
        }}
      >
        {[
          { value: "left", label: t("Align left"), icon: AlignLeft },
          { value: "center", label: t("Align center"), icon: AlignCenter },
          { value: "right", label: t("Align right"), icon: AlignRight },
          { value: "justify", label: t("Justify"), icon: AlignJustify },
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
            aria-label={t("Insert separator")}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("Insert separator")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Clear formatting")}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              editor.chain().focus().unsetAllMarks().clearNodes().run()
            }
          >
            <RemoveFormatting />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("Clear formatting of selection")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Insert body image")}
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
        <TooltipContent>
          {t("Insert body image (or paste or drop into the body)")}
        </TooltipContent>
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
              aria-label={t("Toggle compose theme")}
              disabled={disabled}
              onClick={onToggleTheme}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("Toggle application theme")}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
