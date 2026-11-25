# 0.1.45 UI 设计规范真机走查与体验优化工作点（2026-11-25）

- **依据规范**：[雁信 UI 设计规范（Topinspo Design Vocabulary）](../../UI_DESIGN_GUIDELINES.md)、[UI 设计与交互专项规范](../../guidelines/ui-design.md)、[前端开发规范](../../guidelines/frontend.md)
- **走查对象**：本机已安装运行的 `/Applications/雁信.app`（v0.1.45，`dev.maildesk.desktop`，1920×1050 窗口，只读采集浅色与深色共 20 组页面/交互态截图，未发送、未修改或删除真实邮件，走查结束后已恢复浅色模式与初始视图）。
- **分支与策略**：在工作树分支 `yn-zxj/chore-fix-codex-config` 实施：第一阶段形成本真机审查报告，第二阶段交由 Codex `gpt-6.2-sol`（`high`）实施代码修复与全量自动回归，第三阶段完成 Chromium 与隔离 macOS 原生 WKWebView 实包复验并提交合入本地 `main`。

---

## 一、真机走查发现（按优先级与设计规范维度归类）

| 编号 | 级别 | 涉及页面 / 模块 | 对应规范维度 | 真机观察到的现象与根因 | 优化目标与验收标准 |
| --- | --- | --- | --- | --- | --- |
| **U1** | **P0** | 设置页左侧 Tabs、工作台一级 Tabs、顶栏主题按钮 | 颜色与交互状态 · 悬停/选中/焦点 | macOS WKWebView 中鼠标点击 Radix `TabsTrigger`（如设置「应用偏好」「阅读与写信」与工作台「四象限」「事项」「工作报告」）或顶栏图标按钮后，会同时叠画 `border-ring` + `ring-[3px]` + `outline-1`（`tabs.tsx` L64）与全局 `button:focus-visible`（`src/index.css` L96），残留刺眼黑色双重/三重外框，甚至遮压工作台活动底线与设置绿底选中态。 | 统一并精简焦点环：单层克制焦点环，仅在键盘焦点导航（`:focus-visible`）时显现，避免在 WKWebView 鼠标点击 Tab 后残留厚重黑框压盖选中态或底线；键盘 Tab/方向键切换时焦点仍清晰满足 WCAG ≥ 3:1。 |
| **U2** | **P0** | 邮件签名 `Checkbox`、工作台周视图时间刻度与四象限、全局辅助控件 | 对比与焦点（WCAG 2.2 AA 4.5:1 / 3:1） | ① 设置「阅读与写信 → 邮件签名」工具栏内未勾选的「使用 HTML」`Checkbox` 边框使用 `--border`（`oklch(0.922 0 0)`）铺在浅灰底条上，几乎隐形（对比度约 1.15:1，远低于 WCAG 非文本 3:1）；② 工作台周视图左侧 `08:00`–`17:00` 时间刻度与四象限轴标/提示文案偏淡；③ 邮件列表未勾选复选框、侧栏虚线「+ 创建第一个标签」在浅/深双主题下边界略弱。 | 提升未勾选 `Checkbox` 边框对比度在浅/深双主题下对相邻底色 ≥ 3:1；提升工作台时间刻度、四象限轴标与空态提示等辅助文本对比度达到 WCAG AA ≥ 4.5:1，同时保持清晰的主次层级。 |
| **U3** | **P1** | 写邮件弹窗（Compose Dialog） | 排版与布局 · 对齐与邻近性 | 「发件人」行使用 `SelectTrigger` 自带水平内边距，导致发件人文本较下方「收件人」「主题」输入框文本向右错位约 12px，三行表单左基线不齐。 | 调整写信头部「发件人」选择器与「收件人」「主题」输入区水平起始位置，使三行内容与占位符在垂直方向严格左对齐，并保持足够点击区与清晰悬停/聚焦态。 |
| **U4** | **P1** | 设置页「应用偏好」与「本地存档」 | 排版与布局 · 留白/分隔/数字与基线/层级一致 | ① 「应用偏好」中仅「工作台」卡片标题前带日历图标，其余卡片（界面语言、后台检查、系统通知与启动、阅读缓存、网络代理、系统默认应用）均无图标，同类卡片视觉不一致；② 「本地存档」中「附加存档」的 `0 B` 与左右两项 `0 封（附加）`、`0 封待归档` 数字-单位间距风格不一（字节指标未拆分为 `数字 + 8px 间距 + 单位` 基线对齐），且本地存档主卡内横竖分隔线偏多。 | 统一「应用偏好」所有设置卡片标题层级（移除「工作台」卡片标题多余的独立图标）；统一 `formatArchiveSize` 输出为「数值 + `<small>` 单位」并共享 `8px` 基线间距与 `tabular-nums`；精简存档卡内非必要分隔线（保留规范要求的校验说明分隔与删除区破坏性分隔线）。 |
| **U5** | **P1** | 发送记录（Outbox）加载态 | 加载、校验与结果反馈 · 骨架屏 | 刚进入「发送记录」加载瞬间，表格坍缩为单列 `状态` + `正在读取发送记录...`，加载完成后瞬间展开为 7 列，造成剧烈版面跳动。 | 在首次加载态使用与真实 7 列/行高结构接近的 shadcn `Skeleton` 骨架行占位，避免列数坍缩与跳动，保留加载可读状态与既有测试兼容。 |
| **U6** | **P1** | 过滤规则、工作台事项表/工作报告空态、通讯录卡片操作 | 主次操作 · 空态与危险色 | ① 过滤规则空态时右上角与中央同时出现两个相同权重的高强调黑色主按钮「+ 新建规则」；② 工作台「事项」空表仅左对齐一行干瘪文案，工作台「工作报告」空态仅在巨大白板顶部漂浮单行文字、缺少图标与行动引导，左侧 `工作记录 / 已完成` 双统计间距紧凑；③ 通讯录卡片行尾「写信 / 编辑 / 删除」三枚图标按钮视觉权重完全一致，删除缺少危险色警示。 | ① 过滤规则空态收敛为单一主按钮（降低重复次入口权重，保留可测入口）；② 工作台事项空表与工作报告空态升级为带图标与清晰引导的结构化居中空态，优化报告双统计等宽数字网格；③ 通讯录删除图标按钮悬停/聚焦呈现 `destructive` 语义色警示。 |
| **U7** | **P1** | 发送记录/设置账号/侧栏计数与侧栏底部滚动 | 等宽数字（Tabular Numbers）与滚动边界 | ① 发送记录「计划时间」「时间」列、设置账号「最近收取」时间、侧栏未读数/存档数未全面应用 `tabular-nums`，数字纵向轻微错位；② 侧栏展开账号服务器文件夹后，滚动列表最底部的「+ 创建第一个标签」被底部固定功能栏遮盖一半文字。 | 为时间列、最近收取时间、侧栏/报告计数统一添加 `font-variant-numeric: tabular-nums`；为侧栏滚动区域增加底部内边距缓冲，确保滚动到底部时末项完整露出不被裁切。 |
| **U8** | **P2** | 全应用动效 | 颜色与交互状态 · 动效（`prefers-reduced-motion`） | `src/index.css` L4056 的 `@media (prefers-reduced-motion: reduce)` 仅停用了 `[data-slot="skeleton"]` 动画，未覆盖全局过渡与非必要动画。 | 补全 `@media (prefers-reduced-motion: reduce)` 兜底规则，降低/关闭非必要动画与过渡，同时保持加载状态可见与聚焦/滚动锚点稳定。 |

