# 设置分类布局工作点

更新：2026-10-23。基于 `main`（`0.1.25`），本轮进一步优化设置分类、卡片配平、整体网格左对齐与邮件签名上下结构；尚未提交或发布。

## 2026-10-23 二次布局优化（用户确认方向）

针对用户指出的宽屏下右侧内容脱离左侧分类导航居中漂移、应用偏好堆叠 6 张大小悬殊卡片、以及邮件签名三栏挤压问题，完成以下调整：

- `src/components/settings-layout.tsx`、`src/App.tsx`：设置分类扩充为「邮箱账号 / 本地存档 / 应用偏好 / 阅读与写信 / 后台任务 / 关于雁信」六类；新增「阅读与写信」分类集中承载「邮件签名」与「大模型翻译」。
- `src/components/mail-signatures.tsx`：邮件签名内部由「左侧 260px 控制栏 + 右侧编辑/预览」改为上下结构：顶部工具栏集中放置「使用 HTML」开关与「签名文件」导入控件；中部占满整卡宽度展示编辑区（启用 HTML 或导入 HTML/图片时左右 1:1 等宽并排展示编辑与实时预览，标题置于框体上方，两框均为 280px 等高、`var(--radius-md)` 圆角及一致内边距对齐，窄容器自动转为上下排列）；底部放置「保存签名」按钮与「已保存 / 尚未保存」状态 Badge。
- `src/components/storage-tools.tsx`、`src/components/network-proxy-settings.tsx`、`src/components/language-settings.tsx`：「应用偏好」将「界面语言」「后台检查」「系统通知与启动」「网络代理」按从上到下的单列整行卡片排列，每条左侧为标题与说明、右侧为对应交互控件（语言下拉、后台检查间隔选择与保存按钮、系统通知与开机自启开关、代理启用与编辑）；「测试系统通知」按钮置于通知卡片右上角 `CardAction`；网络代理未开启时补充直连说明。
- `src/index.css`：取消 `.settings-workspace` 的 `max-width: 1440px` 居中漂移与 `.settings-section` 的 `margin-inline: auto`，改为内容区紧贴左侧分类导航（固定 32px 间距左对齐），与顶部「设置与账号」标题网格对齐；左侧分类栏宽度设为 196px 以完整容纳中英文分类名；对 `button`、`.mail-sidebar`、`.sidebar`、`.settings-navigation`、`[data-slot="tabs-list"]`、`[data-slot="tabs-trigger"]` 设置 `user-select: none`，并在 `src/lib/context-menu.ts` 右键拦截中清除落入导航/按钮控件的选区，防止 macOS WebKit 右键触发字符黑底选中。
- `src/locales/zh-CN.json`、`src/locales/en.json`：补充 6 条中英文文案（共 1225 键）。
- `src/App.test.tsx`、`src/components/mail-signatures.test.tsx`：同步六分类切换保留未保存输入、中英文切换与邮件签名新工具栏/状态标识测试。

### 2026-10-23 验证记录

- `npm run check:ui`：通过。
- `npm run check:i18n`：1225 条双语文案及占位符检查通过。
- `npx vitest run src/components/mail-signatures.test.tsx src/components/storage-tools.test.tsx src/components/language-settings.test.tsx src/components/mail-translation-settings.test.tsx`：4 文件 15 项测试全部通过。
- `npx vitest run src/App.test.tsx -t "settings categories|recent activity|switches interface language"`：4 项通过。
- `npm run build`、`npm run build:preview`、`npm run format:check`、`git diff --check`：通过。
- `npm run desktop`：停止开机自启旧版 `/Applications/雁信.app` 单实例进程后，通过稳定开发启动器完成本地桌面编译、固定项目自签名打包并拉起原生开发应用（`/Volumes/Others/mail/src-tauri/target/debug/bundle/macos/雁信.app`），供用户直接查看设置页六分类、左对齐网格、应用偏好 2×2 卡片配平与邮件签名上下结构效果。

---

## 历史记录（2026-10-18 初版分类布局）

解决设置页所有内容堆在长页面、查找和视觉层级不清的问题。

