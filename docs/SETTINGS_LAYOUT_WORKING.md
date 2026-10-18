# 设置分类布局工作点

更新：2026-10-18。分支 `codex/settings-layout`，本轮未提交或发布。

## 目标与实现

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