---

## 二、修复边界与不可回归红线

- **严守 UI 铁律**：全部使用现有 `src/components/ui/`（shadcn/ui `new-york` / Radix），禁止自造基础组件；不触碰 Rust 后端代码或真实邮件协议/存储逻辑。
- **严守既有专项约束**：保留 `docs/guidelines/ui-design.md` 中已定稿的尺寸与布局（设置页 `32px` 导航间距、`24px` 卡片间距、存档 `8px` 数字单位间距、删除区独立红色描边入口、工作台单线月历边框、写信 `8px` 边距与 `prepareCompose` 预览一致等）。
- **保持零回归**：须通过 `npm run check:ui`、`npm run check:i18n`、`npm run format:check`、`npm run build`、`npm run build:preview`、`npm run test:ci` 与 `git diff --check`。

---

## 三、修复与复验记录

### 1. Codex 修复阶段（`codex` / `gpt-6.2-sol` / `high`）

- **改动范围**：19 个前端文件（+379 / -76 行），未触及 `src-tauri/` Rust 后端代码。
  - 交互焦点与指针追踪：`src/lib/webview-keys.ts`、`src/lib/webview-keys.test.ts`、`src/App.tsx`、`src/components/ui/tabs.tsx`、`src/index.css`
  - 对比度与视觉层级：`src/components/ui/checkbox.tsx`、`src/index.css`
  - 表单与卡片一致：`src/components/compose-dialog.tsx`、`src/components/workspace-settings.tsx`、`src/components/archive-tier.tsx`
  - 加载骨架、空态与危险操作：`src/components/outbox-panel.tsx`、`src/components/outbox-panel.test.tsx`、`src/components/task-data-table.tsx`、`src/components/rules-panel.tsx`、`src/components/rules-panel.test.tsx`、`src/components/workbench.tsx`、`src/components/workbench.test.tsx`、`src/components/contacts-panel.tsx`
  - 国际化同步：`src/locales/zh-CN.json`、`src/locales/en.json`（新增 4 条工作台结构化空态双语文案）