- `src/components/settings-layout.tsx`：组合既有 shadcn Tabs，提供邮箱账号、本地存档、应用偏好、后台任务、关于雁信五类。容器宽度低于 900px 改顶部导航，键盘方向同步切换。内容独立滚动，切分类回顶部；隐藏面板保持挂载，保留未保存表单。
- `src/App.tsx`：重新归组现有功能；账号卡片改用 shadcn Card，操作按钮提供账号名称；规则页和补存提示直接进入后台任务。
- `src/components/storage-tools.tsx`：通知/启动及后台检查统一 CardHeader、CardContent 和说明层级，启动项用 Separator 分隔。保存、通知和启动调用保持原实现。
- `src/index.css`：分类导航、内容宽度、24px 卡片间距及窄窗口布局；沿用应用字体、主题和 shadcn 组件。
- `src/App.test.tsx`：活动测试先进入后台任务；增加切分类保留未保存模型输入且不提交的回归。
- `AGENTS.md`、`docs/USAGE.md`：同步分类约定与功能路径。

## 本轮验证

- `npm test -- src/App.test.tsx src/components/storage-tools.test.tsx src/components/mail-translation-settings.test.tsx src/components/app-updates.test.tsx src/components/archive-jobs.test.tsx src/components/folder-health.test.tsx src/components/server-operations.test.tsx src/components/server-copy.test.tsx`：8 文件、124 项通过。
- 增加输入保留测试并修正活动测试导航后，`npm test -- src/App.test.tsx -t 'settings categories|recent activity|folder failure'`：3 项通过，其中 1 项为新增测试。未重新执行完整前端或 Rust 测试。
- 最终 `npm run build`（包含 `npm run check:ui`）、`npm run format:check`、`git diff --check` 通过。Vite 保留既有大包与静态/动态导入警告。
- `npm run desktop` 通过稳定开发启动器启动；确认应用 PID 父进程为 Tauri 后才读取 UI。原生浅色实际画面核对账号卡片、应用偏好、存档统计与集中管理入口。未覆盖 `/Applications/雁信.app`。
- ego-browser 虚构数据：1440px 分类在左且内容无横向溢出；1000×760px 五分类逐个切换，顶部导航、内容/页面均无横向溢出，切换后滚动位置为 0。截图接口超时，浏览器项以实际 DOM/几何及交互为证，像素视觉取原生工具截图。临时 TaskSpace 已关闭。

## 边界与下一步

2026-10-18 用户追加的展开与刷新反馈已完成：新增 `src/components/task-panel-header.tsx`，五卡片共用标题/说明触发与独立刷新按钮。手动刷新复用原 Promise，不延迟数据发布，至少 600ms 旋转和「刷新中」反馈、防重复点击及卸载清理；尊重减少动态效果偏好。后台轮询保持原节奏，不显示手动刷新动画。

本次实际运行 `npm test -- src/components/task-panel-header.test.tsx src/components/archive-jobs.test.tsx src/components/server-operations.test.tsx src/components/folder-health.test.tsx src/components/server-copy.test.tsx`：24 项通过；`npm test -- src/App.test.tsx -t 'settings categories|recent activity'`：3 项通过。新回归用延迟读取和变化后的虚构记录核对刷新有效、重复点击只发一次、刷新不折叠，并覆盖慢请求与失败后恢复。首次检查发现目录核查操作仍使用 RefreshCw，恢复其 import 后重跑通过；失败用例计时器改为仅推进反馈计时，避免误触 5 秒轮询清除错误。最终 `npm run build`（含 UI）、`npm run format:check` 和 `git diff --check` 通过。

原生浅色预览已核对五个标题触发区域及独立刷新按钮，实际展开完整保存任务并执行只读刷新；未操作任务暂停、取消或重试。后台任务页保留，后续可按用户反馈细调。旋转状态持续及失败恢复以延迟请求自动测试为证，原生读取较快，未取得忙碌态像素序列。

开发预览保留在设置页供用户查看，下一步按用户视觉反馈微调；原生窄窗口和深色完整视觉矩阵未执行。未主动修改真实设置、发件、备份、迁移或删除；启动后原有后台收取照常运行。未提交、推送、云端构建或发布，正式版仍为 0.1.20。提交前核对本分支 diff，仅提交本轮设置主题文件；发布另走现有完整门槛。
