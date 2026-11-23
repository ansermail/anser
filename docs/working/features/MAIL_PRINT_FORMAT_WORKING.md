# 邮件原格式与 A4 打印（2026-10-27）

## 工作区与目标

- `/Volumes/Others/mail`，`main`，基线 `c6985a2`，组织 origin 正确；修复提交 `c1e827e`，已随 0.1.34 发布。
- 保留开工前 `src/lib/mail-images.ts`、`src/lib/mail-images.test.ts` 的未提交改动。
- 用户要求打印正文保留邮件原始排版；后续明确要求正常比例，常用 A4 纸。

## 已完成与验证

- 根因：旧 `mail-print.ts` 仅导入 body 子节点，丢掉 head 样式、body 类与样式；放进主页面后又受到应用 CSS reset 影响。
- `mail-print.ts` 保留完整净化文档，放在 ShadowRoot 中打印；适配可读 CSS 的 `:root`，自定义字体以私有族名临时注册，避免改变应用字体。继续保留净化、资源代理、无 Referrer 与仅单封打印。
- 临时页在屏幕外布局，inert 防焦点进入，屏幕阶段 contain 防止定位元素逸出；打印阶段恢复正常流，支持长正文分页。图片、样式与字体合计最多等待 15 秒。
- 专项命令 `npm test -- src/lib/mail-print.test.ts src/lib/mail-html.test.ts src/components/external-mail-window.test.tsx`：3 文件 29/29 通过（打印 9 项）。覆盖净化、结构与属性、资源等待/超时、旧打印废弃、原生 A4 命令分流和错误清理。
- 本机 `npm run build`（包含 UI、1,348 条双语键、TypeScript 与生产构建）、`npm run format:check`、`git diff --check` 通过。Vite 保留既有分包提示。
- ego-browser Chromium 实测原字号 36px、蓝色标题、背景、间距、根变量与带 `:root` 字面属性的选择器；应用样式未被邮件影响；自定义字体实际 loaded，打印清理后临时字体一并移除。
- Chromium A4 PDF：100 个编号段落恰好各一次、顺序正确，开头/结尾均保留，5 页无空白页。原格式回归的 5 页均已渲染目视；加入 CSS A4 默认值后再次输出最终 A4 PDF，纸型与 100 段顺序核对通过。
- `npm run desktop` 稳定启动器已启动新开发包，确认 `Running` 且应用父进程仍为 Tauri 后才绑定原生 UI。同一 BigME 邮件在 macOS 原生预览恢复蓝色标题、顶部色条、浅底与原段落间距，1/1 页，已取消，未实际发送打印任务。

## A4 正常比例追加要求与验证

- 用户追加 A4 正常比例要求。旧 Wry 原生打印直接使用共享 NSPrintInfo，未独立固定纸型/比例/居中。新增 `mail_print.rs` + `macos_print.m`：仅 main / external-mail-* 调用窗口，Tauri 提供 native pointer，主线程建立独立打印任务；A4 纵向、scalingFactor=1、取消居中，横向适配宽度、纵向正常分页。CSS `@page A4 portrait / 16mm`；AppKit 边距 0，避免重复叠加。不改变共享打印偏好。浏览器仍用 window.print；非 macOS 桌面使用 WebView.print。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：429 passed / 4 ignored / 0 failed；`npm run test:desktop`：36/36（含阅读窗口打印 ACL 检查）。原生代码修改后重新使用稳定开发启动器构建，确认 Running 及新 app PID 的父进程为 Tauri，再进行 UI 验收；未绕过签名。
- 本机 Objective-C 参数探针（临时文件）实际返回 A4 595×842pt（AppKit 按整 pt 取整）、portrait、100%、不居中、正常分页；修改返回副本不影响 sharedPrintInfo。最初探针使用 0.01pt 容差误报 A4 宽度，读取系统值后按小于 0.5pt 容差核对通过，生产代码未为探针改纸型。
- 最终 BigME 邮件经原生面板“保存为 PDF”得到 1 页 A4（595×842pt）；PDF bbox 首行 x=45.354pt、y=48.796pt，字号层次及色条/品牌色/段落/链接/页尾保留，已渲染目视。补齐系统面板 PaperSize / Orientation / Scaling 选项后，最终原生 AX 与截图实测显示“A4 210×297毫米”、竖排选中及“100%”，正文原样式仍保留；已取消并返回同封邮件，未点“打印”，未向物理打印机发送任务。
- 最新 `npm run build`、`npm run build:preview`、`npm run format:check`、`cargo fmt --check`、`git diff --check` 均通过。Pages 原生桥隔离与双入口检查通过；Vite 只有既有分包提示。
- 最终 Chromium 使用 CSS 纸型（未强行传入 A4 纸张尺寸）生成 `/tmp/anser-print-a4-long-final.pdf`：594.96×841.92pt A4、5 页，100 段按序且无重复/遗漏/空白页。打印根与临时字体清理后恢复应用。ego 任务空间已结束。

## 当前入口

- 本地开发代码与相关验证完成。用户随后要求清理预览、恢复正式版并提交发版；开发预览已退出并移入废纸篓，正式 0.1.33 已恢复运行。打印修复已随 0.1.34 正式发布，完整证据见 RELEASE_0_1_34_WORKING.md。

## 限制与发布边界

- 代码、自动测试、浏览器 PDF、原生单页预览分别记录；未执行真实纸张打印、原生长正文分页、正式包重建/安装或 Intel 实机。云端构建、资源审计及正式发布结果见 0.1.34 发布记录。
- 原邮件字号与颜色继续保留；纸张宽度会改变换行/分页。失败或等待超时的网络资源仍可能缺失。跨域样式若禁止 CSSOM 读取，其普通规则仍可应用，但根变量/自定义字体的额外适配受浏览器限制。
- 本轮没有发送、删除或移动真实邮件，没有改写 MIME、账号、钥匙串、默认应用或系统信任；原生验收使用已有邮件，未将真实内容加入仓库。
