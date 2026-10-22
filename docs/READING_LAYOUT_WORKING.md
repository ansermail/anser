# 通知定位与长对话阅读工作点（2026-10-22）

## 范围与代码

- 分支 `main`，起点 `490a432`，本轮尚未提交/发布。
- `src/App.tsx`：通知定位保存点击代际，重复点击同一通知重建阅读区；列表对话数量 outline Badge 与双语数量说明。
- `src/components/conversation-reader.tsx`：对话先定位当前单封头部；此前正文加载引起的高度变化保持锚点，明确用户操作后释放。WebKit 会因 iframe 布局触发 scroll，不能仅凭 scroll 事件判定用户滚动。ResizeObserver 延至下一帧，卸载清理事件/帧。
- `src/components/ui/scroll-area.tsx`：官方 registry 新增，扩展 viewportRef/viewportProps 供阅读区沿用正文调试标识及既有滚动入口。
- `src/index.css`：阅读父面板限制溢出，正文 flex 基数为 0；正文 padding 移至内容容器，顶部信息/底部回复处于滚动区外。常驻滑块采用项目实际存在的 `--muted`，不能误用未定义的 `--muted-foreground` 导致透明。
- 回归在 `src/App.test.tsx`、`src/components/conversation-reader.test.tsx`；使用说明、双语配置和长期约束同步更新。

## 本轮已验证

- `npm test -- src/components/conversation-reader.test.tsx src/App.test.tsx src/hooks/use-notification-mail.test.tsx`：85/85。
- `npm run build`：check:ui、check:i18n（1219 键）、TypeScript 与 Vite 通过；保留原有拆包体积/动态导入提示。
- 修改源码 Prettier、`git diff --check` 通过。无 Rust 源码变更，本轮未重跑 Rust 测试。
- 浏览器虚构 41 封长对话：最新单封开头、拖动滚动条和固定头尾核对通过；拖动 scrollTop 37012.5→2239.5，标题 top=41、回复 top=692 未变。
- `npm run desktop` 稳定签名开发实例运行于 `src-tauri/target/debug/dev-app/雁信.app`，PID 父进程为 Tauri。真实 GitHub 41 封对话正确显示最新 markdown-it 邮件；Badge、常驻滑块及固定头尾目视核对，通过实际滑块拖动到较早邮件，原生 scrollTop=4088。
- 已关闭 Web Inspector，开发预览恢复最新邮件。未覆盖安装 `/Applications/雁信.app`。

## 剩余验收与下一步

系统通知真实横幅点击尚未验证。已调用既有 `test_notification`，绑定当时选中的最新邮件；访问 Notification Center 的 CUA 调用返回 `-10005 timeoutReached`。没有发送真实测试邮件或改变通知/代理/账号配置。单元/集成测试覆盖通知重复点击、过期结果、仅目标已读和启动防抖边界，不能替代实际横幅点击。

用户再次点一条新通知时核对：打开的是该通知绑定的单封、正文从开头显示、不会因同对话其他正文变高而错位。旧通知应仍打开原来那封，不擅自跳到同对话后来收到的邮件。若仍有问题，分层比较原生 token→notification_mail 元数据 ID→selected/detail ID→正文滚动锚点，不按相同主题或 UID 猜最新目标；诊断不要输出正文/认证/完整 token。确需自动化原生测试时复用当前预览，不重启补收来替代新通知到达验收。