- **自动门禁结果（全部退出 0）**：
  - `npm run check:ui`：通过
  - `npm run check:i18n`：通过
  - `npm run format:check`：通过
  - `npm run test:ci`：77 个测试文件、620 项全部通过（新增 U1/U5/U6 专项回归测试）
  - `npm run build`：通过
  - `npm run build:preview`：通过
  - `git diff --check`：通过

### 2. 复验结果（Chromium 1920×1050 & 1000×760，明暗双主题实测）

通过本地 `vite preview` 托管最新 `dist/` 构建并使用无头 Chromium（`zh-CN`，隔离配置目录）实测并逐页核对 16 组修复后截图与计算样式：

- **U1（焦点环）**：鼠标点击设置页与工作台 Tab 后 `data-pointer-focus` 生效，`activeTabOutline: none`、`boxShadow: none`，无黑框遮压选中态与绿底线；键盘 `ArrowDown` 切换 Tab 时清除 `data-pointer-focus`，呈现清晰单层品牌绿焦点环（`2px solid rgb(49, 95, 80)`）；顶栏深色模式按钮点击后无残留外框。
- **U2（对比度）**：未勾选 `Checkbox` 切换为 `--control-border`（浅色 `#828282` 实测 3.65:1、深色 `#8a8a8a` 实测 4.77:1，均达 WCAG 2.2 AA ≥ 3:1）；工作台周视图时间刻度由 `9px` 提升至 `11px` + `tabular-nums` + `--wb-secondary-text`（`oklch(0.4197 0 0)`），四象限轴标与空态提示清晰可读。
- **U3（写信三行左对齐）**：写信弹窗「发件人 / 收件人 / 主题」实测左文本坐标完全一致（`461.0px / 461.0px / 461.0px`）。
- **U4（设置页一致与留白）**：「应用偏好 → 工作台」标题多余图标已移除（`wbTitleHasIcon: false`）；「本地存档」与「附加存档」全部 6 项指标统一为 `数值 + <small>单位</small>`、`column-gap: 8px` 基线对齐与 `tabular-nums`，且精简指标区冗余横竖分隔线（保留校验说明分隔与删除区红色描边分隔）。
- **U5（发送记录加载骨架）**：`TaskDataTable` 在 `loadingLabel && !rows.length` 时展示 7 列表头 + 3 行 shadcn `Skeleton` 骨架行并保留 `sr-only` `role="status"` 提示，单元测试覆盖通过。
- **U6（空态与危险操作）**：过滤规则空态收敛为单一主按钮；工作台「事项」空表与「工作报告」空态升级为居中 shadcn `Empty`（含图标、标题与行动引导），工作报告统计改为 2 列 `tabular-nums` 网格；通讯录删除按钮增加 `.contact-delete` 悬停/聚焦 `destructive` 警示态。
- **U7（等宽数字与侧栏滚动缓冲）**：侧栏计数、发送记录时间列、账号最近收取时间、工作台时间刻度与报告统计均应用 `tabular-nums`；`1000×760` 下侧栏滚动区底部实测 `paddingBottom: 20px`，滚至底部末项完整露出。
- **U8（减弱动效）**：开启 `prefers-reduced-motion: reduce` 模拟后，实测按钮 `transitionDuration: 0s`、`animationDuration: 1e-05s`。

### 3. 第二、三轮扩展优化（U9–U11）与全量 70 项规范收尾

