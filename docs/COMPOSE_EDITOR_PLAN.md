# 写信编辑器升级方案：表格自由调宽高、编辑区视觉美化与 Markdown 所见即所得

- 日期：2026-11-20
- 状态：已实施，通过本地自动化与 macOS 原生验收
- 关联模块：`src/components/compose-dialog.tsx`、`src/components/rich-editor.tsx`、`src/components/rich-toolbar.tsx`、`src/components/rich-image-controls.tsx`、`src/lib/rich-extensions.ts`、`src/lib/compose-format.ts`、`src/index.css`

---

## 1. 背景与现状核查

对当前 `main` 分支（`v0.1.43`）写信模块的核查结论如下：

| 维度 | 当前实现现状 | 存在的问题与缺口 |
| --- | --- | --- |
| **底层组件体系** | 富文本模式基于 **Tiptap 3 (`@tiptap/react` 3.31.3) + ProseMirror**，工具栏与弹窗组合 **shadcn/ui**。 | 底层引擎本身能力强且符合项目 UI 铁律，但大量高级扩展能力未开放。 |
| **表格能力** | `src/lib/rich-extensions.ts` 引入了 `@tiptap/extension-table`，但配置了 `resizable: false`。 | 1. 工具栏和右键菜单**没有任何表格入口**（无法插入表格、增删行列、合并/拆分单元格）；<br>2. 禁用了列宽拖拽，且原生不支持**行高（高度）拖拽**与表格整体宽度调节；<br>3. 单元格宽高未同步序列化为邮件客户端兼容的内联 `style="width:...;height:..."`。 |
| **Markdown 模式** | `src/components/compose-dialog.tsx` 在 `format === "markdown"` 时渲染为纯文本 `<Textarea>`。 | 编辑区只是等宽字体代码框，只能在右侧「发送预览」看渲染结果，**没有做到边写边渲染、所见即所得（WYSIWYG）**。 |
| **编辑区视觉 (`.rich-body`)** | `src/index.css` 中仅设置了 `padding: 8px 10px` 与基础边框。 | 中文书写区留白局促、无空态占位提示（Placeholder）、无表格选中高亮与拖拽参考线，引用块/代码块/任务列表排版质感较简陋。 |

---

## 2. 总体设计目标

在不引入违背项目 **shadcn/ui 铁律** 的第三方异构 UI 编辑器、不破坏现有 **AI 写作助手 Diff 装饰** 与 **内嵌图片 `cid:` 窗口租约保护** 的前提下，基于现有 Tiptap + ProseMirror + shadcn/ui 架构完成三项升级：

1. **表格全功能与自由调宽高**：支持插入表格、行列增删、单元格合并拆分，支持**鼠标直接拖拽调整列宽（长度）与行高（高度）**，并提供精确尺寸调整弹窗；所有宽高尺寸自动落盘为邮件 HTML 内联 `style`，保证发信后收件端所见即所得。
2. **Markdown 边写边渲染（所见即所得）**：将 Markdown 写作接入可视化所见即所得画布，支持输入 Markdown 语法（含 `# 标题`、`**粗体**`、任务列表、代码块、`| 表头 |` 表格等）及粘贴 Markdown 文本时**当场实时渲染**，同时保留底层 `.md` 源码双向同步与一键查看/编辑源码能力。
3. **编辑区画布（`.rich-body`）视觉美化**：优化中文书写的呼吸感、留白、段落与标题层级、空态占位提示、表格表头/选中单元格/拖拽手柄视觉，以及引用块、代码块在浅色/深色主题下的现代文档质感。

---

## 3. 分模块详细改造方案

### 3.1 模块一：表格全功能与长度/高度调整

#### (1) 表格节点扩展与内联样式输出（`src/lib/rich-extensions.ts`、新增 `src/lib/rich-table.ts`）
- **开启并增强列宽拖拽**：
  - 将 `Table` 配置改为 `Table.configure({ resizable: true, cellMinWidth: 48, allowTableNodeSelection: true })`。
