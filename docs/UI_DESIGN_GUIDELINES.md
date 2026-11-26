# 雁信 UI 设计规范（全量 70 项设计基线）

适用于雁信桌面客户端（macOS / Windows）与共用界面的 Web 演示。新增界面、修改现有界面和 UI 走查均以本页为通用基线，具体页面与平台行为遵循 [UI 设计与交互专项规范](guidelines/ui-design.md) 与 [AGENTS.md](../AGENTS.md)。

本规范完整收录 [Topinspo Design Vocabulary](https://www.topinspo.design/vocabulary) 全部 **70 项**视觉与交互设计词条（含当前尚未启用、未来可能新增的模式，提前立规避免风格漂移），并结合雁信桌面窗口、邮件阅读、工作台与 shadcn/ui 体系给出可执行约束。

> **核心目标**：界面应克制、清晰、高信噪比，让用户一眼看清当前位于哪个账号或文件夹、正在处理哪一项、主操作在哪里；邮件、设置、写信与工作台各自保持适配任务的信息密度，同类控件与反馈统一表达，消除“AI 样板感”。

---

## 1. 排版与空间布局（6 项）

| 术语（Topinspo） | 雁信执行规则 |
| --- | --- |
| [内边距（Padding）](https://www.topinspo.design/vocabulary?term=padding) | 容器用统一内边距与内容留出呼吸感，卡片/弹窗/列表不贴边挤压；视觉重心保持上下左右平衡（如按钮水平内边距通常大于垂直内边距）。 |
| [间距（Gap）](https://www.topinspo.design/vocabulary?term=gap) | 同级元素间距统一由父容器的 `gap` 管理，避免在子元素上零散叠加 `margin`。设置页沿用 `32px` 导航间距与 `24px` 卡片间距，存档数字与单位间距为 `8px`。 |
| [行高（Line Height）](https://www.topinspo.design/vocabulary?term=line-height) | 标题使用紧凑行高（`1.2–1.35`），正文与说明段落使用舒适行高（`1.5–1.65`），保证中文与英文混排连续阅读不粘连、不松散。 |
| [邻近性（Proximity）](https://www.topinspo.design/vocabulary?term=proximity) | 相关联的标签、说明与控件彼此靠近，独立功能组之间留出明显更大间隔；用户无需画框即可凭借距离识别归属。 |
| [留白（Whitespace）](https://www.topinspo.design/vocabulary?term=whitespace) | 主动保留节奏性留白，不用无意义边框、装饰卡片或冗长说明填满空间；窄窗与宽窗均保证内容区呼吸感。 |
| [分隔线与留白（Divider vs. Space）](https://www.topinspo.design/vocabulary?term=divider-vs-space) | 同组内优先通过对齐和留白建立分组，仅在需要明确边界的语义区隔（如破坏性删除区、密集数据网格）使用细分隔线；共享边界只由单一容器绘制，不双线叠画（如工作台月历首行首列）。 |

---

## 2. 文字排版与信息呈现（9 项 + 文案克制原则）

| 术语（Topinspo） | 雁信执行规则 |
| --- | --- |
| [内容层级（Hierarchy）](https://www.topinspo.design/vocabulary?term=hierarchy) | 通过字号、字重与颜色深浅拉清主信息、正文与次级元信息；邮件行优先突出发件人与主题，日期、账号与摘要退居次层。 |
| [字重（Font Weight）](https://www.topinspo.design/vocabulary?term=font-weight) | 仅用 2–3 档克制字重（常规 400 / 中等 500 / 半粗 600）区分层级；紧凑行内优先用字重表达未读与选中，避免全屏加粗。 |
| [字距（Tracking）](https://www.topinspo.design/vocabulary?term=tracking) | 大号标题与大数字适度微收字距（如 `-0.015em` 至 `-0.03em`）增强紧凑感；小号大写标签或缩写略微放宽字距提升辨识度；中文正文保持自然字距不刻意压缩。 |
| [等宽数字（Tabular Numbers）](https://www.topinspo.design/vocabulary?term=tabular-numbers) | 时间、日期、未读计数、进度、存档大小、表格时间列与统计数字一律启用 `font-variant-numeric: tabular-nums`，并按最长字符串预留稳定宽度，防止动态变化引起横向跳动。 |
| [文本平衡（Text Balance）](https://www.topinspo.design/vocabulary?term=text-balance) | 多行页面标题、空态标题与确认弹窗标题使用 `text-wrap: balance`，长说明使用 `text-wrap: pretty`，避免末行孤字。 |
| [行数截断（Line Clamp）](https://www.topinspo.design/vocabulary?term=line-clamp) | 邮件列表主题/摘要、卡片说明与表格单元格按容器约束单行或定行省略，并始终保留悬停或键盘可访问的完整内容入口。 |
| [基线对齐（Baseline Alignment）](https://www.topinspo.design/vocabulary?term=baseline-alignment) | 同行不同字号元素（如大号存档数字与小号单位、主标题与副标签）按文字基线（`align-items: baseline`）对齐，不简单垂直居中导致视觉漂浮。 |
| [快捷键提示（Shortcut Hint）](https://www.topinspo.design/vocabulary?term=shortcut-hint) | 快捷键提示采用低强调 `<kbd>` 样式紧随动作或置于搜索框右侧，并按当前操作系统显示原生按键符号（macOS 用 `⌘`，Windows 用 `Ctrl`），不喧宾夺主。 |
| [中间省略（Middle Truncation）](https://www.topinspo.design/vocabulary?term=middle-truncation) | 附件文件名、本地路径等头部与尾部（扩展名/末级目录）同等重要的长文本，优先采用中间省略保留扩展名与关键尾段，同时提供完整值悬停提示。 |
| **克制文案与反冗余副标题（雁信补充）** | 页面标题与分类标题不叠加复读下级卡片名称的副标题；控件名、选项或占位符已能自解释时不再配一整句解释小字。小字说明仅保留非显而易见的行为边界、安全/隐私约定或破坏性后果，单处不超过一句短句，不在相邻层级重复同一提示。 |

---

## 3. 颜色与交互状态（6 项）

| 术语（Topinspo） | 雁信执行规则 |
| --- | --- |
| [强调色（Accent）](https://www.topinspo.design/vocabulary?term=accent) | 全应用克制使用单一品牌色系（雁信低饱和松绿系用于导航/邮件选中态与焦点指示），大面积保持中性灰白/深灰底面，让用户一眼聚焦当前选中与关键行动点。 |
| [对比度（Contrast）](https://www.topinspo.design/vocabulary?term=contrast) | 以实际渲染背景在浅色与深色双主题成对核验：普通文字 ≥ WCAG 2.2 AA **4.5:1**，大号文字 ≥ **3:1**，控件边框/复选框/图标/焦点环等非文本视觉信息与相邻颜色 ≥ **3:1**。[WCAG 文字](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [WCAG 非文本](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) |
| [弱化文字（Muted Text）](https://www.topinspo.design/vocabulary?term=muted-text) | 次级说明、时间戳与占位信息使用语义弱化色（`--muted-foreground` / 专用次级变量），确保层级明显退后于主正文的同时仍满足可读对比度，绝不可淡到难以辨认。 |
| [语义色（Semantic Color）](https://www.topinspo.design/vocabulary?term=semantic-color) | 成功、警告、危险/失败与信息状态各自对应固定语义色，并**必须搭配文字或图标共同表达**（不单靠颜色传递状态）；破坏性删除操作在悬停/聚焦或确认按钮处明确呈现 `--destructive`。 |
| [明暗阶梯（Tint and Shade）](https://www.topinspo.design/vocabulary?term=tint-and-shade) | 深色模式不是简单反色，而是按背景 → 侧栏 → 卡片 → 浮层逐级微调明度阶梯，配合低透明边框与柔和高光维持层次；浅色与深色均统一维护在 [主题变量](../src/index.css)。 |
| [禁用状态（Disabled State）](https://www.topinspo.design/vocabulary?term=disabled-state) | 不可用控件通过降低透明度、禁用指针与禁止交互清晰表达状态，并尽可能保留可聚焦说明（如 Tooltip 解释为何不可点击），不让用户困惑为何点不动。 |

---

## 4. 曲面、容器与视觉层次（13 项）

| 术语（Topinspo） | 雁信执行规则 |
| --- | --- |
| [圆角（Border Radius）](https://www.topinspo.design/vocabulary?term=border-radius) | 全应用统一复用命名圆角变量（`--radius-sm/md/lg/xl`），同类控件保持一致圆角尺度，避免同一页面混用尖角、中圆角与胶囊造成风格割裂。 |
| [同心圆角（Concentric Radius）](https://www.topinspo.design/vocabulary?term=concentric-radius) | 嵌套曲面遵循 `外圆角 ≈ 内圆角 + 内边距` 关系，避免内外圆角相同导致转角间隙不均；优先选用贴合内缩量的现有圆角档位。 |
| [嵌套卡片（Nested Cards）](https://www.topinspo.design/vocabulary?term=nested-cards) | 一项设置或一种资源集中在一张卡片内，内部优先用标题、留白与弱背景色分组，避免“卡片里再套一层带粗边框的卡片”造成盒子套娃。 |
| [细边框（Hairline Border）](https://www.topinspo.design/vocabulary?term=hairline-border) | 卡片、输入框与面板边界使用低对比细边框（浅色轻灰、深色低透明白线）勾勒轮廓，在视网膜屏上保持锐利克制，不画厚重黑框。 |
| [视觉对齐（Optical Alignment）](https://www.topinspo.design/vocabulary?term=optical-alignment) | 图标、三角形播放键、带内边距的下拉触发器与输入框文本须按**视觉边缘**而非盒模型边缘对齐（如写信页发件人下拉文本与下方收件人/主题输入框严格同一左基线）。 |
| [头像堆叠（Avatar Stack）](https://www.topinspo.design/vocabulary?term=avatar-stack) | 未来若展示多人会话/协作者头像组，采用固定负间距叠放加同底色描边隔离，超上限折叠为 `+N` 等宽数字计数徽标。 |
| [图标容器（Icon Container）](https://www.topinspo.design/vocabulary?term=icon-container) | 功能标识、空态图标或服务商图标放入统一尺寸与圆角的轻底色容器中，图标相对容器保持舒适留白（通常占容器宽高的 45%–55%），不贴边放大。 |
| [计数徽标（Badge Counter）](https://www.topinspo.design/vocabulary?term=badge-counter) | 未读数、对话数与待处理计数使用紧凑等宽数字徽标；零值时按场景隐藏或中性弱化，避免无意义红点制造焦虑。 |
| [分层阴影（Layered Shadow）](https://www.topinspo.design/vocabulary?term=layered-shadow) | 平面卡片（设置/列表）保持无阴影轻边框；Popover、Dropdown、Dialog、Toast 等浮层采用多层柔和阴影（近距轮廓阴影 + 远距环境漫射）清晰区分 Z 轴层级。 |
| [遮罩层（Scrim）](https://www.topinspo.design/vocabulary?term=scrim) | 模态对话框与抽屉背后的遮罩层保持适度半透明压暗（兼顾明暗主题），突出前景弹窗并明确背景暂时不可操作，不遮黑成死黑一片。 |
| [边缘渐隐（Scroll Fade / Edge Fade Mask）](https://www.topinspo.design/vocabulary?term=edge-fade) | 长列表、侧栏导航、长摘要及窄窗横向可滚工具栏在存在可滚动溢出时，优先用 CSS `mask-image` 在对应溢出侧施加柔和渐隐遮罩（约 `16px–20px`），既避免文字被容器硬切也提示可滑动；滚至起点或终点时对应侧渐隐消失，采用透明通道原生兼容浅/深主题且不阻碍点击。 |
| [吸顶头部（Sticky Header）](https://www.topinspo.design/vocabulary?term=sticky-header) | 长内容或表格滚动时，关键工具栏、表头、写信收件栏与阅读标题保持固定/吸顶，滚动发生后以轻边界与滚动内容区分，不随正文滚出视口。 |
| [悬浮操作栏（Floating Bar）](https://www.topinspo.design/vocabulary?term=floating-bar) | 多选批量操作、阅读区悬浮状态胶囊与未来上下文悬浮条以明确边距悬浮或接替原栏位高度，不推动正文布局跳动，也不遮挡底部核心操作。 |

---

## 5. 动效与微交互（9 项）

| 术语（Topinspo） | 雁信执行规则 |
| --- | --- |
| [缓动曲线（Easing）](https://www.topinspo.design/vocabulary?term=easing) | 界面过渡使用自然加减速曲线（入场 `ease-out` 快速响应、轻柔落定；退场略快于入场），禁用生硬线性（`linear`）过渡（持续旋转加载图标除外）。 |
| [方向性动效（Directional Motion）](https://www.topinspo.design/vocabulary?term=directional-motion) | 抽屉滑入、步骤切换与面板展开的位移方向须与空间逻辑一致（右侧面板从右进出、底部弹窗向上展开），帮助用户建立空间心智。 |
| [弹簧物理（Spring）](https://www.topinspo.design/vocabulary?term=spring) | 拖拽归位、开关切换与轻弹层若引入弹簧动效，保持高阻尼、短时长（`150–250ms`），避免夸张回弹拖慢高频办公操作。 |
| [错峰入场（Stagger）](https://www.topinspo.design/vocabulary?term=stagger) | 列表批量加载或卡片组入场如需错峰，单项延迟极短（`20–40ms`）且设总时长上限；高频切换文件夹或大列表滚动禁止叠加错峰延迟导致粘滞。 |
| [按压反馈（Press State）](https://www.topinspo.design/vocabulary?term=press-state) | 按钮与可点卡片在按下瞬间提供即时视觉反馈（微调底色/明度或轻微按压感），不改变布局占位；鼠标点击后不残留刺眼黑色焦点框，键盘焦点导航保持清晰单层焦点环。 |
| [共享元素过渡（Shared Element）](https://www.topinspo.design/vocabulary?term=shared-element) | 分段控件选中滑块或视图切换指示器在保持帧率稳定且尊重 `prefers-reduced-motion` 前提下可平滑过渡，绝不因动画阻塞点击响应。 |
| [起点感知动效（Origin-Aware Motion）](https://www.topinspo.design/vocabulary?term=origin-aware-motion) | Popover、Dropdown 与 Tooltip 从触发按钮的锚点方向展开并设置对应 `transform-origin`，让浮层与触发源视觉相连。 |
| [悬停显现（Hover Reveal）](https://www.topinspo.design/vocabulary?term=hover-reveal) | 列表行低频快捷操作（如勾选框、行尾辅助动作）平时隐藏保持界面洁净，悬停或行内聚焦时显现；**必须提供等价键盘聚焦/右键菜单入口**，且显现时不挤压或抖动同行文字。 |
| [加载按钮（Loading Button）](https://www.topinspo.design/vocabulary?term=loading-button) | 异步提交按钮进入忙碌态时，原地切换加载图标/忙碌文案并禁用重复提交，同时尽量保持按钮宽度稳定不引起周围按钮跳动。 |

> **减弱动效铁律**：所有动效必须全局尊重 `@media (prefers-reduced-motion: reduce)`，减弱/关闭非必要过渡与装饰动画，并始终维持操作位置、焦点与滚动锚点稳定。

---

## 6. 组件选型与信息架构（16 项）

所有基础控件优先从 [现有 shadcn/ui 组件](../src/components/ui/) 选取与组合，缺失时从官方 registry 引入 `new-york` 风格，固定文案同步 `src/locales/` 双语。

| 术语（Topinspo） | 雁信执行规则 |
| --- | --- |
| [按钮层级（Button Hierarchy）](https://www.topinspo.design/vocabulary?term=button-hierarchy) | 同一操作区域只保留 **1 个明确主按钮**（如「发送邮件」「新建规则」「保存签名」）；次操作用 `outline` / `secondary`，低频动作收拢至 `ghost` 或菜单；危险动作使用 `destructive` 描边或实心确认。 |
| [点击区域（Touch Target）](https://www.topinspo.design/vocabulary?term=touch-target) | 图标视觉可紧凑，但实际可点击命中区需覆盖整个按钮（常规操作 ≥ `32px`，紧凑工具栏 ≥ `28px` 且与相邻按钮留出安全间距，列表复选框通过伪元素扩展命中区）。 |
| [空态（Empty State）](https://www.topinspo.design/vocabulary?term=empty-state) | 按真实原因提供居中结构化空态（图标 + 简短结论 + 可执行下一步引导）：无账号引导添加、无搜索结果提供清除筛选/关键词、无工作事项引导添加记录，不留左上角一行干瘪小字。 |
| [行内校验（Inline Validation）](https://www.topinspo.design/vocabulary?term=inline-validation) | 校验错误紧贴出错字段下方显示并保留用户输入，不弹窗打断或清空表单；提交时仍复核业务约束（定时发送过去时间沿用静默禁用、越界回退与自动推进）。 |
| [骨架屏（Skeleton）](https://www.topinspo.design/vocabulary?term=skeleton) | 首次加载使用与真实布局（表头列数、行高、段落比例）相近的 shadcn `Skeleton` 占位，防止加载完骤然展开跳动；已有内容刷新时在局部显示忙碌态并保留当前内容与滚动位置。 |
| [Popover 与 Tooltip（Popover vs. Tooltip）](https://www.topinspo.design/vocabulary?term=popover-vs-tooltip) | `Tooltip` 仅承接简短只读说明或快捷键提示；凡包含任何可点击控件、筛选条件或日期/定时选择，一律使用 `Popover` 或菜单。 |
| [弹窗与抽屉（Modal vs. Drawer）](https://www.topinspo.design/vocabulary?term=modal-vs-drawer) | 破坏性/关键确认用 `AlertDialog`，独立多步表单用 `Dialog`；需参照当前主页面上下文编辑的内容（如工作台事项）使用右侧抽屉或并排面板；关闭后焦点返回触发控件。 |
| [标签页与分段控件（Tabs vs. Segmented）](https://www.topinspo.design/vocabulary?term=tabs-vs-segmented) | 并列功能分类切换使用 `Tabs`（如设置六类、工作台四视图，切分类保留未保存表单）；对同一批记录切换展示维度（如全部/未读、年/月/周/日、表格/看板）使用分段控件并延续共享筛选。 |
| [开关与复选框（Switch vs. Checkbox）](https://www.topinspo.design/vocabulary?term=switch-vs-checkbox) | `Switch` 用于即时生效或单项功能启用/停用；`Checkbox` 用于多选集合、批处理范围或随表单统一提交的选项；保存时机通过明确按钮或状态文本交代。 |
| [命令面板（Command Palette）](https://www.topinspo.design/vocabulary?term=command-palette) | 未来若新增全局快捷命令面板（如 `⌘K` 跨功能跳转/动作），基于 `cmdk`（shadcn `Command`）实现，支持键盘上下、分组过滤、快捷键提示与即时回退焦点。 |
| [便当格布局（Bento Grid）](https://www.topinspo.design/vocabulary?term=bento-grid) | 未来若构建概览/仪表盘卡片网格，基于统一栅格列宽与等比间距排布，严控信息密度，避免无实际价值的装饰性大卡片空占桌面空间。 |
| [渐进展开（Progressive Disclosure）](https://www.topinspo.design/vocabulary?term=progressive-disclosure) | 首屏只呈现高频核心字段与动作，低频技术详情（如发件诊断、后台同步日志、服务器目录操作）通过行内 `+N` 展开、折叠卡片或行尾菜单按需露出。 |
| [组合搜索框（Combobox）](https://www.topinspo.design/vocabulary?term=combobox) | 长列表候选（如收件人补全、AI 模型列表选择）统一使用 shadcn `Command` + `Popover` 组合，支持输入筛选与手填，禁用原生 `datalist` 或超长下拉。 |
| [输入附加元素（Input Affix）](https://www.topinspo.design/vocabulary?term=input-affix) | 搜索图标、快捷键徽章、固定单位、密码显隐与数字时分微调按钮统一用 shadcn `InputGroup` 贴合封装，不把图标浮在输入框外或拆散成孤立碎片。 |
| [拆分按钮（Split Button）](https://www.topinspo.design/vocabulary?term=split-button) | 主动作与紧密关联变体（如阅读页「回复」+ 下拉「全部回复」）采用视觉统一的组合/拆分按钮，主区点击直接执行默认动作，下拉触发区清晰分隔且独立可聚焦。 |
| [面包屑（Breadcrumb）](https://www.topinspo.design/vocabulary?term=breadcrumb) | 未来若引入多层嵌套目录或子视图跳转，使用简洁面包屑标明当前路径与返回层级，中间过长层级按需折叠省略，不替代主侧栏导航。 |

---

## 7. AI 交互与智能助手模式（11 项）

本组规范统一约束当前已上线的**写信 AI 助手、邮件翻译、AI 摘要、AI 工作报告**及未来新增的 Agent / AI 能力，并与 [AI 功能与 Agent 协作规范](guidelines/ai-and-agent.md) 协同生效。

| 术语（Topinspo） | 雁信执行规则 |
| --- | --- |
| [提示词输入框（Prompt Composer）](https://www.topinspo.design/vocabulary?term=prompt-composer) | 写信 AI 助手指令区基于 shadcn `InputGroup` 与 `src/components/ai-elements/prompt-input.tsx`，保持多行自适应输入、清晰发送/停止按钮与简洁占位提示，不嵌入邮件正文编辑器内部。 |
| [流式文本（Streaming Text）](https://www.topinspo.design/vocabulary?term=streaming-text) | AI 生成期间保持单套清晰运行中反馈（`ChainOfThought` + `Shimmer`，无多余尾注圆点），输出平滑追加且不抢夺用户手动回滚查看的滚动位置。 |
| [思考过程折叠（Thinking Disclosure）](https://www.topinspo.design/vocabulary?term=thinking-disclosure) | 若接入带推理过程（reasoning）的模型，思考内容默认折叠收纳、仅展示轻量状态摘要，点击按需展开，不挤占最终正文建议或回答的首屏视野。 |
| [引用来源胶囊（Citation Pill）](https://www.topinspo.design/vocabulary?term=citation-pill) | AI 摘要中的时间提醒或未来跨邮件问答引用，必须附带可核对的原文证据/来源锚点（如摘要原文证据、点击直达源邮件），绝不凭空编造来源。 |
| [斜杠命令（Slash Command）](https://www.topinspo.design/vocabulary?term=slash-command) | 未来若在写信助手或编辑器提供 `/` 快捷指令菜单，采用紧凑浮层支持键盘筛选与 `Escape` 恢复原正文焦点，不干扰正常输入带 `/` 的网址或日期。 |
| [差异预览（Diff View）](https://www.topinspo.design/vocabulary?term=diff-view) | 写信 AI 修复与改写必须先通过清晰差异/预览让用户核对修改范围，由用户显式点击「应用」才写入当前草稿；Diff 装饰绝不进入草稿存储或发件正文。 |
| [撤销提示（Undo Toast）](https://www.topinspo.design/vocabulary?term=undo-toast) | 撤销提示仅用于具备可靠恢复能力的操作（如应用写信修复后的独立撤销、定时/延时发件撤回）；真实发件与不可逆删除沿用显式确认与恢复边界，不伪造可撤销假象。 |
| [推荐提示词（Suggested Prompts）](https://www.topinspo.design/vocabulary?term=suggested-prompts) | 写信 AI 助手空对话态可提供 2–4 个贴合邮件场景的简短快捷指令胶囊（如润色、精简、改正式语气），点击即填即发，有对话后自动退让不占空间。 |
| [工具调用步骤（Tool Call Steps）](https://www.topinspo.design/vocabulary?term=tool-call-steps) | 未来若 AI 助手具备多步检索/工具调用，以紧凑可折叠步骤条展示执行状态与耗时（类似后台任务日志边界），隐藏原始敏感负载与技术堆栈。 |
| [上下文标签（Context Chips）](https://www.topinspo.design/vocabulary?term=context-chips) | 明确以紧凑可移除标签展示 AI 当前读取的上下文范围（如当前单封正文/选区），严守隐私边界——未经用户触发不隐式附带其他邮件、附件或邮件头。 |
| [审批确认门（Approval Gate）](https://www.topinspo.design/vocabulary?term=approval-gate) | 凡涉及对外发信、批量归类/删除、修改账号设置或写入工作台日程的 AI 建议（如摘要时间提醒加入日历、写信修复应用），必须设置显式人工确认门，AI 绝不静默自动执行副作用。 |

---

## 8. 桌面布局与验收清单

按**实际内容区宽度**决定控件何时换行、切换布局或滚动（窗口总宽相同，拖宽侧栏同样可能让内容区进入窄布局）。固定工具栏保留关键动作，表格保持独立横向滚动，编辑区与阅读区各自守住滚动边界；使用真实业务长值（多收件人、长扩展名附件、英文长按钮、长日期范围）检验。

- [ ] **开工定界**：说明当前问题、涉及页面、对照的规范词条与预期改善；视觉调整保留同数据、同尺寸前后对比画面。
- [ ] **多维视觉检查**：在开发预览核对浅色、深色、常规宽度、最窄支持宽度（`1000px`）及布局切换临界宽度，覆盖简体中文、English 与长内容。
- [ ] **全状态与键鼠交互**：核对默认、悬停、键盘聚焦、鼠标点击、按下、选中、禁用、加载骨架与异步反馈；核对焦点返回、实际点击区、弹层层级、边缘渐隐显隐与滚动归属。
- [ ] **文案信噪比核查**：确认没有新增报菜名式副标题、自解释控件废话小字或相邻层级重复提示。
- [ ] **原生与平台实测**：涉及 WebView 布局、拖拽、菜单、焦点环、链接或原生窗口时，在 macOS / Windows 对应原生窗口实测并分别记录平台与验证方式（浏览器预览、计算样式、原生实机不得混记）。
- [ ] **自动门禁与记录**：执行 `npm run check:ui`、`npm run check:i18n`（涉及文案）、`npm run format:check`、相关交互测试与 `npm run build`，并在 [开发记录](DEVELOPMENT_STATUS.md) 如实写下本轮已验证与未验证范围。
