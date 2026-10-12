# 富文本正文与 Simple Editor 工具条

2026-10-12，`codex/rich-body-images` 从 main/a030672 接续；本分支与相关界面修复已作为 0.1.12 Alpha 正式发布供下载测试，固定源码 `996738d` 与资源核验见 [发布工作点](RELEASE_012_WORKING.md)。用户下载后的真实互发、草稿重开和原位升级继续独立验收。

## 已完成源码

- 新建完整写信/回复/转发默认富文本；旧草稿格式保留，对话简短回复仍为独立纯文本。
- 使用 Tiptap 3.31.3 官方 StarterKit/Image/TextStyle/FontFamily/FontSize/Highlight/Subscript/Superscript/TextAlign/TaskList/TaskItem/FindAndReplace；不是自写编辑器引擎，不引入付费模板或云上传服务。工具条只组合 shadcn/ui。
- 标题H1–H4、三种列表、引用/代码块、粗斜下划线/删除线/行内代码、高亮、上下标、四对齐、分割线/清格式、撤销重做、插图、查找替换及现有全局明暗主题。任务列表发送时转成静态勾选标识，草稿保留编辑结构；查找装饰不进入发送HTML。
- 字体菜单按中文/英文分组，宋体/楷体/黑体/仿宋/微软雅黑保留，新增 Arial/Helvetica/Times New Roman/Georgia/Verdana/Tahoma/Trebuchet MS/Courier New，均指定回退，字号8至72pt含10.5pt。单行图标菜单和当前值提示；窄区横向滚动。字体列表宽176px、字号104px、单项26px、菜单最大320px并滚动；查找替换256px宽、30px输入和10px组间距。菜单关闭焦点回到正文；字体名称识别兼容HTML序列化引号变化。
- 原生选择与正文内拖拽通过会话校验的 `read_body_images`，读取前后核对窗口及发送状态；PNG/JPEG/GIF/WebP按字节识别，单张10MB/每批20张/正文50MB。图片以data URI保存独立草稿快照，现有发送层转换related/cid并按原字节保留。异步准备阻止发送/定时/关闭，旧窗口迟到结果丢弃；正文外拖入作为普通附件。Pages/示例禁用真实文件读取。
- 编辑器错误边界保留父窗口草稿/格式选择；前期HMR出现过空页面，本轮稳定实例及浏览器无新错误，未将该现象的根因认定为已完全定位。

## 实际验证

- `npm test -- --run`：249项/43文件通过（工具条完成后的全量）；最新菜单密度改动后 `npx vitest run src/components/rich-editor.test.tsx src/lib/rich-body.test.ts` 8项通过。
- 后端同轮 `npm run test:rust`：307通过/1独立性能项忽略；其后仅前端/文档改动。覆盖会话失效/伪装类型/超限/链接文件、Store重开后图片字节/字体与最终cid MIME；React覆盖粘贴、选择器迟到返回与示例文件隔离。
- 最新 `npm run check:ui`、`npm run build`、`npm run build:preview`通过。富文本chunk约595kB、主chunk约949kB，Vite仍有500kB体积提示；编辑器按需加载，不宣称体积优化已完成。
- 浏览器虚构数据实际选楷体/18pt、改宋体、居中/黄色高亮、Alpha全部替换Beta，正文HTML保持相应格式且焦点回正文；字体现有项选中状态正确。26按钮同一Y，工具条高44px；把编辑内容区域约束为620px时scrollWidth973px，仍一行。缩放后的字体菜单约99×304px、单项24.7px，查找替换约243×251px（CSS逻辑目标104/26/256），真实绘制可见。TaskSpace18已结束。
- 稳定 `npm run desktop` 原生预览：默认富文本、单行图标、紧凑字号菜单截图确认；工具条原生选择 `/tmp/anser-rich-live-20261012/body-image.png` 成功显示绿色/黄色虚构PNG，自动保存成功，主题“雁信联调 20261012-RICH-IMAGE 草稿验收”。没有SMTP提交，没有修改签名/账号配置/真实存档。截图仅用于工具内检查，未加入仓库或文档。

## 2026-10-12 追加：英文字体