- **扩展表格、行、单元格尺寸属性（保障邮件客户端兼容）**：
  - **`MailTable`**：扩展 `width` 属性（支持 `100%` 或指定像素如 `640px`），`renderHTML` 输出 `style="border-collapse:collapse;width:<width>;max-width:100%;margin:12px 0"`。
  - **`MailTableRow`**：扩展 `height` 属性（整数像素，范围 `24px–1200px`），`renderHTML` 在设置行高时输出 `<tr style="height:<height>px">`。
  - **`MailTableHeader` / `MailTableCell`**：读取 ProseMirror `colwidth` 数组及显式 `width` / `height` 属性，在 `renderHTML` 中将 `width:<w>px;` 与 `height:<h>px;` 合并写入 `<th/td style="...">` 内联样式（多数桌面与网页邮件客户端不识别纯 `<colgroup>` 宽度，写入单元格内联 `style` 才能保证收件端列宽与行高不走样）。
- **新增行高（高度）鼠标拖拽插件（ProseMirror Plugin）**：
  - 监听表格内 `mousemove` / `pointerdown`：当鼠标靠近任意表格行下边缘（`±4px` 热区）时，光标切换为 `row-resize` 并显示横向高亮参考线；
  - 按下拖动时实时计算行高（最小 `24px`，最大 `1200px`），释放鼠标时通过 ProseMirror Transaction 更新该行的 `height` 属性与单元格高度，支持 `Undo / Redo`。

#### (2) 工具栏「表格」菜单与右键菜单（`src/components/rich-toolbar.tsx`、新增 `src/components/rich-table-controls.tsx`）
- **工具栏新增「表格」下拉菜单（组合 shadcn `DropdownMenu`）**：
  - **插入表格**：提供快捷网格选择器（鼠标悬停高亮 `1×1` 至 `8×6` 网格一键插入）及「自定义插入表格…」（输入行数 `1–20`、列数 `1–12`、是否包含表头行）。
  - **行列与单元格操作**（光标在表格内时启用）：
    - 在上方插入行 / 在下方插入行 / 删除当前行
    - 在左侧插入列 / 在右侧插入列 / 删除当前列
    - 合并单元格 / 拆分单元格 / 切换表头行 / 切换表头列
    - **调整表格与单元格尺寸…**（打开精确尺寸弹窗）
    - **重置当前列宽与行高** / **删除表格**
- **右键菜单与精确尺寸弹窗（组合 shadcn `ContextMenu` + `Dialog`）**：
  - 扩展现有右键菜单容器：右键图片时展示图片尺寸菜单；右键表格单元格时展示上述表格操作与「调整表格与单元格尺寸…」。
  - **「调整表格与单元格尺寸」弹窗**：
    - 表格总宽度：可选 `自适应 100%` 或自定义像素宽度（`200–2000 px`）；
    - 当前列宽度：输入像素值（`48–1600 px`）或留空自适应；
    - 当前行高度：输入像素值（`24–1200 px`）或留空自适应；
    - 提供「恢复默认尺寸」快捷按钮。

---

### 3.2 模块二：Markdown 边写边渲染（所见即所得 WYSIWYG）

