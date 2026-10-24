# 官网与宣传片重做

- 源码基线：0.1.27 / `38fe9b7`，分支 `codex/website-video`。
- 工作目录：`/Users/zhangxiaojun/Desktop/mail_video/source`。
- 原主目录的未提交文档未携带、未覆盖。
- 官网 `/anser/`，共享演示 `/anser/demo/`，由现有 Pages 流水线同时部署。
- 官网样式全部在 `.site-*` / `.anser-site` / `body.site-body` 范围内；按钮、Tabs、视频弹窗复用 shadcn。
- 图标来自 `public/app-icon.png`。素材为最新 App 的虚构演示数据；独立原生 WebKit 展示器只加载静态 preview 构建，没有 Tauri IPC、钥匙串、邮箱后端。截图原始尺寸 2880×1800；从捕获结果裁除 64px 的展示器系统标题栏，没有生成或伪造应用内容。
- 原生展示器是素材采集工具，截图不作为正式安装、真实收发或服务器故障验收。
- `preview/site` 只由官网入口引用，Vite 使用资源摘要文件名；桌面 build 不包含网站 JS、图片或视频。
- 网站中英文文案位于 `src/locales/site.*.json`。新增键匹配及高清截图保护由 `scripts/check-preview.mjs` 验证。
- 配音由 Edge TTS 的 `zh-CN-XiaoxiaoNeural` 生成，无第三方个人音色样本；原创音乐由本地脚本生成。
- 最终视频工程与素材在桌面 mail_video 中；只将网页播放用压缩版与封面纳入仓库。

## 验证与部署

本地最终验证通过：

- `npm run build:preview`：官网与 `/demo/` 两入口、共享 App 布局、虚构数据与原生桥隔离、两份网站资源键和 Retina 截图尺寸检查。
- `npm run build`：桌面生产构建；确认 dist 没有网站视频或截图。
- `npm run format:check`、`git diff --check`。
- `npm test -- src/lib/preview-api.test.ts src/lib/theme.test.ts`：2 文件 3 项通过；演示忽略既有邮箱持久数据并阻止真实操作。
- 浏览器：四功能 Tabs、中英文切换、390px 两种语言无水平溢出、官网进演示/返回官网、视频 metadata 与 readyState=4、弹窗关闭后焦点恢复。
- 原生 WebKit：最新共享 App 虚构收件阅读、深色、本地存档、规则、填写虚构草稿；手机宽度官网截图通过。未发送邮件或使用真实模型。
- 成片：80.149 秒，3840×2160 / 1920×1080，30fps，H.264/AAC 48kHz 双声道；全程解码无错误，关键帧实际检查。-16.0 LUFS、-1.5dBFS 真峰值。

远端 Pages 部署与仓库 Checks 由本次提交对应的工作流分别核对；网站部署不代表新桌面版本发布。