- **U9（设置页副标题与冗余小字瘦身）**：Codex 删除 8 条冗余副标题（设置顶栏 1 条、6 个分类标题 6 条、通知卡片头 1 条）与 23 对废弃双语键，大幅压缩「界面语言 / 工作台 / 后台检查 / 阅读缓存 / 网络代理 / 默认应用 / 邮件签名 / AI 智能助手」自解释小字；实测 1920×1050 下「AI 智能助手」整卡连同保存按钮一屏完整呈现，「应用偏好」首屏直达「阅读缓存」选项。
- **U10（边缘渐隐遮罩）**：新增 `src/lib/scroll-fade.ts` 及专项单测，为主侧栏纵向滚动区（`18px`）与写信富文本窄窗横向滚动工具栏（`16px`）接入透明通道 CSS `mask-image` 动态边缘渐隐（`2px` 容差，滚动到起点/终点或无溢出时自动关闭）。
- **U11（全量 70 项规范最后 5 项微细节收尾）**：Codex 完成 16 个前端文件打磨并通过全部 7 项门禁（**78 个测试文件 / 626 项通过**）：
  1. `text-balance`：页面主标题（`.settings-section-heading h2` 等）、空态标题与弹窗/确认框标题接入 `text-wrap: balance`（实测 `h2TextWrap: balance`）。
  2. `press-state`：按钮与侧栏导航接入无缩放按压底色反馈（点击尺寸不变、无模糊抖动，减弱动效模式正常生效）。
  3. `easing`：`:root` 定义统一自然缓动曲线 `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` 及快/常时长变量。
  4. `loading-button`：高频异步按钮按当前语言最长状态文案预留稳定宽度（实测中文刷新 `81px`、英文 `107.04px`，切换忙碌态零宽跳）。
  5. `edge-fade` 扩展与 `hover-reveal` 键盘可达性：设置右侧滚动区（`.settings-panels`）与邮件列表接入 18px 边缘渐隐；邮件列表复选框键盘焦点实测 `opacity: 0 → 1`，`Space` 可直接勾选且邮件文字零位移。
- **全量 70 项规范覆盖状态**：`docs/UI_DESIGN_GUIDELINES.md` 完整收录 Topinspo Design Vocabulary **70 / 70 项词条**（7 大类 + 文案克制原则）——当前项目已涉足的 **57 项**全部达标/补齐，其余 **13 项**属未来新增模式已提前立规。

### 4. macOS 原生 WKWebView 隔离实包复验（2026-11-25）

为避免影响本机已安装的 `/Applications/雁信.app`（v0.1.45，`dev.maildesk.desktop`），基于当前 `dist/` 与未改动的 `src-tauri/` 代码，采用隔离应用标识 `dev.maildesk.preview0145`（`雁信预览.app`，`1440×900`）构建并启动原生 macOS WKWebView 实包，只读采集 14 组稳定帧截图核验，随后已停止进程并彻底删除临时 `.app` 与 `~/Library/Application Support/dev.maildesk.preview0145`：

- **设置页瘦身与留白一致（U4 + U9）**：原生 WKWebView 中确认 8 条冗余副标题已全部消失；「本地存档」与「附加存档」指标统一为 `数值 + 8px 间距 + 单位` 基线对齐且无多余横竖分隔线；「应用偏好 → 工作台」标题图标已移除，整页信息密度大幅清爽。
- **18px 透明通道边缘渐隐（U10 + U11）**：原生 WKWebView 实测 `-webkit-mask-image` 生效，浅色模式「本地存档」底部、「应用偏好」滚动后顶部与底部、「阅读与写信」底部，以及深色模式设置页底部均自然融入背景底色，无硬切边与遮色块。
- **工作台对比度、结构化空态与等宽数字（U2 + U6 + U7）**：周视图时间刻度升级为清晰 `11px` 等宽数字（`08:00`–`15:00`）且保留红色当前时间线；四象限轴标与提示清晰可读；「事项」空表与「工作报告」空态呈现居中 shadcn `Empty` 结构，工作报告左侧统计改为 2 列 `tabular-nums` 网格。
- **焦点环与 WebKit 实测边界（U1 如实记录）**：
  - 原生 WKWebView 中已彻底消除旧版 v0.1.45 粗黑三重叠框，呈现统一的单层品牌绿焦点环（浅色 `#315f50` / 深色 `#b7d7c2`），不再压盖选中底线。
  - 注：自动化实机操作经由 macOS Accessibility `AXPress` 触发（不派发 DOM `pointerdown`），故 `trackPointerFocus` 按辅助/键盘激活显示单层品牌绿环；真实物理鼠标点击触发 `pointerdown` 隐藏焦点环已在 Chromium 实测通过，macOS WKWebView 物理鼠标点击与「写邮件三行左对齐 / 签名 Checkbox 对比度」（隔离 0 账号实包点击写邮件进入添加账号弹窗）可待本地正式带账号运行环境顺手点验。

### 5. 尚未验证范围

- 全部改动（规范文档 + U1–U11 共 36 个前端文件）已提交并快进合入本地 `main`（尚未推送远端）。
- **未验证项**：macOS 原生 WKWebView 带账号环境下的真实物理鼠标点击焦点环与写信弹窗/签名勾选框实机复核、**Windows 10/11 原生 WebView2 实机复验、云端构建（CI / Release）及正式发版**均未执行，需后续按流程分别验证。