#### (1) 实时 Markdown 语法输入与粘贴渲染（新增 `src/lib/rich-markdown.ts`）
在所见即所得编辑器中补齐完整的 Markdown 实时转换规则（在富文本模式和 Markdown 模式下共同生效）：
- **块级实时语法（Input Rules）**：
  - `# ` ~ `#### ` → 一至四级标题
  - `- ` / `* ` / `+ ` → 无序列表；`1. ` → 有序列表
  - `- [ ] ` / `- [x] ` → 任务列表（未勾选 / 已勾选）
  - `> ` → 引用块；`---` / `***` → 分割线；` ``` ` → 代码块
  - **Markdown 表格快捷生成**：输入 `| 表头1 | 表头2 |`（或带对齐行 `| --- | --- |`）后按回车，自动解析并替换为可视化 Tiptap 表格，光标自动落入第一行数据格。
- **行内实时语法（Input Rules）**：
  - `**文字**` → 粗体；`*文字*` → 斜体；`~~文字~~` → 删除线；`` `代码` `` → 行内代码；`==文字==` → 高亮
  - `[链接文字](https://...)` → 自动转为超链接节点（仅允许 `http:` / `https:` / `mailto:` 安全协议）。
- **Markdown 智能粘贴**：
  - 粘贴纯文本时，若检测到明确的多行 Markdown 结构（如 GFM 表格、标题、任务列表、围栏代码块），自动经 `marked` + `sanitizeComposeHtml` 转为可视化富文本节点插入。

#### (2) Markdown 模式所见即所得化与源码双向同步（`src/components/compose-dialog.tsx`、`src/lib/compose-format.ts`）
- **所见即所得画布统一**：
  - 当格式切换为 `Markdown`（或导入 `.md` 文件）时，**默认直接使用 `RichEditor` 可视化画布**，实现真正的“边写边渲染、所见即所得”，工具栏、表格拖拽调宽高、AI 助手全部可用。
- **HTML ↔ Markdown 双向序列化**：
  - 在 `src/lib/compose-format.ts` 中新增 `htmlToMarkdown(html: string): string`，将编辑器内的标题、段落、粗斜体、删除线、行内代码、代码块、引用、链接、有序/无序/任务列表、表格还原为干净的 GFM Markdown 文本到 `draft.source`，同时生成带内联样式的 `draft.html` 供发信投递。
- **可选「MD 源码」快捷切换（shadcn `Toggle`）**：
  - 当处于 `Markdown` 格式时，在工具栏右侧提供一个紧凑的「源码 / 所见即所得」切换按钮（默认处于所见即所得）：日常编写直接边写边渲染；需要批量粘贴或微调原始 Markdown 符号时可一键展开源码视图，切回时立即渲染为可视化节点。

---

### 3.3 模块三：编辑区域（`.rich-body`）视觉与排版美化

在 `src/index.css` 中升级 `.rich-body` 画布样式，同时兼顾浅色与深色主题：

1. **中文书写排版与舒适留白**：
   - 编辑区内边距由 `8px 10px` 提升为 `14px 18px`，默认字号 `14px (10.5pt–12pt)`、行高 `1.75`、段间距 `10px`，中英文混排与长文书写更舒展。
   - **空正文占位提示（Placeholder）**：编辑器为空时显示柔和的占位文字（`“输入邮件正文，支持直接输入 Markdown 语法、插入表格或拖入图片…”`），聚焦输入或中文输入法组合（IME composing）时无闪烁隐藏。
2. **表格编辑期视觉**：
   - 表头 `th` 使用柔和的语义浅底（浅色 `#f4f6f5`，深色 `rgba(255,255,255,0.06)`）与清晰的 `1px` 边框；
   - 选中单元格（`.selectedCell`）叠加低饱和主题色半透明高亮框（`outline: 2px solid var(--ring)` 及柔和背景），合并/调整多格时边界清晰；
   - 列宽拖拽手柄（`.column-resize-handle`）与行高拖拽提示线（`.row-resize-handle`）显示 `2px` 主题色高亮线，悬停和拖拽过程视觉反馈明确。
3. **块级元素精致化**：
   - **引用块 (`blockquote`)**：采用 `3px` 主题色左边框 + 柔和底色与圆角（`padding: 8px 14px; border-radius: 0 6px 6px 0`）；
   - **代码块 (`pre`)**：增加 `1px solid var(--border)` 细边框、圆角底色与 `SFMono-Regular / Menlo / Consolas` 等宽字体栈；
   - **任务列表 (`taskList`)**：优化勾选框与文字行高对齐，支持回车自动延续下一条任务、空任务回车退出列表。

---

## 4. 邮件投递兼容性与安全边界

- **清理编辑期辅助 DOM**：在 `onUpdate` 与 `prepareCompose` 中，剥离 `.column-resize-handle`、`.row-resize-handle`、`data-placeholder` 等仅用于编辑期的装饰属性，保证草稿与发出的 MIME 纯净。
- **内联样式保真**：发信与右侧「发送预览」继续共用 `prepareCompose`，表格 `width`、`height`、边框、内边距及十六进制颜色全部以内联 `style` 存在于 `deliveryHtml` 中。
- **既有契约不变**：
  - 空白草稿不自动保存、关闭直接舍弃；
  - 签名不在左侧编辑区显示，仅在右侧发送预览与最终投递内容中组合；
  - 正文内嵌图片继续走 `read_body_images` 会话租约与 `cid:` 内联附件通道。

---

## 5. 实施步骤与验收清单

### 实施顺序
1. **第一步：表格扩展与宽高调整**
   - 完成 `src/lib/rich-table.ts` 与 `src/lib/rich-extensions.ts`（开启列宽拖拽、实现行高拖拽插件、单元格/表格宽高内联样式序列化）；
   - 完成 `src/components/rich-table-controls.tsx` 与 `src/components/rich-toolbar.tsx`（工具栏表格菜单、网格插入、右键表格菜单、精确尺寸设置弹窗）。
2. **第二步：Markdown 边写边渲染（所见即所得）**
   - 完成 `src/lib/rich-markdown.ts`（含 `|...|` 表格回车建表、行内/块级 Markdown 实时转换、Markdown 智能粘贴）；
   - 更新 `src/lib/compose-format.ts` 与 `src/components/compose-dialog.tsx`，让 `Markdown` 模式默认使用所见即所得画布并支持源码双向同步。
3. **第三步：编辑区视觉美化与国际化**
   - 更新 `src/index.css`（`.rich-body` 留白、空态 Placeholder、表格选中/拖拽手柄、引用与代码块样式）；
   - 同步 `src/locales/zh-CN.json` 与 `src/locales/en-US.json` 双语文案。
4. **第四步：自动化测试与原生桌面实测**
   - 补充 `src/components/rich-editor.test.tsx`、`src/components/rich-toolbar.test.tsx`、`src/lib/compose-format.test.ts`、`src/components/compose-dialog.test.tsx` 单元测试；
   - 运行 `npm run check:ui`、`npm run check:i18n`、`npm run build`、`npm run build:preview`、`npm run format:check`；
   - 在原生桌面开发版（`npm run desktop`）实测：插入表格、鼠标拖拽调整列宽与行高、弹窗精确修改宽高、输入 Markdown 实时渲染、切换发送预览核对最终邮件 HTML 尺寸与明暗主题视觉。

### 实施与验收记录（2026-11-20）

- **表格**：快捷网格和自定义插入、行列及合并拆分操作、列宽和行高拖拽、精确尺寸与重置已接入。原生 macOS 以示例邮箱插入 2×2 表格，实际拖到列宽 394px、行高 83px，再通过右键弹窗设置总宽 640px、列宽 210px、行高 96px。源码与投递 HTML 保留内联尺寸，合并单元格的分列宽度和撤销由专项测试覆盖。
- **横向拖拽复验**：按原生用户反馈改为在 Pointer Events 按下时识别列分隔线和最右外框。中线左右拖只调整相邻列，外框左右拖缩放整个表。原生 macOS 已实测两处均可双向拖动，并核对预览和行高拖拽。
- **Markdown 和画布**：默认可视化、源码切换、导入、实时语法和结构化粘贴均已实现。原生 macOS 实测标题输入、回车建表、结构化粘贴、源码修改、草稿重开及深浅色画布。发送预览核对表格和静态勾选。修改尺寸或合并后的表格会在 Markdown 源码中表示为 HTML。
- **自动化**：`npm test` 74 个文件、582 项通过。生产构建、Pages 预览构建、UI 铁律、1837 条双语键、Prettier 和差异检查通过。Vite 仍报告动态导入和分包体积提示。
- **交付范围**：代码在本地 `codex/compose-editor` 工作树。Windows 实机、真实收件客户端和云端构建未验证，本次未发布。