- 用户指出缺少英文字体，已补上述8种英文选项；默认/中文/英文分组呈现，仍单行图标及当前选项提示。字体菜单宽176px以完整显示英文名称，最大320px滚动，不扩大字号/其他菜单。
- 本轮18项相关前端回归、UI、生产构建通过；字体回归遍历全部13字体，核对中英文正文、草稿重建、最终发送HTML中的完整family回退链。原生开发预览已看到中文/英文分组及8英文选项，选择Arial后焦点回正文，再开菜单确认Arial选中；未发送邮件，收件端字体可用性仍独立待验收。

## 未完成与下一入口

2026-10-12 独立更新中心修复：`app-updates.tsx` 以前纯文本展示 release body，现由 `lib/release-notes.ts` 安全解析 Markdown 并在更新弹窗排版，外链使用系统浏览器入口。相关12项测试、UI/生产/Pages构建及格式/diff检查通过；浏览器虚构示例 DOM/列表样式核对通过，截图超时；真实更新包/原位升级未验收。此修复与本分支富文本未提交工作同处一个工作树，不改变下列正文图片与互发待办。

2026-10-12 正文图片内文字误选：WebKit 会把截图中的字识别成可选择内容，编辑器中 `⌘A` 曾连图片里的文字一起高亮。仅对 `.rich-body img` 增加 `-webkit-user-select:none` 和 `user-select:none`，正文其他文本仍能正常选取。原生开发预览用现有草稿截图测试：`⌘A` 只选中图片前后实际正文，图片作为整体节点参与选择，图内文字无独立蓝色选区；右键“调整图片尺寸/恢复原始尺寸”仍可打开；测试后清除选区，草稿内容/发送状态不变。相关 `npx vitest run src/components/rich-editor.test.tsx src/lib/rich-image-size.test.ts` 7项、`npm run check:ui`、`npm run format:check`、`git diff --check`、`npm run build`、`npm run build:preview` 通过。若截图文件本身已带蓝色高亮像素，样式不能从原图抹除。

2026-10-12 全局选中文字对比度核查：`src/index.css` 原 `::selection` 只设接近白色的 `--secondary` 背景，而 shadcn Input 设浅色选中文字，图片宽度数字被选中后几乎不可见。现统一为 `--primary` 背景与 `--primary-foreground` 文字，覆盖应用主文档内的输入框、文本域、富文本与普通文本；没有改动邮件正文 iframe 内的发件人样式。浏览器演示页实际计算了数字输入框、文本域、可编辑富文本和普通文本两主题共8组，选中文字对比度浅色17.2:1、深色14.2:1；实际搜索、收件人、主题及富文本控件的选中计算色核对为预期值。原生开发预览重开虚构图片草稿，尺寸对话框宽度数字 `⌘A` 后实绘为深底浅字，可清楚辨认；按 Escape 取消并关闭草稿，无尺寸/内容改动。源码仍未提交/发布。

2026-10-12 图片右键菜单文字修正：原“调整图片尺寸…”末尾省略号是源码字面内容，并非宽度裁切；已去掉，使两项均以完整六字显示。`npx vitest run src/components/rich-editor.test.tsx` 4项、`npm run check:ui`、`npm run build`、`npm run format:check`、`git diff --check` 通过；运行中的原生开发预览右键虚构图片，截图与可访问树均确认两项完整显示。未提交、未发布，未发送邮件，也未改动草稿内容。

1. 原生图片剪贴板粘贴、Finder跨窗口拖拽与当前窗口边界；原生草稿关闭重开后图片/格式显示（自动Store测试通过不替代此项）。
2. 授权企业邮↔QQ的真实图片/字体/高亮/任务列表互发，以及其他收件客户端显示。不得向第三方发信；不得用原有邮件收件人列表。
3. 0.1.12 的源码提交、合并、云端构建与正式发布已完成，见 RELEASE_012_WORKING.md；后续修复和新版本仍需分别验收与记录。
4. 原有硬件/睡眠/大附件/服务商矩阵继续由各工作点维护。

主要文件：rich-editor.tsx/rich-toolbar.tsx/rich-search.tsx、lib/rich-body.ts/rich-extensions.ts/compose-format.ts、compose-dialog.tsx、Rust compose_files.rs/lib.rs、index.css及对应测试。当前记录不依赖运行PID或临时日志；后续启动仍使用 `npm run desktop` 稳定开发签名。
