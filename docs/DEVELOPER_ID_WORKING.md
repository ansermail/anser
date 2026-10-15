# Developer ID Application 证书申请工作点

**已终止（2026-10-14 用户决定）**：用户明确不继续办理需付费成员资格的 Developer ID/Application 证书及 Apple 公证，改用项目自行签名。以下申请路径与阻塞为当时历史记录，不再作为当前下一步。现有发布工作流的应用代码签名为 ad hoc，更新归档另由项目持有的 Tauri 密钥签名；正式 App 若改为固定自签证书，需另行接入和验收，不能视为 Gatekeeper 认可的开发者签名。

- 日期：2026-10-13；仓库：`/Volumes/Others/mail`，分支 `main`，origin `git@github.com:ansermail/anser.git`。
- 目标：为 Anser 的正式 macOS 分发申请 Developer ID Application 证书；后续签名、公证和流水线接入须独立验证。
- 当前状态：用户完成 Apple ID 登录后，证书列表显示 `Access Unavailable`，说明该页面仅供已加入开发者计划的开发者或组织团队成员使用；`https://developer.apple.com/account/` 显示 `Join the Apple Developer Program` / `Enroll today`。点击后 `https://developer.apple.com/enroll/` 提示通过 iPhone、iPad 或 Mac 上的 Apple Developer app 入会，若不使用 app 可联系 Apple。浏览器任务空间 26、页面 p1 已交还用户。
- 阻塞：当前账号没有可用的 Apple Developer Program 成员资格；需由用户确定个人入会或受邀加入已有组织团队，并亲自完成身份核验、条款和付款。不能把账号登录视为证书权限已开通。
- 尚未完成：取得开发者计划/团队证书权限；在本机安全生成 CSR/私钥；通过 Apple 后台创建并下载证书；导入钥匙串并验证证书与私钥配对。尚未修改正式发布流水线，也未执行公证。
- 下一步：成员资格生效后，在同一浏览器任务空间重新打开证书列表并继续。私钥只保留在本机钥匙串或用户控制的安全备份，不提交仓库或上传到非 Apple 证书申请入口。核对证书签发结果后，再规划 CI 所需的安全导出及公证凭据。
- 本轮验证：`git status --short --branch` 显示原有未提交工作，未触碰其代码；origin 已核对。Apple 官方账号和入会页已实际查看；证书申请结果未验证。
